import test from "node:test";
import assert from "node:assert/strict";
import { connectionFixture } from "./connection-fixture.js";
import type { Grant, Provider } from "../core/index.js";

test("C01/C02/C06: zero-grant catalogue, creative contract blocker and manual operation without Agent", async () => {
  const f = await connectionFixture();
  try {
    const catalogue = await f.call("connections", {});
    assert.deepEqual(catalogue.providers.map(p => p.provider.provider), ["meta", "google", "linkedin", "openai", "xai"]);
    assert.equal(catalogue.providers[0]!.configured, true); assert.equal(catalogue.providers[1]!.configured, false);
    assert.equal(catalogue.assistance.available, false); assert.equal(catalogue.providers[3]!.requirements[0]!.code, "creative_secure_onboarding_contract_missing");
    assert.equal(f.calls.length, 0); assert.equal((await f.store.list("p", "grant")).length, 0);
    const c = await f.start(); assert.equal(c.grantId, null); assert.equal(c.phase, "requirements");
    await assert.rejects(f.call("beginConnectionHandoff", f.change(c)), /provider_access_decision_required/);
    await assert.rejects(f.call("discoverConnectionAccounts", f.change(c)), /provider_consent_required/);
    assert.equal(f.calls.length, 0);
  } finally { await f.close(); }
});
for (const provider of ["meta", "google", "linkedin"] as Provider[]) test(`C03/C05/C13/C14: ${provider} actual scoped transports, two approvals, selection, one Grant and safe recheck`, async () => {
  const f = await connectionFixture(provider, provider !== "linkedin");
  try {
    let c = await f.approved(); assert.equal(c.phase, "verifying"); assert.equal(c.grantId, null);
    assert.equal((await f.store.list("p", "grant")).length, 0);
    const input = f.change(c);
    c = await f.call("resumeConnection", input); assert.equal(c.phase, "verified", c.checkpoint);
    assert.equal((await f.store.list("p", "grant")).length, 1);
    const g = await f.store.get<Grant>("p", "grant", c.grantId!);
    assert.equal(g.provider, provider); assert.equal(g.label.startsWith("FIXTURE"), true);
    assert.equal(provider === "meta" ? g.pageId : provider === "linkedin" ? g.organizationId : g.timezone, provider === "google" ? "America/Chicago" : provider === "linkedin" ? undefined : "555");
    const replay = await f.call("resumeConnection", input); assert.equal(replay.id, c.id);
    c = await f.call("resumeConnection", f.change(c)); assert.equal(c.phase, "verified");
    assert.equal((await f.store.list("p", "grant")).length, 1);
    const safe = JSON.stringify(c); for (const forbidden of ["SYNTHETIC_ACCESS_TOKEN", "SYNTHETIC_APP_SECRET", "SYNTHETIC_CODE", "secretRef", "sessionTokenHash", "verifier"]) assert.ok(!safe.includes(forbidden));
    assert.ok(c.readiness.every(r => !r.ready));
    assert.ok(f.calls.every(p => /^(https:\/\/(graph.facebook.com|accounts.google.com|oauth2.googleapis.com|googleads.googleapis.com|api.linkedin.com|www.linkedin.com))\//.test(p)));
    assert.ok(f.calls.every(p => !/mutate|campaigns|generate/.test(p)));
  } finally { await f.close(); }
});
test("C03/C12: paginated account choices are opaque, partial and bound to the original snapshot", async () => {
  const f = await connectionFixture();
  try {
    let c = await f.discovered(); assert.equal(c.discovery.accounts.length, 1); assert.equal(c.discovery.complete, false);
    const old = c.discovery.accounts[0]!.choiceRef;
    await assert.rejects(f.call("selectConnectionAccount", { ...f.change(c), choiceRef: "act_2041" }), /invalid_account_choice/);
    c = await f.call("discoverConnectionAccounts", { ...f.change(c), cursor: c.discovery.cursor! });
    assert.equal(c.discovery.accounts.length, 2); assert.equal(c.discovery.complete, true);
    c = await f.call("selectConnectionAccount", { ...f.change(c), choiceRef: old }); assert.equal(c.account!.label, "FIXTURE Studio retail");
    c = await f.call("discoverConnectionAccounts", f.change(c));
    await assert.rejects(f.call("selectConnectionAccount", { ...f.change(c), choiceRef: old }), /invalid_account_choice/);
    assert.ok(!f.calls.some(p => p.includes("untrusted.invalid")));
  } finally { await f.close(); }
});
test("C12/C13: stable start receipts and exact least-scope decisions precede any OAuth URL", async () => {
  const f = await connectionFixture();
  try {
    const input = { provider: { kind: "advertising" as const, provider: "meta" as const }, intent: { kind: "advertising" as const, operations: ["setup", "report"] as ("setup" | "report")[] }, requestKey: "stable-start", expiresAt: new Date(Date.now() + 3600000).toISOString(), offlineAccess: false };
    const c = await f.call("startConnection", input);
    assert.equal((await f.call("startConnection", input)).id, c.id);
    assert.equal((await f.call("startConnection", { ...input, requestKey: "new-key" })).id, c.id);
    assert.equal((await f.call("connection", { startRequestKey: input.requestKey })).id, c.id);
    await assert.rejects(f.call("startConnection", { ...input, offlineAccess: true }), /request_key_payload_conflict|offline_provider_flow_unqualified/);
    const a = await f.authorize(c); assert.equal(a.location.searchParams.get("scope"), "ads_read");
    assert.equal(a.location.searchParams.has("access_type"), false); assert.equal(f.calls.length, 0);
    assert.equal((await f.completeCallback(a.callbackUrl))!.status, 200);
    await f.completeCallback(a.callbackUrl); assert.equal(f.calls.filter(p => p.endsWith("/oauth/access_token")).length, 1);
    assert.equal((await f.store.list("p", "grant")).length, 0);
  } finally { await f.close(); }
});
test("C12: local revocation fences subsequent verification and preserves campaigns, provider authorization and history", async () => {
  const f = await connectionFixture();
  try {
    let c = await f.call("resumeConnection", f.change(await f.approved())); const grantId = c.grantId!;
    c = await f.call("reviewConnectionRevocation", f.change(c)); assert.match(c.accessReview!.summary, /Active ads may keep running/);
    const r = c.accessReview!; c = await f.call("decideConnectionRevocation", { ...f.change(c), decisionRef: r.decisionRef, digest: r.digest, decision: "approved" });
    assert.equal(c.consented.status, "revoked"); assert.ok((await f.store.get<Grant>("p", "grant", grantId)).revokedAt);
    await assert.rejects(f.call("resumeConnection", f.change(c)), /connection_changed|grant_expired_or_revoked/);
    assert.equal((await f.store.list("p", "grant")).length, 1);
  } finally { await f.close(); }
});
