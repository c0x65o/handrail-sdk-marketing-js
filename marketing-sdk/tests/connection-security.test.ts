import test from "node:test";
import assert from "node:assert/strict";
import { connectionFixture } from "./connection-fixture.js";
import { createConnections } from "../server/index.js";

test("C07/C09/C15: two-user/project isolation; foreign callback and raw fields cannot assert authority", async () => {
  const f = await connectionFixture();
  try {
    const a = await f.authorize(await f.start());
    const foreign = await f.completeCallback(a.callbackUrl, f.bobToken);
    assert.equal(foreign!.status, 401); assert.equal(f.calls.length, 0);
    await f.completeCallback(a.callbackUrl);
    const c = await f.call("discoverConnectionAccounts", f.change(await f.call("connection", { connectionId: a.c.id })));
    const bobView = await f.server.call(f.bobPrincipal, "p", "connection", { connectionId: c.id });
    assert.equal(bobView.discovery.accounts.length, 0); assert.equal(bobView.account, null); assert.equal(bobView.accessReview, null);
    await assert.rejects(f.server.call(f.bobPrincipal, "p", "selectConnectionAccount", { ...f.change(c), choiceRef: c.discovery.accounts[0]!.choiceRef }), /connection_session_changed/);
    await assert.rejects(f.server.call(f.principal, "other", "connection", { connectionId: c.id }), /forbidden|session_authority_changed|host_session_authority_required/);
    await assert.rejects(f.call("selectConnectionAccount", { ...f.change(c), choiceRef: c.discovery.accounts[0]!.choiceRef, ready: true } as any), /unknown_field|unexpected|invalid/i);
  } finally { await f.close(); }
});
for (const change of ["membership", "session", "configuration"] as const) test(`C07/C15: ${change} change during discovery discloses no late accounts and commits no grant`, async () => {
  const f = await connectionFixture();
  try {
    const a = await f.authorize(await f.start()); await f.completeCallback(a.callbackUrl); const c = await f.call("connection", { connectionId: a.c.id });
    let changed = false;
    f.boundary(async url => { if (!url.pathname.endsWith("/me/adaccounts") || changed) return; changed = true;
      if (change === "membership") await f.store.db.prepare("DELETE FROM memberships WHERE user_id=? AND project_id=?").run(f.alice, "p");
      if (change === "session") await f.store.revokeSession(f.aliceToken);
      if (change === "configuration") f.policy({ ...f.currentPolicy(), revision: "2" });
    });
    await assert.rejects(f.call("discoverConnectionAccounts", f.change(c)), /forbidden|authentication_required|configuration_changed/);
    assert.equal((await f.store.list("p", "grant")).length, 0);
    const raw = await f.store.get<any>("p", "connection", c.id); assert.equal(raw.view.discovery.accounts.length, 0);
  } finally { await f.close(); }
});
test("C15: external sessions require an original opaque reference, and logout after await is fenced", async () => {
  const f = await connectionFixture();
  try {
    let current: string | null = "host-session-one";
    const connections = createConnections({ store: f.store, custody: f.custody, accessPolicy: async () => f.currentPolicy(), sessions: { current: async () => current }, evidence: "fixture" });
    const p = { userId: f.alice, externalSessionRef: "host-session-one" };
    assert.equal((await connections.call({ userId: f.alice }, "p", "connections", {})).providers[0]!.configured, false);
    await assert.rejects(connections.call(p, "p", "startConnection", { provider: { kind: "advertising", provider: "meta" }, intent: { kind: "advertising", operations: ["setup", "report"] }, expiresAt: new Date(Date.now() + 3600000).toISOString(), offlineAccess: false, requestKey: "external" }), /host_session_authority_required/);
    // The former current() adapter is insufficient for a revocation-coordinated
    // commit. Full external-host proof is in portable-handoff.test.ts.

  } finally { await f.close(); }
});
test("C08/C12: failed consumed-code exchange stays unknown; original callbacks never replay and reconciliation requires fresh consent", async () => {
  const f = await connectionFixture();
  try {
    const a = await f.authorize(await f.start()); f.failExchange();
    const response = await f.completeCallback(a.callbackUrl); assert.equal(response!.status, 200);
    let c = await f.call("connection", { connectionId: a.c.id }); assert.equal(c.phase, "outcome_unknown");
    await f.completeCallback(a.callbackUrl); assert.equal(f.calls.length, 1);
    await assert.rejects(f.call("beginConnectionHandoff", f.change(c)), /provider_access_decision_required/);
    c = await f.call("reconcileConnection", f.change(c)); assert.equal(c.phase, "needs_reauthorization");
    assert.ok(!JSON.stringify(c).includes("DO_NOT_EXPOSE")); assert.equal((await f.store.list("p", "grant")).length, 0);
  } finally { await f.close(); }
});
test("C08/C15: logout during exchange retains only restricted encrypted outcome; current authorization required for recovery", async () => {
  const f = await connectionFixture();
  try {
    const a = await f.authorize(await f.start());
    f.boundary(async url => { if (url.pathname.endsWith("/oauth/access_token")) await f.store.revokeSession(f.aliceToken); });
    await f.completeCallback(a.callbackUrl);
    assert.equal((await f.store.list("p", "grant")).length, 0);
    const callbacks = await f.store.list<any>("p", "connectionCallback"); assert.equal(callbacks[0].status, "received");
    const vault = await f.store.list("p", "vault"); assert.ok(!JSON.stringify(vault).includes("SYNTHETIC_ACCESS_TOKEN"));
    await assert.rejects(f.call("connection", { connectionId: a.c.id }), /authentication_required/);
    const token = await f.store.login("alice", "", "new-session"), replacement = await f.store.authenticate(token!);
    await assert.rejects(f.server.call(replacement, "p", "reconcileConnection", f.change(a.c)), /revision_conflict|connection_session_changed|authentication_required/);
  } finally { await f.close(); }
});
test("C09/C12: cancellation during account read fences result; repeated requests cannot dispatch again", async () => {
  const f = await connectionFixture();
  try {
    const a = await f.authorize(await f.start()); await f.completeCallback(a.callbackUrl);
    let c = await f.call("connection", { connectionId: a.c.id }); const input = f.change(c); let cancelled = false;
    f.boundary(async url => {
      if (!url.pathname.endsWith("/me/adaccounts") || cancelled) return; cancelled = true;
      const pending = await f.call("connection", { connectionId: c.id }); await f.call("cancelConnection", f.change(pending));
    });
    c = await f.call("discoverConnectionAccounts", input); assert.equal(c.phase, "cancelling"); assert.equal(c.discovery.accounts.length, 0);
    const count = f.calls.length; await f.call("discoverConnectionAccounts", input); assert.equal(f.calls.length, count);
    c = await f.call("reconcileConnection", f.change(c)); assert.equal(c.phase, "cancelled");
    assert.equal((await f.store.list("p", "grant")).length, 0);
  } finally { await f.close(); }
});
test("C07/C12/C14: concurrent verify and account changes are CAS fenced; permission loss prevents final Grant", async () => {
  const f = await connectionFixture();
  try {
    const c = await f.approved(); const input = f.change(c);
    let changed = false;
    f.boundary(async url => { if (!url.pathname.endsWith("/me/adaccounts") || changed) return; changed = true;
      await f.store.db.prepare("UPDATE memberships SET role=? WHERE user_id=? AND project_id=?").run("analyst", f.alice, "p");
    });
    await assert.rejects(f.call("resumeConnection", input), /forbidden|session_authority_changed|host_session_authority_required/);
    await assert.rejects(f.call("resumeConnection", input), /forbidden|session_authority_changed|host_session_authority_required/);
    assert.equal((await f.store.list("p", "grant")).length, 0);
  } finally { await f.close(); }
});
test("C07/C13: Agent cannot approve either human decision; configuration and scope edits invalidate prior reviews", async () => {
  const f = await connectionFixture();
  try {
    let c = await f.start(); c = await f.call("reviewConnectionProviderAccess", f.change(c));
    const agent = (await f.store.db.prepare("SELECT id FROM users WHERE kind='agent'").get())!;
    const r = c.accessReview!;
    await assert.rejects(f.server.call({ userId: String(agent.id) }, "p", "decideConnectionProviderAccess", { ...f.change(c), decisionRef: r.decisionRef, digest: r.digest, decision: "approved" }), /forbidden|session_authority_changed|host_session_authority_required/);
    f.policy({ ...f.currentPolicy(), allowedOAuthScopes: [] });
    await assert.rejects(f.call("decideConnectionProviderAccess", { ...f.change(c), decisionRef: r.decisionRef, digest: r.digest, decision: "approved" }), /configuration_changed/);
    assert.equal(f.calls.length, 0);
  } finally { await f.close(); }
});
test("C08: safe verification failure retains selection and retries only reads; changing account clears approvals", async () => {
  const f = await connectionFixture();
  try {
    let c = await f.approved(); f.failRead(true); c = await f.call("resumeConnection", f.change(c));
    assert.equal(c.phase, "failed_retryable"); assert.ok(c.account); assert.equal(c.grantId, null);
    assert.ok(!JSON.stringify(c).includes("DO_NOT_EXPOSE")); f.failRead(false);
    c = await f.call("discoverConnectionAccounts", f.change(c)); assert.equal(c.consented.status, "not_checked");
    await assert.rejects(f.call("resumeConnection", f.change(c)), /project_access_decision_required/);
    assert.equal(f.calls.filter(p => p.endsWith("/oauth/access_token")).length, 1);
  } finally { await f.close(); }
});
test("C09/C15: explicit new-session takeover invalidates an unconsumed old callback and requires new human consent", async () => {
  const f = await connectionFixture();
  try {
    const a = await f.authorize(await f.start());
    const current = await f.call("connection", { connectionId: a.c.id });
    const next = await f.server.call(f.bobPrincipal, "p", "reassignConnection", f.change(current));
    assert.equal(next.phase, "requirements"); assert.equal(next.providerAuthorized.status, "not_checked");
    await f.completeCallback(a.callbackUrl); assert.equal(f.calls.length, 0);
    assert.equal((await f.store.list("p", "grant")).length, 0);
  } finally { await f.close(); }
});
test("C12/C14: simultaneous exact approvals and same verification retries produce one real grant", async () => {
  const f = await connectionFixture();
  try {
    const c = await f.approved(), input = f.change(c);
    const results = await Promise.all([f.call("resumeConnection", input), f.call("resumeConnection", input)]);
    assert.ok(results.some(v => v.phase === "verified"));
    assert.equal((await f.store.list("p", "grant")).length, 1);
    const current = await f.call("connection", { connectionId: c.id }); assert.equal(current.phase, "verified");
    assert.equal(f.calls.filter(p => p.endsWith("/oauth/access_token")).length, 1);
  } finally { await f.close(); }
});
test("C07/C14: account/identity context changed at verification cannot create a grant", async () => {
  const f = await connectionFixture("meta", true);
  try {
    const c = await f.approved();
    // Native HTTP boundary changes, not a fake persistence layer or a provisional Grant.
    const original = f.connections.discovery.fetcher;
    const discovery = f.connections.discovery as { fetcher: typeof fetch };
    discovery.fetcher = async (url, init) => {
      const response = await original(url, init);
      if (String(url).includes('/promote_pages')) return Response.json({ data: [{ id: "999", name: "FIXTURE Different Page" }] });
      return response;
    };
    const result = await f.call("resumeConnection", f.change(c));
    assert.equal(result.phase, "failed_retryable"); assert.equal(result.checkpoint, "provider_identity_mismatch");
    assert.equal((await f.store.list("p", "grant")).length, 0);
  } finally { await f.close(); }
});
test("C08/C12: reconstructing the service from persisted receipts recovers a lost callback response without code replay", async () => {
  const f = await connectionFixture();
  try {
    const a = await f.authorize(await f.start()); await f.completeCallback(a.callbackUrl);
    const restarted = createConnections({ ...f.connections.options });
    const routes = restarted.routes({ origin: f.custody.origin, authenticate: async () => f.principal });
    await routes(new Request(a.callbackUrl));
    const c = await restarted.call(f.principal, "p", "connection", { connectionId: a.c.id });
    assert.equal(c.phase, "choosing_account"); assert.equal(f.calls.filter(p => p.endsWith('/oauth/access_token')).length, 1);
  } finally { await f.close(); }
});
test("C12/C15: another current human administrator can revoke project access without inheriting creator credentials", async () => {
  const f = await connectionFixture();
  try {
    let c = await f.call("resumeConnection", f.change(await f.approved()));
    c = await f.server.call(f.bobPrincipal, "p", "reviewConnectionRevocation", f.change(c));
    assert.ok(c.accessReview); assert.equal(c.discovery.accounts.length, 0);
    const r = c.accessReview!;
    c = await f.server.call(f.bobPrincipal, "p", "decideConnectionRevocation", { ...f.change(c), decisionRef: r.decisionRef, digest: r.digest, decision: "approved" });
    assert.equal(c.consented.status, "revoked");
  } finally { await f.close(); }
});
test("C08/C13: expired unconsumed handoff requires a fresh exact decision and fences the original callback", async t => {
  const f = await connectionFixture();
  try {
    const a = await f.authorize(await f.start());
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 301000 });
    let c = await f.call("connection", { connectionId: a.c.id }); assert.equal(c.phase, "reviewing_provider_access"); assert.equal(c.handoffPath, null);
    const renewed = await f.authorize(c);
    await f.completeCallback(a.callbackUrl); assert.equal(f.calls.length, 0);
    await f.completeCallback(renewed.callbackUrl);
    c = await f.call("connection", { connectionId: a.c.id }); assert.equal(c.phase, "choosing_account");
  } finally { t.mock.timers.reset(); await f.close(); }
});
test("C07/C15: credential expiry during an awaited provider read rejects late results independently of project expiry", async t => {
  const f = await connectionFixture();
  try {
    f.tokenLifetime(30);
    const a = await f.authorize(await f.start()); await f.completeCallback(a.callbackUrl);
    const c = await f.call("connection", { connectionId: a.c.id });
    f.boundary(async url => { if (url.pathname.endsWith('/me/adaccounts')) t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 31000 }); });
    await assert.rejects(f.call('discoverConnectionAccounts', f.change(c)), /provider_access_expired_or_denied/);
    const current = await f.call('connection', { connectionId: c.id });
    assert.equal(current.phase, 'needs_reauthorization'); assert.equal(current.discovery.accounts.length, 0);
    assert.equal((await f.store.list('p', 'grant')).length, 0);
  } finally { t.mock.timers.reset(); await f.close(); }
});
test("C08/C12: reconciliation of an old received callback cannot rewind binding or a verified connection", async () => {
  const f = await connectionFixture();
  try {
    let c = await f.approved(); c = await f.call('reconcileConnection', f.change(c));
    assert.equal(c.phase, 'verifying');
    c = await f.call('resumeConnection', f.change(c)); assert.equal(c.phase, 'verified');
    c = await f.call('reconcileConnection', f.change(c)); assert.equal(c.phase, 'verified');
    assert.equal((await f.store.list('p', 'grant')).length, 1);
  } finally { await f.close(); }
});

test("review: role downgrade during a status policy await cannot disclose prior private choices", async () => {
  const f = await connectionFixture();
  try {
    const c = await f.discovered(); let changed = false;
    const connections = createConnections({ ...f.connections.options, accessPolicy: async () => {
      if (!changed) { changed = true; await f.store.db.prepare("UPDATE memberships SET role='analyst' WHERE user_id=? AND project_id='p'").run(f.alice); }
      return f.currentPolicy();
    } });
    await assert.rejects(connections.call(f.principal, "p", "connection", { connectionId: c.id }), /connection_authority_changed/);
    const restricted = await connections.call(f.principal, "p", "connection", { connectionId: c.id });
    assert.deepEqual(restricted.discovery.accounts, []);
  } finally { await f.close(); }
});

test("review: an expired unknown exchange cannot be bypassed by a new start key", async t => {
  const f = await connectionFixture();
  try {
    const a = await f.authorize(await f.start()); f.failExchange(); await f.completeCallback(a.callbackUrl);
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 3601000 });
    await assert.rejects(f.start(), /unresolved_connection_exists/);
    let c = await f.call("connection", { connectionId: a.c.id });
    c = await f.call("reconcileConnection", f.change(c)); assert.equal(c.phase, "needs_reauthorization");
    assert.equal((await f.store.list("p", "grant")).length, 0);
    assert.equal(f.calls.length, 1);
  } finally { t.mock.timers.reset(); await f.close(); }
});

test("review: absent grant-maker policy issues no OAuth access", async () => {
  const f = await connectionFixture();
  try {
    const connections = createConnections({ store: f.store, custody: f.custody, evidence: "fixture" });
    const catalogue = await connections.call(f.principal, "p", "connections", {});
    assert.equal(catalogue.providers[0]!.configured, false);
    const c = await connections.call(f.principal, "p", "startConnection", { provider: { kind: "advertising", provider: "meta" }, intent: { kind: "advertising", operations: ["setup", "report"] }, expiresAt: new Date(Date.now() + 3600000).toISOString(), offlineAccess: false, requestKey: "no-policy" });
    assert.equal(c.phase, "blocked");
    await assert.rejects(connections.call(f.principal, "p", "reviewConnectionProviderAccess", f.change(c)), /connection_transition_denied/);
    assert.equal(f.calls.length, 0);
  } finally { await f.close(); }
});

test("review: LinkedIn publishing cannot request new consent with an incomplete discovery scope bundle", async () => {
  const f = await connectionFixture("linkedin", true);
  try { delete f.custody.apps.linkedin!.linkedinAdvertising; const c = await f.start(); assert.equal(c.phase, "blocked"); await assert.rejects(f.call("reviewConnectionProviderAccess", f.change(c)), /linkedin_app_capability_missing|connection_transition_denied/); assert.equal(f.calls.length, 0); }
  finally { await f.close(); }
});

test("review: direct Google campaign account skips an empty manager picker", async () => {
  const f = await connectionFixture("google", true);
  try {
    const discovery = f.connections.discovery as { fetcher: typeof fetch }, original = discovery.fetcher;
    discovery.fetcher = async (url, init) => String(url).endsWith('customers:listAccessibleCustomers')
      ? Response.json({ resourceNames: ['customers/2041'] }) : original(url, init);
    const c = await f.selected(); assert.equal(c.phase, 'reviewing_access'); assert.deepEqual(c.identities, []);
  } finally { await f.close(); }
});

test("review: grant revocation while status policy yields cannot return stale ready evidence", async () => {
  const f = await connectionFixture();
  try {
    const c = await f.call('resumeConnection', f.change(await f.approved())); let changed = false;
    const service = createConnections({ ...f.connections.options, accessPolicy: async () => {
      if (!changed) {
        changed = true; const g = await f.store.get<any>('p', 'grant', c.grantId!);
        await f.store.put('p', 'grant', g.id, { ...g, revision: g.revision + 1, revokedAt: new Date().toISOString() }, g.revision);
      }
      return f.currentPolicy();
    } });
    const result = await service.call(f.principal, 'p', 'connection', { connectionId: c.id });
    assert.equal(result.consented.status, 'revoked'); assert.equal(result.phase, 'needs_reauthorization');
    assert.ok(result.readiness.every(x => !x.ready));
  } finally { await f.close(); }
});
