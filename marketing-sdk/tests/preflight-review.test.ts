import test from "node:test";
import assert from "node:assert/strict";
import type { Campaign, Grant } from "../core/index.js";
import { digest, MarketingServer } from "../server/index.js";
import { nativePreflightFixture } from "./preflight-fixture.js";
import { testStore } from "./datastore.js";

test("prerequisite expiry is bounded by the earliest observation, including slow native reads", async t => {
  const f = await nativePreflightFixture(true);
  try {
    const began = Date.now(); t.mock.timers.enable({ apis: ["Date"], now: began });
    let once = false;
    f.http.boundary = async url => { if (!once && !url.pathname.endsWith("/search")) { once = true; t.mock.timers.setTime(began + 90000); } };
    const check = await f.call("checkCampaign", f.check);
    assert.equal(check.state, "ready");
    assert.ok(Date.parse(check.expiresAt!) <= began + 120000, "Early observations must not gain a second two-minute lifetime");
  } finally { t.mock.timers.reset(); await f.close(); }
});

test("an over-deadline native response stays incomplete and never renews the original attempt", async t => {
  const f = await nativePreflightFixture(true);
  try {
    const began = Date.now(); t.mock.timers.enable({ apis: ["Date"], now: began });
    f.http.boundary = async () => { t.mock.timers.setTime(began + 120001); };
    const result = await f.call("checkCampaign", f.check);
    assert.equal(result.state, "incomplete"); assert.equal(result.expiresAt, null);
    const reads = f.http.trace.length;
    assert.deepEqual(await f.call("checkCampaign", f.check), result);
    assert.equal(f.http.trace.length, reads);
    f.http.boundary = null;
    assert.equal((await f.call("checkCampaign", { ...f.check, requestKey: "fresh" })).state, "ready");
  } finally { t.mock.timers.reset(); await f.close(); }
});

test("a fresh check cannot lend replacement credentials to an already captured native client", async () => {
  const f = await nativePreflightFixture(true);
  try {
    assert.equal((await f.call("checkCampaign", f.check)).state, "ready");
    await f.store.db.acquireExecutor();
    let once = false;
    f.http.boundary = async (_url, init) => {
      if (init?.method !== "POST" || once) return;
      once = true;
      const g = await f.store.get<Grant>("p", "grant", f.c.grantId);
      await f.custody.useReadOnly(g, async () => {}, credentials =>
        f.custody.retainConnectionCredentials("p", g.secretRef, { ...credentials, accessToken: "SYNTHETIC_REPLACEMENT" }));
      assert.equal((await f.call("checkCampaign", { ...f.check, requestKey: "replacement" })).state, "ready");
    };
    const operation = await f.call("prepare", { campaignId: f.c.id, requestKey: "prepare" });
    const result = await f.server.dispatch("p", operation.id);
    assert.equal(result.state, "unknown", "The captured credential must not survive replacement plus a newer proof");
    assert.ok(result.receipt?.ids.image, "The possibly accepted upload identity must be retained");
    assert.equal(f.http.trace.filter(r => r.method === "POST").length, 1);
  } finally { await f.close(); }
});

test("lost-response reconciliation permits unrelated SQL work and rejects external revocation during readback", async () => {
  const f = await nativePreflightFixture(true), other = await testStore(f.path), host = await testStore(f.hostPath);
  let release = () => {};
  try {
    assert.equal((await f.call("checkCampaign", f.check)).state, "ready");
    await f.store.db.acquireExecutor();
    const prep = await f.call("prepare", { campaignId: f.c.id, requestKey: "prepare" });
    assert.equal((await f.server.dispatch("p", prep.id)).state, "succeeded");
    const packet = await f.call("packet", { campaignId: f.c.id });
    await f.call("decide", { packetId: packet.id, digest: packet.digest, decision: "approved" });
    const activation = await f.call("execute", { packetId: packet.id, digest: packet.digest, requestKey: "activate" });
    f.http.loseActivation(); assert.equal((await f.server.dispatch("p", activation.id)).state, "unknown");
    const original = await f.store.get("p", "operation", activation.id);
    let enter = () => {}; const entered = new Promise<void>(r => { enter = r; });
    const held = new Promise<void>(r => { release = r; }); let once = false;
    f.http.boundary = async () => { if (!once) { once = true; enter(); await held; } };
    const reads = f.http.trace.length;
    const pending = f.call("reconcile", { operationId: activation.id }).catch(e => e); await entered;
    const local = other.put("p", "reviewProbe", "unrelated", { id: "unrelated" }).then(() => true, () => false);
    const progressed = await Promise.race([local, new Promise<false>(r => setTimeout(() => r(false), 300))]);
    await host.transaction(async () => { await host.db.prepare("UPDATE fixture_host_sessions SET revoked=1 WHERE id=?").run(f.principal.externalSessionRef); });
    release(); const result = await pending; await local;
    assert.equal(progressed, true, "HTTP readback must not hold the SDK SQL guard");
    assert.ok(result instanceof Error, "Revoked external sessions cannot finish a retained operation");
    assert.deepEqual(await other.get("p", "operation", activation.id), original);
    assert.ok(f.http.trace.slice(reads).every(r => r.method === "GET"));
  } finally { release(); await host.close(); await other.close(); await f.close(); }
});

test("public destination capture resolves outside SQL locks and cannot commit after external revocation", async () => {
  const f = await nativePreflightFixture(true), other = await testStore(f.path), host = await testStore(f.hostPath);
  let release = () => {};
  try {
    let enter = () => {}; const entered = new Promise<void>(r => { enter = r; }), held = new Promise<void>(r => { release = r; });
    const server = new MarketingServer(f.store, f.server.providers, f.server.generation, f.server.agent, "live", undefined,
      async () => { enter(); await held; return Buffer.from("Synthetic destination bytes"); },
      { connections: f.connections, studio: { sessions: f.connections.sessionAuthority } });
    const before = await f.store.list("p", "destination");
    const pending = server.call(f.principal, "p", "captureDestination", { url: "https://example.com/review" }).catch(e => e);
    await entered;
    const local = other.put("p", "reviewProbe", "destination", { id: "destination" }).then(() => true, () => false);
    const progressed = await Promise.race([local, new Promise<false>(r => setTimeout(() => r(false), 300))]);
    await host.transaction(async () => { await host.db.prepare("UPDATE fixture_host_sessions SET revoked=1 WHERE id=?").run(f.principal.externalSessionRef); });
    release(); const result = await pending; await local;
    assert.equal(progressed, true); assert.ok(result instanceof Error);
    assert.deepEqual(await f.store.list("p", "destination"), before);
  } finally { release(); await host.close(); await other.close(); await f.close(); }
});

test("human delay after paused preparation needs fresh proof but preserves the exact approved hierarchy", async t => {
  const f = await nativePreflightFixture(true);
  try {
    const proof = await f.call("checkCampaign", f.check); assert.equal(proof.state, "ready");
    await f.store.db.acquireExecutor();
    const prep = await f.call("prepare", { campaignId: f.c.id, requestKey: "prepare" });
    assert.equal((await f.server.dispatch("p", prep.id)).state, "succeeded");
    const paused = await f.store.get<Campaign>("p", "campaign", f.c.id);
    assert.equal(paused.revision, f.c.revision);
    const packet = await f.call("packet", { campaignId: f.c.id });
    await f.call("decide", { packetId: packet.id, digest: packet.digest, decision: "approved" });
    t.mock.timers.enable({ apis: ["Date"], now: Date.parse(proof.expiresAt!) + 1 });
    const blocked = await f.call("execute", { packetId: packet.id, digest: packet.digest, requestKey: "expired" });
    assert.equal((await f.server.dispatch("p", blocked.id)).state, "blocked");
    assert.equal((await f.call("checkCampaign", { ...f.check, requestKey: "refresh" })).state, "ready");
    assert.equal(digest(await f.store.get("p", "campaign", f.c.id)), digest(paused));
    const recovery = await f.call("execute", { packetId: packet.id, digest: packet.digest, requestKey: "fresh" });
    assert.equal((await f.server.dispatch("p", recovery.id)).state, "succeeded");
    assert.equal(f.http.trace.filter(r => r.method === "POST").length, 8);
    assert.equal((await f.store.list("p", "decision")).length, 1);
  } finally { t.mock.timers.reset(); await f.close(); }
});

test("concurrent native readbacks return the same original completed operation without writes", async () => {
  const f = await nativePreflightFixture(true);
  try {
    assert.equal((await f.call("checkCampaign", f.check)).state, "ready"); await f.store.db.acquireExecutor();
    const prep = await f.call("prepare", { campaignId: f.c.id, requestKey: "prepare" });
    assert.equal((await f.server.dispatch("p", prep.id)).state, "succeeded");
    const packet = await f.call("packet", { campaignId: f.c.id });
    await f.call("decide", { packetId: packet.id, digest: packet.digest, decision: "approved" });
    const op = await f.call("execute", { packetId: packet.id, digest: packet.digest, requestKey: "activate" });
    f.http.loseActivation(); assert.equal((await f.server.dispatch("p", op.id)).state, "unknown");
    let release = () => {}; const both = new Promise<void>(r => { release = r; }); let entered = 0;
    f.http.boundary = async () => { if (++entered === 2) release(); await both; };
    const start = f.http.trace.length;
    const [a, b] = await Promise.all([f.call("reconcile", { operationId: op.id }), f.call("reconcile", { operationId: op.id })]);
    assert.deepEqual(a, b); assert.equal(a.id, op.id); assert.equal(a.state, "succeeded");
    assert.ok(f.http.trace.slice(start).every(r => r.method === "GET"));
    assert.equal((await f.store.list("p", "operation")).length, 2);
  } finally { await f.close(); }
});

test("multiple public campaigns on one grant keep independent proof and material revision history", async () => {
  const f = await nativePreflightFixture(true);
  try {
    const grantBefore = digest(await f.store.get("p", "grant", f.c.grantId));
    let draft = await f.call("copyToDraft", { kind: "draft", id: f.d.id, expectedRevision: f.d.revision, requestKey: "copy" });
    const destination = await f.call("captureDestination", { url: f.c.material.destination });
    draft = await f.call("saveStudioMaterial", { draftId: draft.id, expectedRevision: draft.revision, requestKey: "second-material",
      material: { ...draft.material, settings: f.c.material.settings, destinationDigest: destination.digest }, step: "tracking" });
    await f.call("bindTracking", { owner: { kind: "draft", id: draft.id }, expectedRevision: draft.revision,
      expectedBindingRevision: 0, sourceId: "site", sourceRevision: "1", destinationId: "tour", outcome: "inquiry", refundTreatment: null, requestKey: "second-binding" });
    const second = await f.call("promoteStudio", { ...f.input, draftId: draft.id, expectedRevision: draft.revision, requestKey: "second-campaign" });
    const first = await f.call("checkCampaign", f.check); assert.equal(first.state, "ready");
    const proof = await f.call("checkCampaign", { ...f.check, campaignId: second.id, expectedRevision: second.revision, requestKey: "second-check" });
    assert.equal(proof.state, "ready", JSON.stringify(proof)); assert.notEqual(proof.id, first.id);
    assert.equal((await f.call("campaignCheck", { campaignId: f.c.id }))?.id, first.id);
    assert.equal(digest(await f.store.get("p", "grant", f.c.grantId)), grantBefore);
    const changed = await f.call("saveCampaign", { id: f.c.id, expectedRevision: f.c.revision, grantId: f.c.grantId, material: { ...f.c.material, headline: "Intervening edit" }, requestKey: "edit" });
    const restored = await f.call("saveCampaign", { id: f.c.id, expectedRevision: changed.revision, grantId: f.c.grantId, material: f.c.material, requestKey: "restore-content" });
    assert.deepEqual(restored.material, f.c.material); assert.equal(restored.revision, f.c.revision + 2);
    assert.equal((await f.call("campaignCheck", { campaignId: f.c.id }))?.state, "stale");
    assert.equal((await f.call("campaignCheck", { campaignId: second.id }))?.state, "ready");
    // Even a trusted server caller retaining the old object cannot use old proof.
    await assert.rejects(f.server.providers.meta.verify(await f.store.get("p", "grant", f.c.grantId), f.c, [], "prepare"), /campaign_prerequisites_stale/);
  } finally { await f.close(); }
});

for (const cause of ["expiry", "revocation", "final-readback-revocation"] as const) test(`partial activation retains IDs, original operation and budget exposure after ${cause}`, async t => {
  const f = await nativePreflightFixture(true);
  try {
    const proof = await f.call("checkCampaign", f.check); assert.equal(proof.state, "ready");
    await f.store.db.acquireExecutor();
    const prep = await f.call("prepare", { campaignId: f.c.id, requestKey: "prepare" });
    assert.equal((await f.server.dispatch("p", prep.id)).state, "succeeded");
    const paused = await f.store.get<Campaign>("p", "campaign", f.c.id);
    const packet = await f.call("packet", { campaignId: f.c.id });
    await f.call("decide", { packetId: packet.id, digest: packet.digest, decision: "approved" });
    const activation = await f.call("execute", { packetId: packet.id, digest: packet.digest, requestKey: "activate" });
    const reservations = await f.store.list("p", "advertisingBudgetReservation");
    let writes = 0;
    f.http.boundary = async (_url, init) => {
      if (init?.method !== "POST") return;
      if (++writes !== (cause === "final-readback-revocation" ? 3 : 1)) return;
      if (cause === "expiry") t.mock.timers.enable({ apis: ["Date"], now: Date.parse(proof.expiresAt!) + 1 });
      else await f.host!.revoke(f.principal.externalSessionRef!);
    };
    const result = await f.server.dispatch("p", activation.id);
    assert.equal(result.id, activation.id); assert.equal(result.state, "unknown");
    assert.deepEqual(await f.store.get("p", "campaign", f.c.id), paused);
    assert.deepEqual(await f.store.list("p", "advertisingBudgetReservation"), reservations);
    assert.equal(f.http.trace.filter(r => r.method === "POST").length, cause === "final-readback-revocation" ? 8 : 6);
    assert.equal((await f.store.db.prepare("SELECT operation_id FROM leases WHERE project_id=? AND account_id=?").get("p", packet.accountId))?.operation_id, activation.id);
  } finally { t.mock.timers.reset(); await f.close(); }
});

test("preflight final guards never recursively acquire external session or source guards", async () => {
  const f = await nativePreflightFixture(true);
  try {
    const authority = f.connections.sessionAuthority, original = authority.withLiveSessions.bind(authority);
    const sources = f.source.options.sources!, withSources = sources.withLiveSources.bind(sources);
    let sessionDepth = 0, sourceDepth = 0;
    authority.withLiveSessions = async (expected, local) => {
      assert.equal(sessionDepth, 0); assert.equal(sourceDepth, 0); sessionDepth++;
      try { return await original(expected, local); } finally { sessionDepth--; }
    };
    sources.withLiveSources = async (expected, local) => {
      assert.equal(sourceDepth, 0); assert.equal(sessionDepth, 1); sourceDepth++;
      try { return await withSources(expected, local); } finally { sourceDepth--; }
    };
    f.http.boundary = async () => { assert.equal(sessionDepth, 0); assert.equal(sourceDepth, 0); };
    assert.equal((await f.call("checkCampaign", f.check)).state, "ready");
    await f.store.db.acquireExecutor();
    const operation = await f.call("prepare", { campaignId: f.c.id, requestKey: "prepare" });
    assert.equal((await f.server.dispatch("p", operation.id)).state, "succeeded");
  } finally { await f.close(); }
});

test("process death during a native check retains the original incomplete attempt without automatic replay", async t => {
  const { fork } = await import("node:child_process"), { once } = await import("node:events");
  const f = await nativePreflightFixture();
  const child = fork(new URL("./preflight-crash-child.js", import.meta.url), [JSON.stringify({ path: f.path, key: f.fixtureKey,
    policy: f.currentPolicy(), principal: f.principal, check: f.check })], { stdio: ["ignore", "ignore", "inherit", "ipc"] });
  try {
    const exit = once(child, "exit");
    assert.deepEqual((await Promise.race([once(child, "message"), exit.then(() => { throw new Error("preflight child exited before read boundary"); })]))[0], { reading: true });
    const current = await f.call("campaignCheck", { campaignId: f.c.id }); assert.equal(current?.state, "checking");
    child.kill("SIGKILL"); assert.equal((await exit)[1], "SIGKILL");
    assert.equal((await f.call("checkCampaign", f.check)).id, current?.id);
    assert.equal(f.http.trace.length, 0);
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 120001 });
    assert.equal((await f.call("campaignCheck", { campaignId: f.c.id }))?.state, "incomplete");
    assert.equal((await f.call("checkCampaign", { ...f.check, requestKey: "after-crash" })).state, "ready");
    assert.equal((await f.store.list("p", "campaignCheck")).length, 2);
    assert.equal((await f.store.list("p", "operation")).length, 0);
    assert.ok(f.http.trace.every(r => r.method === "GET"));
  } finally { child.kill("SIGKILL"); t.mock.timers.reset(); await f.close(); }
});
