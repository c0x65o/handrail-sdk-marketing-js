import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MarketingServer, type Store } from "../server/index.js";
import { digest } from "../server/store.js";
import { type Commands, type Grant, type Material } from "../core/index.js";
import { provision } from "../reference/index.js";
import { testStore } from "./datastore.js";
import { fixtureSettings } from "./capability-fixtures.js";
import { providerPlan } from "../server/providers.js";
import { promotionMaterial } from "../react/guided.js";
import { Worker } from "node:worker_threads";

const grant: Grant = { id: "g", projectId: "p", revision: 1, provider: "meta", accountId: "act_1", label: "Authorized account", currency: "USD", timezone: "UTC", permissions: [], expiresAt: "2099-01-01T00:00:00Z", revokedAt: null, secretRef: "unused", pageId: "42" };
const material: Material = { name: "Reviewed plan", headline: "Explicit copy", body: "Explicit body", destination: "https://example.com", destinationDigest: "a".repeat(64), assetIds: [], purpose: "acquisition", settings: fixtureSettings("meta", "act_1", "42"), budget: { currency: "USD", minor: 1000 }, audience: { provider: "meta", locations: ["US"], ageMin: 25, ageMax: 54, expansion: false }, timezone: "UTC", startAt: "2026-10-10T00:00:00Z", endAt: "2026-10-12T00:00:00Z" };
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "promotion-")), path = join(dir, "db"), store = await testStore(path);
  await provision(store, { projects: [{ id: "p", name: "Planning" }, { id: "other", name: "Other" }], users: ["alice", "bob"].map(username => ({ username, password: "", memberships: [{ projectId: "p", role: "admin" as const }] })), accountGrants: [grant], generationGrants: [] });
  const principal = await store.authenticate((await store.login("alice", "", "alice"))!);
  // Retained destination evidence; unavailable provider/generation ports must never run.
  await store.put("p", "destination", material.destinationDigest, { url: material.destination, source: "public_https" });
  const server = MarketingServer.unconnected(store);
  const draft = await server.call(principal, "p", "saveDraft", { requestKey: "draft", material: { name: "Original local draft", body: "Original incomplete copy" } });
  const input: Commands["promoteDraft"]["input"] = { draftId: draft.id, expectedRevision: draft.revision, grantId: grant.id, expectedGrantRevision: 1, material };
  const scope = (await server.workspace(principal, "p")).planningScope!;
  return { dir, path, store, server, principal, draft, input, scope };
}
test("promotion durably binds actor/draft revision/account, survives lost response/reopen, preserves original and provenance through edits", async () => {
  const f = await fixture(); let store = f.store;
  try {
    const promoted = await f.server.call(f.principal, "p", "promoteDraft", f.input);
    assert.equal(promoted.state, "draft"); assert.equal(promoted.receipt, null);
    // Promotion remains planning-only; a later owned image produces the new native
    // contract without adding a sharing option or mutating the authored material.
    const withImage = { ...promoted, material: { ...promoted.material, assetIds: ["image"] } };
    const plan: any = providerPlan(withImage, grant, [{ id: "image", projectId: "p", campaignId: promoted.id,
      version: 1, kind: "image", digest: "a".repeat(64), mime: "image/png", width: 320, height: 180, seconds: null,
      source: "uploaded", jobId: null, rightsReceipt: "fixture", parentAssetIds: [] }]);
    assert.equal(plan.readbackVersion, "4"); assert.equal(plan.campaign.is_adset_budget_sharing_enabled, false);
    assert.deepEqual(promoted.material, material);
    assert.deepEqual(promoted.draftOrigin, { draftId: f.draft.id, revision: 1, actorId: f.principal.userId, materialDigest: digest(f.draft.material), accountId: grant.accountId });
    await store.close(); store = await testStore(f.path);
    const server = MarketingServer.unconnected(store);
    assert.deepEqual(await server.call(f.principal, "p", "promoteDraft", f.input), promoted);
    assert.deepEqual(await store.get("p", "campaignDraft", f.draft.id), f.draft);
    const edited = await server.call(f.principal, "p", "saveCampaign", { id: promoted.id, expectedRevision: 1, grantId: "g", material: { ...material, headline: "Changed" } });
    assert.deepEqual(edited.draftOrigin, promoted.draftOrigin);
    assert.deepEqual(await server.call(f.principal, "p", "promoteDraft", f.input), promoted);
    await assert.rejects(server.call(f.principal, "p", "promoteDraft", { ...f.input, material: { ...material, name: "Different" } }), /request_key_payload_conflict/);
    const bob = await store.authenticate((await store.login("bob", "", "bob"))!);
    await assert.rejects(server.call(bob, "p", "promoteDraft", f.input), /request_key_payload_conflict/);
    assert.equal((await store.list("p", "campaign")).length, 1);
    assert.equal((await store.list("p", "draftPromotion")).length, 1);
    assert.deepEqual((await store.list<{ source: unknown }>("p", "draftPromotion"))[0]?.source, f.draft);
    for (const kind of ["operation", "packet", "decision", "job", "advertisingBudgetReservation"]) assert.deepEqual(await store.list("p", kind), []);
  } finally { await store.close(); rmSync(f.dir, { recursive: true, force: true }); }
});
test("two promotion clients race on durable binding; independent SQL connections produce exactly one campaign", async () => {
  const f = await fixture(); let other: Store | undefined;
  try {
    other = f.store.db.dialect === "sqlite" ? f.store : await testStore(f.path);
    const a = f.server, b = MarketingServer.unconnected(other);
    const results = await Promise.all([a, b].map(s => s.call(f.principal, "p", "promoteDraft", f.input)));
    assert.deepEqual(results[0], results[1]);
    assert.equal((await f.store.list("p", "campaign")).length, 1);
    const keys = await f.store.db.prepare("SELECT * FROM requests WHERE project_id=? AND kind=?").all("p", "draftPromotion");
    assert.equal(keys.length, 1);
    // Even a second grant for the same provider account cannot mint another campaign.
    await f.store.put("p", "grant", "alias", { ...grant, id: "alias" });
    await assert.rejects(a.call(f.principal, "p", "promoteDraft", { ...f.input, grantId: "alias" }), /request_key_payload_conflict/);
  } finally { if (other !== f.store) await other?.close(); await f.store.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test("independent SQL worker connections race promotion and changed create intents without duplicate campaigns", async () => {
  const f = await fixture();
  const workers: Worker[] = [];
  const race = async (inputs: unknown[]) => {
    const ready: Promise<void>[] = [], results: Promise<any>[] = [];
    for (const input of inputs) {
      const worker = new Worker(`
        const { parentPort, workerData: d } = require('node:worker_threads');
        (async () => {
          const { testStore } = await import(d.datastore);
          const { MarketingServer } = await import(d.service);
          const store = await testStore(d.path);
          parentPort.postMessage({ready: true});
          parentPort.once('message', async () => {
            try { parentPort.postMessage({result: await MarketingServer.unconnected(store).call(d.principal, 'p', d.command, d.input)}); }
            catch (e) { parentPort.postMessage({error: e.message}); }
            finally { await store.close(); }
          });
        })().catch(e => { throw e; });
      `, { eval: true, workerData: { path: f.path, principal: f.principal,
        datastore: new URL("./datastore.js", import.meta.url).href, service: new URL("../server/service.js", import.meta.url).href, ...input as object } });
      workers.push(worker);
      ready.push(new Promise((resolve, reject) => { worker.once("error", reject); worker.on("message", m => { if (m.ready) resolve(); }); }));
      results.push(new Promise((resolve, reject) => { worker.once("error", reject); worker.on("message", m => { if (!m.ready) resolve(m); }); }));
    }
    await Promise.all(ready);
    for (const w of workers.slice(-inputs.length)) w.postMessage("go");
    return Promise.all(results);
  };
  try {
    const promoted = await race([1, 2].map(() => ({ command: "promoteDraft", input: f.input })));
    assert.ok(promoted.every(x => !x.error), JSON.stringify(promoted));
    assert.deepEqual(promoted[0], promoted[1]);
    assert.equal((await f.store.list("p", "campaign")).length, 1);
    const creates = await race([1, 2].map(i => ({ command: "planningWrite", input: { command: "saveCampaign", scope: f.scope, requestKey: `intent-${i}`, input: { grantId: "g", material: { ...material, name: `Racing ${i}` }, requestKey: `create-${i}` } } })));
    assert.equal(creates.filter(x => x.result).length, 1);
    assert.equal(creates.filter(x => x.error === "unresolved_planning_write_review_required").length, 1);
    assert.equal((await f.store.list("p", "campaign")).length, 2); // One promotion plus exactly one create.
  } finally { await Promise.all(workers.map(w => w.terminate())); await f.store.close(); rmSync(f.dir, { recursive: true, force: true }); }
});
test("promotion rejects stale draft/grant, revoked/expired authority, removed actor and foreign project, including retries", async () => {
  const f = await fixture();
  try {
    const call = (input = f.input) => f.server.call(f.principal, "p", "promoteDraft", input);
    await assert.rejects(call({ ...f.input, expectedRevision: 2 }), /revision_conflict/);
    await assert.rejects(call({ ...f.input, expectedGrantRevision: 2 }), /grant_changed/);
    await assert.rejects(f.server.call(f.principal, "other", "promoteDraft", f.input), /forbidden/);
    await call();
    for (const patch of [{ revision: 2 }, { revokedAt: "2026-10-06T00:00:00Z" }, { expiresAt: "2000-01-01T00:00:00Z" }]) {
      await f.store.put("p", "grant", "g", { ...grant, ...patch });
      await assert.rejects(call(), /grant_changed|grant_expired_or_revoked/);
    }
    await f.store.put("p", "grant", "g", grant);
    await f.server.call(f.principal, "p", "saveDraft", { id: f.draft.id, expectedRevision: 1, requestKey: "edit", material: { name: "Later revision" } });
    await assert.rejects(call(), /revision_conflict/);
    await f.store.db.prepare("DELETE FROM memberships WHERE user_id=?").run(f.principal.userId);
    await assert.rejects(call(), /forbidden/);
    assert.equal((await f.store.list("p", "campaign")).length, 1);
  } finally { await f.store.close(); rmSync(f.dir, { recursive: true, force: true }); }
});
test("promotion validation and injected rollback commit neither campaign nor binding; retry can safely create once", async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.server.call(f.principal, "p", "promoteDraft", { ...f.input, material: { ...material, settings: { ...material.settings!, nondiscriminationAccepted: false } } }), /nondiscrimination/);
    await assert.rejects(f.store.transaction(async () => {
      await f.server.call(f.principal, "p", "promoteDraft", f.input); throw new Error("injected_rollback");
    }), /injected_rollback/);
    for (const kind of ["campaign", "draftPromotion", "campaignVersion", "audience"]) assert.deepEqual(await f.store.list("p", kind), []);
    assert.equal((await f.store.db.prepare("SELECT * FROM requests WHERE kind=?").all("draftPromotion")).length, 0);
    await f.server.call(f.principal, "p", "promoteDraft", f.input);
    assert.equal((await f.store.list("p", "campaign")).length, 1);
  } finally { await f.store.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test("unresolved planning receipt survives new keys, changed material/target/revision and restart until explicit review", async () => {
  const f = await fixture(); let store = f.store;
  try {
    const input = { command: "promoteDraft" as const, scope: f.scope, input: f.input, requestKey: "ui-intent" };
    const receipt = await f.server.call(f.principal, "p", "planningWrite", input); // discard HTTP response
    await store.close(); store = await testStore(f.path);
    const server = MarketingServer.unconnected(store);
    assert.deepEqual(await server.call(f.principal, "p", "planningWrite", input), receipt);
    for (const changed of [f.input, { ...f.input, material: { ...material, name: "Changed after timeout" } },
      { ...f.input, grantId: "different-target" }, { ...f.input, expectedRevision: 2 }]) {
      await assert.rejects(server.call(f.principal, "p", "planningWrite", { ...input, input: changed, requestKey: "new-key" }), /unresolved_planning_write/);
    }
    await assert.rejects(server.call(f.principal, "p", "planningWrite", { scope: f.scope, requestKey: "new-create", command: "saveCampaign", input: { grantId: "g", material } }), /unresolved_planning_write/);
    assert.equal((await server.workspace(f.principal, "p")).planningWrites?.[0]?.result.id, receipt.result.id);
    const bob = await store.authenticate((await store.login("bob", "", "bob-review"))!);
    assert.deepEqual((await server.workspace(bob, "p")).planningWrites, []);
    await assert.rejects(server.call(bob, "p", "acknowledgePlanningWrite", { id: receipt.id }), /forbidden/);
    await store.db.prepare("UPDATE memberships SET role=? WHERE user_id=?").run("analyst", f.principal.userId);
    await assert.rejects(server.call(f.principal, "p", "acknowledgePlanningWrite", { id: receipt.id }), /forbidden/);
    await store.db.prepare("UPDATE memberships SET role=? WHERE user_id=?").run("admin", f.principal.userId);
    await server.call(f.principal, "p", "acknowledgePlanningWrite", { id: receipt.id });
    assert.deepEqual(await store.get("p", "planningWrite", receipt.id), receipt); // original receipt immutable
    assert.deepEqual((await server.workspace(f.principal, "p")).planningWrites, []);
    assert.equal((await store.list("p", "campaign")).length, 1);
  } finally { await store.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test("changed campaign-create form after an uncertain result cannot create a second campaign", async () => {
  const f = await fixture();
  try {
    const input = { command: "saveCampaign" as const, scope: f.scope, input: { grantId: "g", material, requestKey: "save-1" }, requestKey: "intent-1" };
    const first = await f.server.call(f.principal, "p", "planningWrite", input);
    await assert.rejects(f.server.call(f.principal, "p", "planningWrite", { ...input, requestKey: "intent-2", input: { ...input.input, requestKey: "save-2", material: { ...material, name: "Changed form" } } }), /unresolved_planning_write/);
    assert.equal((await f.store.list("p", "campaign")).length, 1);
    assert.deepEqual(await f.server.call(f.principal, "p", "planningWrite", input), first);
    await f.store.put("p", "grant", "g", { ...grant, revision: 2 });
    await assert.rejects(f.server.call(f.principal, "p", "planningWrite", input), /request_key_payload_conflict/);
  } finally { await f.store.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test("a different valid login cannot acquire an old form intent; fresh same-actor scope can recover the receipt", async () => {
  const f = await fixture();
  try {
    const input = { command: "saveCampaign" as const, scope: f.scope, requestKey: "session-intent", input: { grantId: "g", material } };
    const replacement = await f.store.authenticate((await f.store.login("alice", "", "replacement"))!);
    const bob = await f.store.authenticate((await f.store.login("bob", "", "bob-replacement"))!);
    for (const principal of [replacement, bob]) await assert.rejects(f.server.call(principal, "p", "planningWrite", input), /planning_session_changed/);
    assert.equal((await f.store.list("p", "campaign")).length, 0);
    const original = await f.server.call(f.principal, "p", "planningWrite", input);
    const scope = (await f.server.workspace(replacement, "p")).planningScope!;
    assert.notEqual(scope, f.scope);
    assert.deepEqual(await f.server.call(replacement, "p", "planningWrite", { ...input, scope }), original);
    assert.equal((await f.store.list("p", "campaign")).length, 1);
    assert.equal((await f.server.workspace(bob, "p")).planningWrites?.length, 0);
  } finally { await f.store.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test("malformed legacy provider settings offer explicit unqualified reconstruction with source preserved", async () => {
  const f = await fixture();
  try {
    for (const settings of [{ provider: "meta", targeting: { languages: null } }, { provider: "meta", identity: [] }, { provider: "meta", targeting: { interestGroups: [null] } }]) {
      const draft = { ...f.draft, material: { ...material, settings } } as any;
      const original = structuredClone(draft);
      assert.throws(() => promotionMaterial(draft, grant));
      const reconstructed = promotionMaterial(draft, grant, true);
      assert.deepEqual(draft, original);
      assert.equal(reconstructed.settings?.nondiscriminationAccepted, false);
      assert.deepEqual(reconstructed.budget, material.budget);
      assert.deepEqual(reconstructed.audience, material.audience);
      assert.equal(reconstructed.settings?.identity && "pageId" in reconstructed.settings.identity && reconstructed.settings.identity.pageId, "");
      await assert.rejects(f.server.call(f.principal, "p", "promoteDraft", { ...f.input, material: reconstructed }), /notice_required|page_required/);
    }
  } finally { await f.store.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test("planning saves recheck role, session and grant after awaited material validation and roll back", async () => {
  for (const change of ["role", "session", "grant", "draft"] as const) {
    const f = await fixture();
    try {
      const get = f.store.get.bind(f.store); let changed = false;
      f.store.get = async function<T>(project: string, kind: string, id: string): Promise<T> {
        const result = await get<T>(project, kind, id);
        if (kind === "destination" && !changed) {
          changed = true;
          if (change === "role") await f.store.db.prepare("UPDATE memberships SET role=? WHERE user_id=?").run("analyst", f.principal.userId);
          if (change === "session") await f.store.revokeUserSessions(f.principal.userId);
          if (change === "grant") await f.store.put("p", "grant", "g", { ...grant, revision: 2 });
          if (change === "draft") await f.store.put("p", "campaignDraft", f.draft.id, { ...f.draft, revision: 2 });
        }
        return result;
      };
      await assert.rejects(f.server.call(f.principal, "p", "planningWrite", { command: "promoteDraft", scope: f.scope, input: f.input, requestKey: "delayed" }), /forbidden|authentication_required|session_authority_changed|grant_changed|revision_conflict/);
      assert.ok(changed);
      for (const kind of ["campaign", "campaignVersion", "planningWrite", "draftPromotion"]) assert.deepEqual(await f.store.list("p", kind), []);
    } finally { await f.store.close(); rmSync(f.dir, { recursive: true, force: true }); }
  }
});
