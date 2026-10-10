import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { nativePreflightFixture } from "./preflight-fixture.js";
import { testStore } from "./datastore.js";
import { MarketingServer } from "../server/service.js";
import type { Grant, Setup } from "../core/index.js";
import { revokeIndependently } from "./independent-revocation.js";

for (const boundary of ["agent", "provider"] as const) for (const action of ["revoke", "role", "configuration"] as const)
test(`legacy ${boundary} work is unlocked and rejects independent-process ${action}`, async () => {
  const f = await nativePreflightFixture(true), other = await testStore(f.path);
  let release = () => {};
  const child = fork(new URL("./session-race-child.js", import.meta.url), [f.hostPath], { stdio: ["ignore", "ignore", "inherit", "ipc"] });
  const exited = once(child, "exit");
  try {
    await once(child, "message");
    const g = await f.store.get<Grant>("p", "grant", f.c.grantId);
    const legacy = { ...g, id: "legacy-setup", permissions: [...new Set([...g.permissions, "setup" as const])] };
    await f.store.put("p", "grant", legacy.id, legacy);
    let enter = () => {}, calls = 0;
    const entered = new Promise<void>(r => { enter = r; }), held = new Promise<void>(r => { release = r; });
    const delay = async () => { calls++; enter(); await held; };
    const provider = { ...f.server.providers.meta, evidence: "provider" as const,
      verify: async () => { if (boundary === "provider") await delay(); return { accountId: g.accountId, currency: g.currency, timezone: g.timezone, permissions: legacy.permissions }; } };
    const server = new MarketingServer(f.store, { ...f.server.providers, meta: provider as any }, f.server.generation,
      { inspect: async () => { if (boundary === "agent") await delay(); return { state: "ready", reason: null, handoffUrl: null }; } },
      "fixture", undefined, undefined, { studio: { sessions: f.connections.sessionAuthority } });
    const input = { grantId: legacy.id, requestKey: "legacy-setup" };
    const pending = server.call(f.principal, "p", "setup", input).catch(e => e); await entered;
    const setups = await other.list<Setup>("p", "setup"); const setup = setups.find(s => s.grantId === legacy.id)!;
    assert.equal(setup.checkpoint, "setup_outcome_unknown", "intent and attempt commit before any effect");
    assert.equal((await server.call(f.principal, "p", "setup", input)).id, setup.id);
    await server.call(f.principal, "p", "resumeSetup", { setupId: setup.id, expectedRevision: setup.revision });
    assert.equal(calls, 1, "duplicate and lost-ack recovery cannot replay an uncertain effect");
    await other.put("p", "probe", "unrelated", { id: "unrelated" });
    child.send({ session: f.principal.externalSessionRef, hold: false, action });
    const committed = (async () => { for (;;) { const [m] = await once(child, "message"); if (m.event === "committed") return true; } })();
    assert.equal(await Promise.race([committed, new Promise(r => setTimeout(() => r(false), 1000))]), true);
    release(); assert.ok(await pending instanceof Error);
    assert.equal((await other.get<Setup>("p", "setup", setup.id)).checkpoint, "setup_outcome_unknown");
    assert.equal((await other.get<any>("p", "legacySetupAttempt", `${setup.id}:${setup.revision}`)).state, "running");
  } finally { release(); child.kill("SIGTERM"); await exited; await other.close(); await f.close(); }
});

for (const command of ["saveCampaign", "planningWrite"] as const)
test(`${command} resolves asset reads outside SQL and rejects delayed role loss`, async () => {
  const f = await nativePreflightFixture(true), other = await testStore(f.path), host = await testStore(f.hostPath);
  const original = f.store.db.prepare.bind(f.store.db);
  let release = () => {};
  try {
    let enter = () => {}, delayed = false;
    const entered = new Promise<void>(r => { enter = r; }), held = new Promise<void>(r => { release = r; });
    f.store.db.prepare = ((sql: string) => {
      const statement = original(sql);
      if (sql === "SELECT bytes FROM blobs WHERE project_id=? AND digest=?") {
        const get = statement.get.bind(statement);
        statement.get = async (...args: any[]) => { if (!delayed) { delayed = true; enter(); await held; } return get(...args); };
      }
      return statement;
    }) as typeof original;
    const input = { id: f.c.id, expectedRevision: f.c.revision, grantId: f.c.grantId, material: { ...f.c.material, headline: "Delayed edit" }, requestKey: "save" };
    const scope = (await f.server.workspace(f.principal, "p")).planningScope!;
    const pending = (command === "saveCampaign" ? f.call(command, input) : f.call(command, { command: "saveCampaign", input, requestKey: "envelope", scope })).catch(e => e);
    await entered;
    const local = other.put("p", "probe", "save", { id: "save" }).then(() => true);
    assert.equal(await Promise.race([local, new Promise(r => setTimeout(() => r(false), 500))]), true);
    await revokeIndependently(f.hostPath, f.principal.externalSessionRef!, "role");
    release(); assert.ok(await pending instanceof Error);
    assert.deepEqual(await other.get("p", "campaign", f.c.id), f.c);
  } finally { release(); f.store.db.prepare = original; await host.close(); await other.close(); await f.close(); }
});

test("campaign edit lost acknowledgement returns its original result after later edits", async () => {
  const f = await nativePreflightFixture(true);
  try {
    const input = { id: f.c.id, expectedRevision: f.c.revision, grantId: f.c.grantId,
      material: { ...f.c.material, headline: "First edit" }, requestKey: "first-edit" };
    const first = await f.call("saveCampaign", input);
    const second = await f.call("saveCampaign", { ...input, expectedRevision: first.revision,
      material: { ...input.material, headline: "Newer edit wins" }, requestKey: "second-edit" });
    assert.deepEqual(await f.call("saveCampaign", input), first);
    assert.deepEqual(await f.store.get("p", "campaign", f.c.id), second);
  } finally { await f.close(); }
});

test("a lost legacy setup effect acknowledgement stays fenced across new request keys", async () => {
  const f = await nativePreflightFixture(true);
  try {
    const g = await f.store.get<Grant>("p", "grant", f.c.grantId);
    const legacy = { ...g, id: "legacy-uncertain", permissions: [...g.permissions, "setup" as const] };
    await f.store.put("p", "grant", legacy.id, legacy);
    let calls = 0;
    const server = new MarketingServer(f.store, f.server.providers, f.server.generation,
      { inspect: async () => { calls++; throw new Error("synthetic lost effect acknowledgement"); } },
      "fixture", undefined, undefined, { studio: { sessions: f.connections.sessionAuthority } });
    const input = { grantId: legacy.id, requestKey: "original" };
    const unknown = await server.call(f.principal, "p", "setup", input);
    assert.equal(unknown.checkpoint, "setup_outcome_unknown");
    assert.deepEqual(await server.call(f.principal, "p", "setup", input), unknown);
    await assert.rejects(server.call(f.principal, "p", "setup", { ...input, requestKey: "escape" }), /setup_outcome_unknown/);
    assert.equal(calls, 1);
  } finally { await f.close(); }
});

for (const boundary of ["custody", "destination"] as const) test(`${boundary} observation permits independent SQL/process revocation`, async () => {
  const f = await nativePreflightFixture(true), other = await testStore(f.path);
  let release = () => {};
  try {
    let enter = () => {}, once = false;
    const entered = new Promise<void>(r => { enter = r; }), held = new Promise<void>(r => { release = r; });
    const delay = async () => { if (!once) { once = true; enter(); await held; } };
    const original = f.custody.useReadOnly.bind(f.custody);
    if (boundary === "custody") f.custody.useReadOnly = async (...args) => { await delay(); return original(...args); };
    const server = new MarketingServer(f.store, f.server.providers, f.server.generation, f.server.agent, "live", undefined,
      async () => { await delay(); return Buffer.from("Synthetic destination bytes"); },
      { connections: f.connections, studio: { sessions: f.connections.sessionAuthority } });
    const pending = (boundary === "custody" ? server.call(f.principal, "p", "searchAudience", {
      grantId: f.c.grantId, expectedGrantRevision: f.check.expectedGrantRevision, material: f.c.material, facet: "country", locale: "en_US", query: "Canada",
    }) : server.call(f.principal, "p", "captureDestination", { url: "https://example.com/delayed" })).catch(e => e);
    await entered;
    await other.put("p", "probe", boundary, { id: boundary });
    await revokeIndependently(f.hostPath, f.principal.externalSessionRef!);
    release(); assert.ok(await pending instanceof Error);
    assert.equal((await other.list("p", "audienceChoice")).length, 0);
    assert.ok(!(await other.list<any>("p", "destination")).some(d => d.url === "https://example.com/delayed"));
  } finally { release(); await other.close(); await f.close(); }
});
