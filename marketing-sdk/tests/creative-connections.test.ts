import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { CreativeConnections, type CreativeAccessPolicy } from "../server/creative-connections.js";
import { EncryptedCredentialCustody } from "../server/credential-custody.js";
import { createCredentialCipher } from "../support/vault-crypto.js";
import { BoundGenerationBilling } from "../server/billing.js";
import { NativeGeneration } from "../server/generation.js";
import { provision } from "../reference/provision.js";
import { testStore } from "./datastore.js";
import type { CreativeProvider, GenerationGrant, GenerationJob } from "../core/index.js";

const secret = "SYNTHETIC_CREATIVE_KEY_NOT_REAL";
function fields(html: string, action: string) {
  const form = [...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)].find(m => m[1]!.includes(`value="${action}"`))?.[1];
  assert.ok(form, `missing ${action} form`);
  return Object.fromEntries([...form.matchAll(/type="hidden" name="([^"]+)" value="([^"]*)"/g)].map(m => [m[1]!, m[2]!]));
}
async function fixture(provider: CreativeProvider = "openai") {
  const dir = await mkdtemp(join(tmpdir(), "creative-")), store = await testStore(join(dir, "store.sqlite"));
  await provision(store, { projects: [{ id: "p", name: "Synthetic project" }, { id: "q", name: "Other" }], users: [{ username: "human", password: "", memberships: [{ projectId: "p", role: "admin" }, { projectId: "q", role: "admin" }] }, { username: "other", password: "", memberships: [{ projectId: "p", role: "admin" }] }], accountGrants: [], generationGrants: [] });
  const token = (await store.login("human", "", "test"))!, otherToken = (await store.login("other", "", "test"))!;
  const principal = await store.authenticate(token);
  const key = randomBytes(32), cipher = createCredentialCipher("synthetic", () => key);
  let policy: CreativeAccessPolicy = { revision: "1", environment: "isolated-fixture", appLabel: "Synthetic Marketing", models: [provider === "openai" ? "gpt-image-1.5" : "grok-imagine-video-1.5"], maxDurationSeconds: 7200, grantIds: [] };
  let policyHook: (() => Promise<void>) | null = null, billingHook: (() => Promise<void>) | null = null, decryptions = 0;
  const custody = new EncryptedCredentialCustody(store, { ...cipher, decryptPayloadAsString(...args) { decryptions++; return cipher.decryptPayloadAsString(...args); } });
  const creative = new CreativeConnections({ store, environment: "isolated-fixture", custody, accessPolicy: async () => { await policyHook?.(); return policy; }, billing: { authorize: async () => { throw Error("reservation forbidden"); }, inspect: async () => { await billingHook?.(); return { state: "configured", currency: "USD", maxUnitMinor: 10, expiresAt: new Date(Date.now() + 3600000).toISOString() }; } } });
  const origin = "https://sdk.example", base = `/api/projects/p/creative/${provider}`;
  const routes = creative.routes({ origin, authenticate: r => store.authenticate(r.headers.get("x-session") || token) });
  const req = (path: string, body?: Record<string, string>, session = token, requestOrigin = origin) => routes(new Request(origin + path, { method: body ? "POST" : "GET", headers: { "x-session": session, origin: requestOrigin, "content-type": "application/x-www-form-urlencoded" }, ...(body ? { body: new URLSearchParams(body) } : {}) })).then(r => { assert.ok(r); return r; });
  const startInput = (extra = {}) => ({ requestKey: randomUUID(), model: policy.models[0]!, expiresAt: new Date(Date.now() + 1800000).toISOString(), sourceId: "", grantId: "", ...extra });
  const start = async (extra = {}) => { const input = startInput(extra), response = await req(base, input); assert.equal(response.status, 303); const path = response.headers.get("location")!; return { path, input, cid: path.split("/").at(-1)! }; };
  const approve = async (path: string) => { const html = await (await req(path)).text(), input = { ...fields(html, "approve"), consent: "approved", apiKey: secret }; const response = await req(path, input); assert.equal(response.status, 303); return input; };
  const grant = async (grantId = "independent") => { const g: GenerationGrant = { id: grantId, projectId: "p", provider, model: policy.models[0]!, kind: provider === "openai" ? "image" : "video", maxJobs: 2, usedJobs: 0, maxSeconds: 5, size: "1024x1024", expiresAt: new Date(Date.now() + 7200000).toISOString(), revokedAt: null, ceiling: { minor: 100, currency: "USD" }, billingCapabilityRef: "separate-billing" }; await store.put("p", "generationGrant", g.id, g); policy.grantIds.push(g.id); return g; };
  return { store, creative, custody, principal, origin, base, req, start, approve, startInput, grant, token, otherToken, dir, decryptions: () => decryptions, policy: () => policy, changePolicy: (p: CreativeAccessPolicy) => { policy = p; }, policyHook: (h: (() => Promise<void>) | null) => { policyHook = h; }, billingHook: (h: (() => Promise<void>) | null) => { billingHook = h; }, close: async () => { await store.close(); await rm(dir, { recursive: true, force: true }); } };
}
for (const provider of ["openai", "xai"] as const) test(`creative ${provider}: zero grants, isolated secure entry, harmless status, lost ack and local disconnect`, async () => {
  const f = await fixture(provider);
  try {
    const s = await f.start();
    assert.equal((await f.store.list("p", "generationGrant")).length, 0);
    const html = await (await f.req(s.path)).text();
    assert.ok(!html.includes("<script")); assert.match(html, /Purpose: (image|video)/);
    const missingConsent = { ...fields(html, "approve"), apiKey: secret };
    assert.equal((await f.req(s.path, missingConsent)).status, 409);
    assert.equal((await f.store.list("p", "vault")).length, 0);
    const approval = await f.approve(s.path);
    assert.equal((await f.req(s.path, { ...approval, apiKey: "SYNTHETIC_DIFFERENT_REPLAY" })).status, 303);
    assert.equal((await f.req(f.base, s.input)).headers.get("location"), s.path);
    const before = JSON.stringify(await f.store.db.prepare("SELECT * FROM records WHERE project_id=? ORDER BY kind,id").all("p"));
    const status = await f.creative.inspect(f.principal, "p", s.cid);
    assert.equal(status.credential, "configured"); assert.equal(status.providerVerification, "unverified"); assert.equal(status.paidOperation, "blocked");
    assert.equal(status.grantId, null); assert.equal(f.decryptions(), 0);
    assert.equal(JSON.stringify(await f.store.db.prepare("SELECT * FROM records WHERE project_id=? ORDER BY kind,id").all("p")), before);
    for (const kind of ["generationCostReservation", "generationJob", "grant", "generationGrant"]) assert.equal((await f.store.list("p", kind)).length, 0);
    const response = await f.req(s.path), page = await response.text();
    assert.match(response.headers.get("content-security-policy")!, /default-src 'none'/); assert.match(response.headers.get("cache-control")!, /no-store/);
    for (const text of [JSON.stringify(status), before, page, JSON.stringify(await f.store.db.prepare("SELECT * FROM outbox").all())]) assert.ok(!text.includes(secret) && !text.includes("SYNTHETIC_DIFFERENT_REPLAY"));
    await assert.rejects(f.creative.credentials(provider, "p"), /creative_generation_grant_required/);
    const disconnect = { ...fields(page, "disconnect"), consent: "approved" };
    assert.equal((await f.req(s.path, disconnect)).status, 303);
    assert.equal((await f.req(s.path, approval)).status, 409);
    assert.equal((await f.creative.inspect(f.principal, "p", s.cid)).credential, "revoked");
    assert.equal((await f.store.list<any>("p", "vault"))[0].encrypted.length > 0, true);
    const reconnect = await f.start(); assert.notEqual(reconnect.cid, s.cid);
  } finally { await f.close(); }
});
test("creative boundaries: project, provider, user, session, origin, agent, closed inputs and current revision", async () => {
  const f = await fixture();
  try {
    const s = await f.start(), html = await (await f.req(s.path)).text(), input = { ...fields(html, "approve"), consent: "approved", apiKey: secret };
    assert.equal((await f.req(s.path.replace('/p/', '/q/'), input)).status, 404);
    assert.equal((await f.req(s.path.replace('/openai/', '/xai/'), input)).status, 409);
    assert.equal((await f.req(s.path, input, f.otherToken)).status, 401);
    const newSession = (await f.store.login("human", "", "new"))!;
    assert.equal((await f.req(s.path, input, newSession)).status, 401);
    assert.equal((await f.req(s.path, input, f.token, "https://foreign.example")).status, 403);
    assert.equal((await f.req(s.path, { ...input, ready: "true" })).status, 409);
    assert.equal((await f.req(s.path, { ...input, revision: "88" })).status, 409);
    await f.store.db.prepare("UPDATE users SET kind='agent' WHERE id=?").run(f.principal.userId);
    assert.equal((await f.req(s.path, input)).status, 403);
    assert.equal((await f.store.list("p", "vault")).length, 0);
  } finally { await f.close(); }
});
test("creative independent grant and billing metadata, source reuse and source revocation", async () => {
  const f = await fixture();
  try {
    const g = await f.grant(), g2 = await f.grant("second");
    const s = await f.start({ grantId: g.id }); await f.approve(s.path);
    assert.equal(await f.creative.credentials("openai", "p", g.id), secret);
    const t = await f.start({ grantId: g2.id, sourceId: s.cid, expiresAt: new Date(Date.now() + 900000).toISOString() });
    const input = { ...fields(await (await f.req(t.path)).text(), "approve"), consent: "approved" };
    assert.equal((await f.req(t.path, input)).status, 303);
    assert.equal((await f.store.list("p", "vault")).length, 1);
    assert.equal(await f.creative.credentials("openai", "p", g2.id), secret);
    assert.equal((await f.creative.inspect(f.principal, "p", t.cid)).billing.state, "configured");
    assert.equal((await f.store.list("p", "generationCostReservation")).length, 0);
    await f.req(s.path, { ...fields(await (await f.req(s.path)).text(), "disconnect"), consent: "approved" });
    await assert.rejects(f.creative.credentials("openai", "p", g2.id), /creative_source_unavailable/);
    assert.equal((await f.creative.inspect(f.principal, "p", t.cid)).credential, "unavailable");
  } finally { await f.close(); }
});
test("creative cancellation and concurrent approval retain one original intent and fence stale replay", async () => {
  const f = await fixture();
  try {
    const s = await f.start(), page = await (await f.req(s.path)).text();
    const approve = { ...fields(page, "approve"), consent: "approved", apiKey: secret };
    const cancel = { ...fields(page, "cancel"), consent: "approved" };
    const responses = await Promise.all([f.req(s.path, cancel), f.req(s.path, approve)]);
    assert.equal(responses[0].status, 303); assert.equal(responses[1].status, 409);
    assert.equal((await f.creative.inspect(f.principal, "p", s.cid)).credential, "revoked");
    const fresh = await f.start(); const page2 = await (await f.req(fresh.path)).text();
    const input = { ...fields(page2, "approve"), consent: "approved", apiKey: secret };
    const pair = await Promise.all([f.req(fresh.path, input), f.req(fresh.path, input)]);
    assert.deepEqual(pair.map(r => r.status), [303, 303]);
    assert.equal((await f.store.list<any>("p", "creativeConnection")).filter(c => c.state === "configured").length, 1);
  } finally { await f.close(); }
});
test("creative changes after awaited custody write roll back secret and binding", async () => {
  const f = await fixture();
  try {
    const s = await f.start(), input = { ...fields(await (await f.req(s.path)).text(), "approve"), consent: "approved", apiKey: secret };
    const retain = f.custody.retain.bind(f.custody);
    f.custody.retain = async (...args) => { await retain(...args); f.changePolicy({ ...f.policy(), revision: "changed" }); };
    assert.equal((await f.req(s.path, input)).status, 409);
    assert.equal((await f.store.list("p", "vault")).length, 0);
    assert.equal((await f.store.get<any>("p", "creativeConnection", s.cid)).state, "review");
  } finally { await f.close(); }
});
test("creative status rechecks grant revocation after billing await and clears readiness", async () => {
  const f = await fixture();
  try {
    const g = await f.grant(), s = await f.start({ grantId: g.id }); await f.approve(s.path);
    f.billingHook(async () => { await f.store.put("p", "generationGrant", g.id, { ...g, revokedAt: new Date().toISOString() }); });
    const status = await f.creative.inspect(f.principal, "p", s.cid);
    assert.equal(status.credential, "unavailable"); assert.equal(status.credentialStored, true); assert.equal(status.generationAuthority, "revoked"); assert.equal(status.billing.state, "unavailable");
    await assert.rejects(f.creative.credentials("openai", "p", g.id), /creative_grant_unavailable/);
  } finally { await f.close(); }
});
test("creative status denies membership/logout during policy await; environment change and expiry block use", async () => {
  const f = await fixture();
  try {
    const s = await f.start(); await f.approve(s.path);
    f.changePolicy({ ...f.policy(), environment: "different" });
    assert.equal((await f.creative.inspect(f.principal, "p", s.cid)).credential, "unavailable");
    f.changePolicy({ ...f.policy(), environment: "isolated-fixture" });
    const c = await f.store.get<any>("p", "creativeConnection", s.cid);
    await f.store.put("p", "creativeConnection", c.id, { ...c, expiresAt: new Date(0).toISOString() });
    assert.equal((await f.creative.inspect(f.principal, "p", s.cid)).credential, "expired");
    f.policyHook(async () => { f.policyHook(null); await f.store.revokeSession(f.token); });
    await assert.rejects(f.creative.inspect(f.principal, "p", s.cid), /authentication_required/);
  } finally { await f.close(); }
});
test("BoundGenerationBilling harmless synthetic metadata inspection keeps exact matching and reservations untouched", async () => {
  const f = await fixture();
  try {
    const g = await f.grant(), path = join(f.dir, "synthetic-binding.json");
    await writeFile(path, JSON.stringify([{ projectId: "p", grantId: g.id, provider: g.provider, model: g.model, capabilityRef: g.billingCapabilityRef, apiKey: secret, expiresAt: g.expiresAt, currency: "USD", maxUnitMinor: 30, quoteReceipt: "SYNTHETIC_QUOTE" }]));
    const billing = new BoundGenerationBilling(f.store, path);
    const safe = await billing.inspect(g); assert.equal(safe.state, "configured"); assert.ok(!JSON.stringify(safe).includes(secret));
    for (const changed of [{ ...g, projectId: "q" }, { ...g, id: "wrong" }, { ...g, provider: "xai" as const }, { ...g, model: "wrong" }, { ...g, billingCapabilityRef: "wrong" }, { ...g, ceiling: { minor: 100, currency: "EUR" } }, { ...g, revokedAt: new Date().toISOString() }]) assert.equal((await billing.inspect(changed)).state, "unavailable");
    assert.equal((await f.store.list("p", "generationCostReservation")).length, 0);
  } finally { await f.close(); }
});
test("creative credentials recheck authority after decryption await without releasing the key", async () => {
  const f = await fixture();
  try {
    const g = await f.grant(), s = await f.start({ grantId: g.id }); await f.approve(s.path);
    const read = f.custody.read.bind(f.custody);
    f.custody.read = async <T>(...args: [string, string]) => { const value = await read<T>(...args); await f.store.revokeSession(f.token); return value; };
    await assert.rejects(f.creative.credentials("openai", "p", g.id), /authentication_required/);
  } finally { await f.close(); }
});
test("creative human membership changes during policy await cannot approve or return status", async () => {
  const f = await fixture();
  try {
    const s = await f.start(), input = { ...fields(await (await f.req(s.path)).text(), "approve"), consent: "approved", apiKey: secret };
    f.policyHook(async () => { f.policyHook(null); await f.store.db.prepare("UPDATE memberships SET role='analyst' WHERE project_id=? AND user_id=?").run("p", f.principal.userId); });
    assert.equal((await f.req(s.path, input)).status, 403);
    assert.equal((await f.store.list("p", "vault")).length, 0);
    await assert.rejects(f.creative.inspect(f.principal, "p", s.cid), /forbidden/);
  } finally { await f.close(); }
});
test("creative original start payload, competing intent and review expiry are fenced", async () => {
  const f = await fixture();
  try {
    const s = await f.start();
    assert.equal((await f.req(f.base, { ...s.input, expiresAt: new Date(Date.now() + 10000).toISOString() })).status, 409);
    assert.equal((await f.req(f.base, f.startInput())).status, 409);
    const approval = { ...fields(await (await f.req(s.path)).text(), "approve"), consent: "approved", apiKey: secret };
    const c = await f.store.get<any>("p", "creativeConnection", s.cid);
    await f.store.put("p", "creativeConnection", c.id, { ...c, reviewExpiresAt: new Date(0).toISOString() });
    assert.equal((await f.req(s.path, approval)).status, 409);
    const status = await f.creative.inspect(f.principal, "p", s.cid);
    assert.equal(status.credential, "expired"); assert.match(status.reasons[0]!, /Cancel the saved setup/);
    assert.equal((await f.store.list("p", "vault")).length, 0);
  } finally { await f.close(); }
});
test("billing metadata can be configured independently of mounted API keys", async () => {
  const f = await fixture();
  try {
    const g = await f.grant(), path = join(f.dir, "metadata-only.json");
    await writeFile(path, JSON.stringify([{ projectId: "p", grantId: g.id, provider: g.provider, model: g.model, capabilityRef: g.billingCapabilityRef, expiresAt: g.expiresAt, currency: "USD", maxUnitMinor: 10, quoteReceipt: "SYNTHETIC_QUOTE" }]));
    const billing = new BoundGenerationBilling(f.store, path);
    assert.equal((await billing.inspect(g)).state, "configured");
    await assert.rejects(billing.credentials("openai", "p", g.id), /generation_credential_binding_missing/);
    assert.equal((await f.store.list("p", "generationCostReservation")).length, 0);
  } finally { await f.close(); }
});
test("creative external host session is revalidated after custody await and rolls back on logout", async () => {
  const f = await fixture();
  try {
    let session: string | null = "SYNTHETIC_HOST_SESSION_REF";
    const p = { userId: f.principal.userId, externalSessionRef: session };
    const adapter = new CreativeConnections({ ...f.creative.options, sessions: { current: async () => session } });
    const routes = adapter.routes({ origin: f.origin, authenticate: async () => p });
    const post = (path: string, input: Record<string, string>) => routes(new Request(f.origin + path, { method: "POST", headers: { origin: f.origin, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(input) }));
    const started = await post(f.base, f.startInput()); assert.equal(started!.status, 303);
    const path = started!.headers.get("location")!;
    const page = await (await routes(new Request(f.origin + path)))!.text();
    const retain = f.custody.retain.bind(f.custody);
    f.custody.retain = async (...args) => { await retain(...args); session = null; };
    const response = await post(path, { ...fields(page, "approve"), consent: "approved", apiKey: secret });
    assert.equal(response!.status, 401); assert.equal((await f.store.list("p", "vault")).length, 0);
  } finally { await f.close(); }
});
test("creative null policy permits exact owner disconnect but never new setup or secret use; environment is host-bound", async () => {
  const f = await fixture();
  try {
    const s = await f.start(); await f.approve(s.path);
    const absent = new CreativeConnections({ ...f.creative.options, accessPolicy: async () => null });
    const routes = absent.routes({ origin: f.origin, authenticate: async () => f.principal });
    const page = await (await routes(new Request(f.origin + s.path)))!.text();
    assert.match(page, /Disconnect local access/); assert.ok(!page.includes('name="apiKey"'));
    const c = await absent.catalogue(f.principal, "p", "openai"); assert.equal(c.configured, false); assert.equal(c.bindings.length, 1);
    const foreign = new CreativeConnections({ ...f.creative.options, environment: "other-environment" });
    await assert.rejects(foreign.inspect(f.principal, "p", s.cid), /forbidden/);
    const response = await routes(new Request(f.origin + s.path, { method: "POST", headers: { origin: f.origin, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...fields(page, "disconnect"), consent: "approved" }) }));
    assert.equal(response!.status, 303); assert.equal((await f.creative.inspect(f.principal, "p", s.cid)).credentialStored, true);
  } finally { await f.close(); }
});

test("review: consent expiring during custody await rolls back the encrypted write", async t => {
  const f = await fixture();
  try {
    const s = await f.start(), input = { ...fields(await (await f.req(s.path)).text(), "approve"), consent: "approved", apiKey: secret };
    const retain = f.custody.retain.bind(f.custody);
    f.custody.retain = async (...args) => { await retain(...args); t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 601000 }); };
    assert.equal((await f.req(s.path, input)).status, 409);
    assert.equal((await f.store.list("p", "vault")).length, 0);
    assert.equal((await f.store.get<any>("p", "creativeConnection", s.cid)).state, "review");
  } finally { t.mock.timers.reset(); await f.close(); }
});

test("review: reuse refuses missing custody and source revocation during the final policy await", async () => {
  const f = await fixture();
  try {
    const s = await f.start(); await f.approve(s.path);
    const input = f.startInput({ sourceId: s.cid, expiresAt: new Date(Date.now() + 900000).toISOString() });
    const raw = await f.store.get<any>("p", "creativeConnection", s.cid);
    const inspect = f.custody.inspect.bind(f.custody);
    f.custody.inspect = async () => false;
    assert.equal((await f.req(f.base, input)).status, 409);
    f.custody.inspect = inspect;
    let checks = 0;
    f.policyHook(async () => {
      if (++checks === 4) await f.store.put("p", "creativeConnection", s.cid, { ...raw, revision: raw.revision + 1, state: "revoked" }, raw.revision);
    });
    assert.equal((await f.req(f.base, input)).status, 409);
    assert.equal((await f.store.list("p", "creativeConnection")).length, 1);
  } finally { await f.close(); }
});

test("review: late retention inspection cannot return stale configured source status", async () => {
  const f = await fixture();
  try {
    const s = await f.start(); await f.approve(s.path);
    const r = await f.start({ sourceId: s.cid, expiresAt: new Date(Date.now() + 900000).toISOString() });
    assert.equal((await f.req(r.path, { ...fields(await (await f.req(r.path)).text(), "approve"), consent: "approved" })).status, 303);
    const inspect = f.custody.inspect.bind(f.custody);
    let checks = 0;
    f.custody.inspect = async (...args) => {
      const result = await inspect(...args);
      if (++checks === 5) {
        const raw = await f.store.get<any>("p", "creativeConnection", s.cid);
        await f.store.put("p", "creativeConnection", s.cid, { ...raw, revision: raw.revision + 1, state: "revoked" }, raw.revision);
      }
      return result;
    };
    const status = await f.creative.inspect(f.principal, "p", r.cid);
    assert.equal(status.credential, "unavailable"); assert.equal(status.credentialStored, true);
  } finally { await f.close(); }
});

test("review: HTTP boundary rejects unsafe origins/returns, methods, queries, duplicate fields and oversized bodies", async () => {
  const f = await fixture();
  try {
    const config = { origin: f.origin, authenticate: async () => f.principal };
    for (const returnPath of ["//foreign.example", "/\t/foreign.example", "/\\foreign.example", "/\n/foreign.example"])
      assert.throws(() => f.creative.routes({ ...config, returnPath }), /creative_return_invalid/);
    assert.throws(() => f.creative.routes({ ...config, origin: "ftp://127.0.0.1" }), /creative_origin_invalid/);
    const route = f.creative.routes(config), s = await f.start();
    const approval = { ...fields(await (await f.req(s.path)).text(), "approve"), consent: "approved", apiKey: secret };
    const requests: [Request, number][] = [
      [new Request(f.origin + s.path, { method: "PUT" }), 405],
      [new Request(f.origin + s.path + "?apiKey=SYNTHETIC"), 403],
      [new Request(f.origin + s.path, { headers: { "sec-fetch-site": "cross-site" } }), 403],
      [new Request(f.origin + s.path, { method: "POST", headers: { origin: f.origin, "content-type": "application/json" }, body: "{}" }), 403],
      [new Request(f.origin + s.path, { method: "POST", headers: { origin: f.origin, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(approval) + "&consent=approved" }), 409],
      [new Request(f.origin + s.path, { method: "POST", headers: { origin: f.origin, "content-type": "application/x-www-form-urlencoded" }, body: "apiKey=" + "x".repeat(16385) }), 413],
    ];
    for (const [request, expected] of requests) {
      const response = (await route(request))!; assert.equal(response.status, expected);
      assert.match(response.headers.get("cache-control")!, /no-store/);
      assert.match(response.headers.get("content-security-policy")!, /frame-ancestors 'none'/);
      assert.ok(!(await response.text()).includes(secret));
    }
    const navigation = (await route(new Request(f.origin + s.path, { method: "POST", headers: { origin: f.origin, "sec-fetch-mode": "navigate", "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...approval, apiKey: "SYNTHETIC INVALID KEY" }) })))!;
    assert.equal(navigation.status, 303);
    assert.equal(navigation.headers.get("location"), s.path + "?notice=key-format");
    const notice = (await route(new Request(f.origin + navigation.headers.get("location"))))!;
    assert.equal(notice.status, 200); assert.match(await notice.text(), /without whitespace/);
    assert.equal((await route(new Request(f.origin + s.path + "?notice=" + secret)))!.status, 403);
    assert.equal((await f.store.list("p", "vault")).length, 0);
  } finally { await f.close(); }
});

test("review: disconnect preserves ciphertext, unrelated grants and unknown paid reservations", async () => {
  const f = await fixture();
  try {
    const g = await f.grant(), s = await f.start({ grantId: g.id }); await f.approve(s.path);
    await f.store.put("p", "generationJob", "unknown", { id: "unknown", state: "unknown", grantId: g.id });
    await f.store.put("p", "generationCostReservation", "unknown", { jobId: "unknown", grantId: g.id, minor: 10 });
    const before = await Promise.all(["vault", "generationGrant", "generationJob", "generationCostReservation"].map(k => f.store.list("p", k)));
    assert.equal((await f.req(s.path, { ...fields(await (await f.req(s.path)).text(), "disconnect"), consent: "approved" })).status, 303);
    assert.deepEqual(await Promise.all(["vault", "generationGrant", "generationJob", "generationCostReservation"].map(k => f.store.list("p", k))), before);
    await assert.rejects(f.creative.credentials("openai", "p", g.id), /creative_credential_binding_ambiguous/);
    assert.equal((await f.req(s.path, undefined, f.otherToken)).status, 403);
  } finally { await f.close(); }
});

for (const provider of ["openai", "xai"] as const) for (const change of ["disconnect", "policy", "session"] as const)
test(`review: ${provider} ${change} during executor await fences credential use without releasing reserved spend`, async () => {
  const f = await fixture(provider);
  try {
    const g = await f.grant();
    if (provider === "xai") { g.size = "1280x720"; await f.store.put("p", "generationGrant", g.id, g); }
    const s = await f.start({ grantId: g.id }); await f.approve(s.path);
    const disconnect = { ...fields(await (await f.req(s.path)).text(), "disconnect"), consent: "approved" };
    const path = join(f.dir, "billing.json");
    await writeFile(path, JSON.stringify([{ projectId: "p", grantId: g.id, provider, model: g.model, capabilityRef: g.billingCapabilityRef, expiresAt: g.expiresAt, currency: "USD", maxUnitMinor: 10, quoteReceipt: "SYNTHETIC_QUOTE" }]));
    let providerCalls = 0, credentialCalls = 0;
    const generation = new NativeGeneration(async (...args) => { credentialCalls++; return f.creative.credentials(...args); }, new BoundGenerationBilling(f.store, path),
      async () => { providerCalls++; throw Error("Provider transport forbidden"); },
      (...args) => f.creative.assertCredentialAccess(...args));
    const job: GenerationJob = { id: "reserved", projectId: "p", campaignId: "synthetic", grantId: g.id, kind: g.kind, prompt: "Synthetic", promptDigest: "synthetic", parentAssetIds: [], rightsReceipt: "synthetic", state: "running", providerRequestId: null, assetId: null, reason: null, createdAt: new Date().toISOString() };
    await assert.rejects(generation.submit(job, g, async () => { throw Error("No provider receipt expected"); }, async () => {
      if (change === "disconnect") assert.equal((await f.req(s.path, disconnect)).status, 303);
      if (change === "policy") f.changePolicy({ ...f.policy(), revision: "revoked" });
      if (change === "session") await f.store.revokeSession(f.token);
    }), /creative_|authentication_required/);
    assert.equal(credentialCalls, 1); assert.equal(f.decryptions(), 1); assert.equal(providerCalls, 0);
    assert.equal((await f.store.list("p", "generationCostReservation")).length, 1);
    assert.equal((await f.store.list("p", "vault")).length, 1);
  } finally { await f.close(); }
});


test("review: malformed host inventory cannot turn substring matching into grant authority", async () => {
  const f = await fixture();
  try {
    const g = await f.grant();
    f.changePolicy({ ...f.policy(), grantIds: `prefix-${g.id}-suffix` as any });
    assert.equal((await f.req(f.base, f.startInput({ grantId: g.id }))).status, 409);
    assert.equal((await f.store.list("p", "creativeConnection")).length, 0);
    assert.equal((await f.store.list("p", "vault")).length, 0);
  } finally { await f.close(); }
});
