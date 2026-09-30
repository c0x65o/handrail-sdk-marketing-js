import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MarketingServer, type Store } from "../server/index.js";
import { createMarketingClient, type Commands } from "../core/index.js";
import { createHost, provision } from "../reference/index.js";
import { testStore } from "./datastore.js";

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "drafts-")), path = join(dir, "db");
  const store = await testStore(path);
  await provision(store, {
    projects: [{ id: "p", name: "Planning" }, { id: "P", name: "Other project" }],
    users: [
      { username: "alice", password: "", memberships: [{ projectId: "p", role: "admin" }] },
      { username: "bob", password: "", memberships: [{ projectId: "P", role: "admin" }] },
      { username: "reader", password: "", memberships: [{ projectId: "p", role: "analyst" }] },
    ], accountGrants: [], generationGrants: [],
  });
  const token = (await store.login("alice", "", "alice"))!;
  return { dir, path, store, token, principal: await store.authenticate(token) };
}

test("public draft API persists incomplete unconnected material; immutable retries, edits, rollback and project isolation", async () => {
  const f = await fixture();
  let store = f.store, service = MarketingServer.unconnected(store);
  const create: Commands["saveDraft"]["input"] = { requestKey: "create", material: {
    name: "Autumn planning", headline: "", budget: { currency: "USD" }, audience: { provider: "google" },
  } };
  const save = (input: Commands["saveDraft"]["input"]) => service.call(f.principal, "p", "saveDraft", input);
  try {
    const draft = await save(create);
    assert.equal(draft.connection, "unconnected");
    assert.equal(draft.grantId, null); assert.equal(draft.receipt, null);
    const workspace = await service.call(f.principal, "p", "workspace", {});
    assert.equal(workspace.mode, "live");
    assert.deepEqual(workspace.drafts, [draft]);
    assert.deepEqual(workspace.grants, []); assert.deepEqual(workspace.campaigns, []);
    const edit = { id: draft.id, expectedRevision: 1, requestKey: "edit", material: { name: "Edited", body: "Draft copy" } };
    const edited = await save(edit);
    assert.equal(edited.revision, 2);
    // Simulate an uncertain response: ignore the successful write, reconnect, retry.
    await store.close(); store = await testStore(f.path); service = MarketingServer.unconnected(store);
    assert.deepEqual(await store.authenticate(f.token), f.principal);
    assert.deepEqual(await save(edit), edited);
    assert.deepEqual(await save(create), draft); // original receipt, not the latest revision
    assert.deepEqual((await service.call(f.principal, "p", "workspace", {})).drafts, [edited]);
    await assert.rejects(save({ ...create, material: { name: "Different" } }), /request_key_payload_conflict/);
    await assert.rejects(save({ ...edit, requestKey: "stale" }), /revision_conflict/);
    for (const material of [{ name: "" }, { name: "x", budget: { minor: -1 } }, { name: "x", grantId: "forged" }, { name: "x", assetIds: null }])
      await assert.rejects(save({ requestKey: "invalid", material } as any), /invalid_|unexpected_fields/);
    await assert.rejects(save({ requestKey: "bad-revision", expectedRevision: 1, material: { name: "x" } }), /invalid_draft_revision/);
    await assert.rejects(service.call({ userId: "absent" }, "p", "saveDraft", create), /forbidden/);
    for (const username of ["bob", "reader"]) {
      const p = await store.authenticate((await store.login(username, "", username))!);
      await assert.rejects(service.call(p, "p", "saveDraft", edit), /forbidden/);
      if (username === "bob") {
        await assert.rejects(service.call(p, "p", "workspace", {}), /forbidden/);
        await assert.rejects(service.call(p, "P", "saveDraft", { ...edit, requestKey: "foreign" }), /not_found/);
      }
    }
    await assert.rejects(store.transaction(async () => {
      await save({ requestKey: "rollback", material: { name: "Must roll back" } });
      throw new Error("injected_after_save");
    }), /injected_after_save/);
    assert.equal((await store.list("p", "campaignDraft")).length, 1);
    assert.equal((await store.db.prepare("SELECT * FROM requests WHERE request_key=?").all("rollback")).length, 0);
    const retried = await save({ requestKey: "rollback", material: { name: "Must roll back" } });
    assert.equal(retried.revision, 1);
    // Draft records never enter the campaign/provider namespace. No port is called.
    let effects = 0;
    const denied = (): never => { effects++; throw new Error("unexpected_provider_effect"); };
    const port = { evidence: "provider" as const, verify: denied, plan: denied, prepare: denied,
      activate: denied, pause: denied, reconcile: denied, metrics: denied };
    const guarded = new MarketingServer(store, { meta: port, google: port, linkedin: port },
      { evidence: "generated", validate: denied, submit: denied, reconcile: denied }, { inspect: denied }, "live");
    await assert.rejects(guarded.call(f.principal, "p", "prepare", { campaignId: draft.id, requestKey: "prepare" }), /not_found/);
    await assert.rejects(guarded.call(f.principal, "p", "packet", { campaignId: draft.id }), /not_found/);
    await assert.rejects(guarded.call(f.principal, "p", "saveCampaign", { grantId: "absent", material: create.material as any }), /not_found/);
    await assert.rejects(guarded.call(f.principal, "p", "generate", { campaignId: draft.id, grantId: "absent", prompt: "x", rightsReceipt: "x", parentAssetIds: [], requestKey: "generate" }), /not_found/);
    assert.equal(effects, 0);
    assert.deepEqual(await store.list("p", "operation"), []);
    assert.deepEqual(await store.list("p", "job"), []);
  } finally { await store.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test("draft duplicate keys and competing revisions serialize across independent database connections", async () => {
  const f = await fixture();
  let other: Store | undefined;
  try {
    // SQLite transactions serialize within its single asynchronous Store owner.
    other = f.store.db.dialect === "sqlite" ? f.store : await testStore(f.path);
    const a = MarketingServer.unconnected(f.store), b = MarketingServer.unconnected(other);
    const input = { requestKey: "duplicate", material: { name: "Same request" } };
    const [first, second] = await Promise.all([a, b].map(s => s.call(f.principal, "p", "saveDraft", input)));
    assert.ok(first);
    assert.deepEqual(first, second);
    assert.equal((await f.store.list("p", "campaignDraft")).length, 1);
    const results = await Promise.allSettled([a, b].map((s, n) => s.call(f.principal, "p", "saveDraft", {
      id: first.id, expectedRevision: 1, requestKey: `edit-${n}`, material: { name: `Edit ${n}` },
    })));
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    assert.match(String((results.find(r => r.status === "rejected") as PromiseRejectedResult).reason), /revision_conflict/);
  } finally { if (other !== f.store) await other?.close(); await f.store.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test("trusted external identity binding uses stable IDs, no password, current project roles and disabled-user denial", async () => {
  const f = await fixture();
  try {
    const service = MarketingServer.unconnected(f.store);
    const identity = { issuer: "test-host", subject: "immutable-owner-id" };
    const owner = await f.store.bindExternalPrincipal("p", identity, "editor");
    const input = { requestKey: "external", material: { name: "Host-authenticated draft" } };
    const draft = await service.call(owner, "p", "saveDraft", input);
    const rebound = await f.store.bindExternalPrincipal("p", identity, "editor");
    assert.deepEqual(rebound, owner);
    assert.equal(await f.store.login(owner.userId, "", "external-login"), null);
    const otherIssuer = await f.store.bindExternalPrincipal("P", { ...identity, issuer: "other-host" }, "admin");
    assert.notEqual(otherIssuer.userId, owner.userId);
    await assert.rejects(service.call(otherIssuer, "p", "workspace", {}), /forbidden/);
    await f.store.bindExternalPrincipal("p", identity, "analyst");
    assert.deepEqual((await service.call(owner, "p", "workspace", {})).drafts, [draft]);
    await assert.rejects(service.call(owner, "p", "saveDraft", input), /forbidden/);
    await f.store.bindExternalPrincipal("p", identity, null);
    await assert.rejects(service.call(owner, "p", "workspace", {}), /forbidden/);
    await assert.rejects(f.store.bindExternalPrincipal("p", { ...identity, kind: "agent" }, "admin"), /external_identity_conflict/);
    await f.store.db.prepare("UPDATE users SET disabled=1 WHERE id=?").run(owner.userId);
    await f.store.bindExternalPrincipal("p", identity, "admin");
    await assert.rejects(service.call(owner, "p", "workspace", {}), /forbidden/);
  } finally { await f.store.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test("public HTTP client authenticates draft save/read/edit; session revocation denies replay", async () => {
  const f = await fixture();
  let host: Awaited<ReturnType<typeof createHost>> | undefined;
  try {
    host = await createHost({ store: f.store, service: MarketingServer.unconnected(f.store), origin: "http://127.0.0.1", staticDir: f.dir, version: "test-source" });
    await new Promise<void>(r => host!.server.listen(0, "127.0.0.1", r));
    const address = host.server.address(); assert.ok(address && typeof address !== "string");
    const root = `http://127.0.0.1:${address.port}`;
    const login = await fetch(root + "/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "alice", password: "" }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const client = createMarketingClient(root, "p", (url, init) => fetch(url, { ...init, headers: { ...init?.headers, cookie } }));
    const input = { requestKey: "http-create", material: { name: "HTTP document" } };
    await assert.rejects(createMarketingClient(root, "p").call("saveDraft", input), /authentication_required/);
    const draft = await client.call("saveDraft", input);
    const edited = await client.call("saveDraft", { ...input, requestKey: "http-edit", id: draft.id, expectedRevision: 1, material: { name: "HTTP revised" } });
    assert.deepEqual((await client.call("workspace", {})).drafts, [edited]);
    await f.store.revokeSession(cookie.slice(cookie.indexOf("=") + 1));
    await assert.rejects(client.call("saveDraft", input), /authentication_required/);
  } finally {
    if (host) { await new Promise<void>(r => host!.server.close(() => r())); await host.idle(); }
    await f.store.close(); rmSync(f.dir, { recursive: true, force: true });
  }
});
