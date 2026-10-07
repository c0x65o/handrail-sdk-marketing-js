import test from "node:test";
import assert from "node:assert/strict";
import { connectionFixture } from "./connection-fixture.js";
import { connectionScopes } from "../server/connection-discovery.js";
import type { ConnectionView } from "../core/index.js";

type Fixture = Awaited<ReturnType<typeof connectionFixture>>;
function override(f: Fixture, change: (url: URL, body: any) => any) {
  const discovery = f.connections.discovery as { fetcher: typeof fetch }, original = discovery.fetcher;
  discovery.fetcher = async (input, init) => {
    const url = new URL(String(input));
    const body = await (await original(input, init)).json();
    return Response.json(change(url, body));
  };
}
async function account(f: Fixture) {
  const c = await f.discovered();
  return f.call("selectConnectionAccount", { ...f.change(c), choiceRef: c.discovery.accounts[0]!.choiceRef });
}
async function denied(f: Fixture, c: ConnectionView, code: string) {
  const result = await f.call("resumeConnection", f.change(c));
  assert.equal(result.phase, "failed_retryable"); assert.equal(result.checkpoint, code);
  assert.equal((await f.store.list("p", "grant")).length, 0);
}

test("LinkedIn scope bundles are intent-specific; conversions and role administration stay separate", () => {
  assert.deepEqual(connectionScopes("linkedin", ["setup", "report"]), ["r_ads", "r_ads_reporting"]);
  assert.deepEqual(connectionScopes("linkedin", ["setup", "prepare"]), ["rw_ads", "r_organization_admin", "w_organization_social", "r_organization_social"]);
  assert.deepEqual(connectionScopes("linkedin", ["setup", "pause"]), ["rw_ads"]);
});
test("reporting is available without publishing capability and makes zero organization calls", async () => {
  const f = await connectionFixture("linkedin");
  try {
    delete f.custody.apps.linkedin!.linkedinAdvertising;
    const c = await f.call("resumeConnection", f.change(await f.approved()));
    assert.equal(c.phase, "verified"); assert.match(c.checkpoint, /Reporting connected/);
    await assert.rejects(f.call("connectionIdentities", f.change(c)), /account_choice_required/);
    assert.ok(!f.calls.some(p => /organization/.test(p)));
  } finally { await f.close(); }
});
for (const field of ["absent", "allowlist", "wrong-client", "tier"] as const) test(`publishing app configuration ${field} blocks before OAuth`, async () => {
  const f = await connectionFixture("linkedin", true);
  try {
    const app = f.custody.apps.linkedin!;
    if (field === "absent") delete app.linkedinAdvertising;
    if (field === "allowlist") (app.linkedinAdvertising as any).supportedScopes = undefined;
    if (field === "wrong-client") app.linkedinAdvertising!.clientId = "different";
    if (field === "tier") (app.linkedinAdvertising as any).tier = "conversions-standard";
    const c = await f.start(); assert.equal(c.phase, "blocked"); assert.match(c.checkpoint, /administrator/);
    await assert.rejects(f.call("reviewConnectionProviderAccess", f.change(c)), /linkedin_app_capability_missing|connection_transition_denied/);
    assert.equal(f.calls.length, 0);
  } finally { await f.close(); }
});
for (const role of ["ACCOUNT_MANAGER", "CAMPAIGN_MANAGER", "ACCOUNT_BILLING_ADMIN"]) for (const pageRole of ["ADMINISTRATOR", "DIRECT_SPONSORED_CONTENT_POSTER"]) test(`${role} plus approved ${pageRole} qualifies only the associated Page`, async () => {
  const f = await connectionFixture("linkedin", true);
  try {
    override(f, (url, body) => {
      if (url.pathname.endsWith("adAccountUsers")) body.elements[0].role = role;
      if (url.pathname.endsWith("organizationAcls")) { body.elements[0].role = pageRole; body.elements[0].organizationTarget = body.elements[0].organization; delete body.elements[0].organization; }
      return body;
    });
    const c = await f.call("resumeConnection", f.change(await f.approved()));
    assert.equal(c.phase, "verified"); assert.equal(c.identities[0]!.label, "FIXTURE Studio organization");
    const g: any = (await f.store.list("p", "grant"))[0]; assert.equal(g.organizationId, "555"); assert.equal(g.accountId, "2041");
    assert.ok(!f.calls.some(p => /\/organizations\/|organizationAuthorizations/.test(p)));
  } finally { await f.close(); }
});
for (const role of ["VIEWER", "CREATIVE_MANAGER"]) test(`${role} cannot qualify whole campaign creation`, async () => {
  const f = await connectionFixture("linkedin", true);
  try {
    override(f, (url, body) => { if (url.pathname.endsWith("adAccountUsers")) body.elements[0].role = role; return body; });
    const c = await f.call("connectionIdentities", f.change(await account(f)));
    assert.equal(c.checkpoint, "provider_account_role_missing"); assert.equal(c.discovery.identities.length, 0);
    assert.ok(!f.calls.some(p => p.endsWith("organizationAcls")));
  } finally { await f.close(); }
});
for (const kind of ["wrong-member", "wrong-org", "requested", "revoked", "conflict", "content-admin", "content-administrator", "reference-only"]) test(`ACL ${kind} cannot qualify publishing and never broadens access`, async () => {
  const f = await connectionFixture("linkedin", true);
  try {
    const c = await account(f);
    override(f, (url, body) => {
      if (!url.pathname.endsWith("organizationAcls")) return body;
      const acl = body.elements[0];
      if (kind === "wrong-member") acl.roleAssignee = "urn:li:person:other";
      if (kind === "wrong-org") acl.organization = "urn:li:organization:999";
      if (kind === "requested" || kind === "revoked") acl.state = kind.toUpperCase();
      if (kind === "conflict") acl.organizationTarget = "urn:li:organization:999";
      if (kind === "content-admin") acl.role = "CONTENT_ADMIN";
      if (kind === "content-administrator") acl.role = "CONTENT_ADMINISTRATOR";
      if (kind === "reference-only") body.elements = [];
      return body;
    });
    const result = await f.call("connectionIdentities", f.change(c));
    assert.equal(result.phase, "failed_retryable"); assert.equal(result.discovery.identities.length, 0);
    assert.ok(!f.calls.some(p => /\/organizations\/|organizationAuthorizations/.test(p)));
    assert.equal((await f.store.list("p", "grant")).length, 0);
  } finally { await f.close(); }
});
test("missing actual r_organization_admin stops before ACL even when requested and returned by exchange", async () => {
  const f = await connectionFixture("linkedin", true);
  try {
    const c = await account(f);
    override(f, (url, body) => { if (url.pathname.endsWith("introspectToken")) body.scope = body.scope.replace("r_organization_admin", ""); return body; });
    const result = await f.call("connectionIdentities", f.change(c));
    assert.equal(result.checkpoint, "provider_scope_missing"); assert.ok(!f.calls.some(p => p.endsWith("organizationAcls")));
  } finally { await f.close(); }
});
for (const field of ["user", "account", "role", "reference"]) test(`fresh verification rejects changed ${field} after consent`, async () => {
  const f = await connectionFixture("linkedin", true);
  try {
    const c = await f.approved();
    override(f, (url, body) => {
      if (url.pathname.endsWith("adAccountUsers")) {
        if (field === "user") body.elements[0].user = "urn:li:person:other";
        if (field === "account") body.elements[0].account = "urn:li:sponsoredAccount:999";
        if (field === "role") body.elements[0].role = "VIEWER";
      }
      if (url.pathname.endsWith("adAccounts/2041") && field === "reference") { body.reference = "urn:li:organization:999"; delete body.referenceInfo; }
      return body;
    });
    // An unrecognized account path is rejected by the synthetic boundary too.
    await denied(f, c, field === "user" || field === "role" ? "provider_member_or_role_changed" : field === "reference" ? "provider_account_context_changed" : "provider_read_unavailable");
  } finally { await f.close(); }
});
test("safe full organization identifier survives missing label; person reference cannot publish", async () => {
  for (const person of [false, true]) {
    const f = await connectionFixture("linkedin", true);
    try {
      override(f, (url, body) => { if (url.pathname.endsWith("adAccounts/2041")) { delete body.referenceInfo; if (person) body.reference = "urn:li:person:fixture-member"; } return body; });
      const c = await f.call("connectionIdentities", f.change(await account(f)));
      if (person) assert.equal(c.checkpoint, "provider_identity_mismatch");
      else assert.match(c.discovery.identities[0]!.label, /urn:li:organization:555.*name unavailable/);
    } finally { await f.close(); }
  }
});
for (const target of ["adAccountUsers", "organizationAcls"]) test(`${target} consumes empty pages with continuation and fails bounded incomplete results`, async () => {
  const f = await connectionFixture("linkedin", true); let endless = false;
  try {
    override(f, (url, body) => {
      if (!url.pathname.endsWith(target)) return body;
      const start = Number(url.searchParams.get("start"));
      body.paging = { start, count: 25, links: [] };
      if (start === 0 || endless) {
        body.elements = []; const next = new URL(url); next.searchParams.set("start", String(start + 25));
        body.paging.links = [{ rel: "next", href: next.pathname + next.search }];
      }
      return body;
    });
    const c = await f.approved(); assert.equal(c.phase, "verifying");
    endless = true; await denied(f, c, "provider_discovery_incomplete");
  } finally { await f.close(); }
});
test("a full page without total follows offset pagination; later member conflict denies the entire snapshot", async () => {
  const f = await connectionFixture("linkedin", true);
  try {
    override(f, (url, body) => {
      if (!url.pathname.endsWith("adAccountUsers")) return body;
      const start = Number(url.searchParams.get("start"));
      return { paging: { start, count: 1 }, elements: start === 0 ? body.elements : [{ ...body.elements[0], user: "urn:li:person:other" }] };
    });
    const c = await f.discovered(); assert.equal(c.checkpoint, "provider_discovery_incomplete");
    assert.equal(c.discovery.accounts.length, 0);
  } finally { await f.close(); }
});
test("changed app scopes invalidate approved navigation; raw IDs never bypass choices", async () => {
  const f = await connectionFixture("linkedin", true);
  try {
    const a = await f.authorize(await f.start());
    f.custody.apps.linkedin!.linkedinAdvertising!.supportedScopes = ["rw_ads"];
    const r = await f.routes(new Request(f.custody.origin + a.c.handoffPath)); assert.equal(r!.status, 409);
    assert.equal(r!.headers.get("location"), null);
    await assert.rejects(f.call("selectConnectionAccount", { ...f.change(a.c), choiceRef: "2041" }), /connection_configuration_changed/);
    assert.equal(f.calls.length, 0);
  } finally { await f.close(); }
});

for (const change of ["session", "cancel", "expiry", "config"]) test(`LinkedIn ${change} during ACL await cannot promote a grant`, async () => {
  const f = await connectionFixture("linkedin", true);
  try {
    const c = await f.approved(); let changed = false;
    f.boundary(async url => {
      if (changed || !url.pathname.endsWith("organizationAcls")) return; changed = true;
      if (change === "session") await f.store.db.prepare("DELETE FROM sessions WHERE token_hash=?").run(f.principal.sessionTokenHash!);
      if (change === "config") f.custody.apps.linkedin!.linkedinAdvertising!.revision = "changed";
      if (change === "cancel") { const current = await f.call("connection", { connectionId: c.id }); await f.call("cancelConnection", f.change(current)); }
      if (change === "expiry") { const current: any = await f.store.get("p", "connection", c.id); current.expiresAt = new Date(0).toISOString(); current.revision++; current.view.revision = current.revision; await f.store.put("p", "connection", c.id, current, current.revision - 1); }
    });
    try { const result = await f.call("resumeConnection", f.change(c)); assert.notEqual(result.phase, "verified"); }
    catch (e) { assert.match(String(e), /session|unauthorized|authentication_required|configuration_changed|connection_changed|access_expired/); }
    assert.equal((await f.store.list("p", "grant")).length, 0);
  } finally { await f.close(); }
});
test("LinkedIn discovery proof expiry and raw typed IDs cannot bypass a current scoped choice", async () => {
  const f = await connectionFixture("linkedin", true);
  try {
    const c = await f.discovered();
    await assert.rejects(f.call("selectConnectionAccount", { ...f.change(c), choiceRef: "2041" }), /invalid_account_choice/);
    const current: any = await f.store.get("p", "connection", c.id);
    current.view.discovery.expiresAt = new Date(0).toISOString(); current.revision++; current.view.revision = current.revision;
    await f.store.put("p", "connection", c.id, current, current.revision - 1);
    await assert.rejects(f.call("selectConnectionAccount", { ...f.change(current.view), choiceRef: c.discovery.accounts[0]!.choiceRef }), /discovery_snapshot_expired/);
    assert.equal((await f.store.list("p", "grant")).length, 0);
  } finally { await f.close(); }
});
test("LinkedIn local revoke fences re-verification and retains the original grant identity", async () => {
  const f = await connectionFixture("linkedin", true);
  try {
    let c = await f.call("resumeConnection", f.change(await f.approved())); const grantId = c.grantId;
    c = await f.call("reviewConnectionRevocation", f.change(c)); const review = c.accessReview!;
    c = await f.call("decideConnectionRevocation", { ...f.change(c), decisionRef: review.decisionRef, digest: review.digest, decision: "approved" });
    await assert.rejects(f.call("resumeConnection", f.change(c)), /grant_expired_or_revoked|connection_changed/);
    assert.equal(c.grantId, grantId); assert.equal((await f.store.list("p", "grant")).length, 1);
  } finally { await f.close(); }
});

test("LinkedIn transport uses versioned read-only finders and explicit additional-info projection", async () => {
  const f = await connectionFixture("linkedin", true);
  try {
    const discovery = f.connections.discovery as { fetcher: typeof fetch }, original = discovery.fetcher;
    discovery.fetcher = async (input, init) => {
      const url = new URL(String(input));
      if (url.origin === "https://api.linkedin.com") {
        assert.equal(init!.method, "GET"); assert.equal(init!.redirect, "error");
        const headers = new Headers(init!.headers); assert.equal(headers.get("LinkedIn-Version"), "202609"); assert.equal(headers.get("X-Restli-Protocol-Version"), "2.0.0");
        assert.ok(["/rest/adAccountUsers", "/rest/adAccounts/2041", "/rest/organizationAcls"].includes(url.pathname));
        if (url.pathname.endsWith("adAccounts/2041")) assert.equal(url.searchParams.get("fields"), "id,name,reference,referenceInfo,currency,status");
      }
      return original(input, init);
    };
    assert.equal((await f.call("resumeConnection", f.change(await f.approved()))).phase, "verified");
  } finally { await f.close(); }
});

for (const target of ["adAccountUsers", "organizationAcls"]) test(`${target} full page without total terminates only after the final empty page`, async () => {
  const f = await connectionFixture("linkedin", true); let finalPage = false;
  try {
    override(f, (url, body) => {
      if (!url.pathname.endsWith(target)) return body;
      const start = Number(url.searchParams.get("start")); finalPage ||= start > 0;
      return { elements: start === 0 ? body.elements : [], paging: { start, count: 1, links: [] } };
    });
    assert.equal((await f.call("resumeConnection", f.change(await f.approved()))).phase, "verified"); assert.equal(finalPage, true);
  } finally { await f.close(); }
});
test("consistent ACL aliases are accepted; mismatched referenceInfo identity is rejected", async () => {
  const f = await connectionFixture("linkedin", true); let conflict = false;
  try {
    override(f, (url, body) => {
      if (url.pathname.endsWith("organizationAcls")) body.elements[0].organizationTarget = body.elements[0].organization;
      if (url.pathname.endsWith("adAccounts/2041") && conflict) body.referenceInfo.organization.id = 999;
      return body;
    });
    const c = await f.approved(); conflict = true; await denied(f, c, "provider_identity_mismatch");
  } finally { await f.close(); }
});
for (const field of ["client_id", "expires_at", "active", "auth_type"]) test(`contradictory actual token ${field} denies access before ACL`, async () => {
  const f = await connectionFixture("linkedin", true);
  try {
    const c = await account(f);
    override(f, (url, body) => { if (url.pathname.endsWith("introspectToken")) body[field] = field === "active" ? false : field === "expires_at" ? 1 : "wrong"; return body; });
    const result = await f.call("connectionIdentities", f.change(c)); assert.equal(result.checkpoint, "provider_access_expired_or_denied");
    assert.ok(!f.calls.some(p => p.endsWith("organizationAcls")));
  } finally { await f.close(); }
});

for (const extra of [false, true]) test(`missing exchange scopes need fresh exact introspection (extra=${extra})`, async () => {
  const f = await connectionFixture("linkedin");
  try {
    // The exchange and discovery both use the same synthetic HTTP boundary.
    const custody = f.custody as unknown as { fetcher: typeof fetch }, original = custody.fetcher;
    custody.fetcher = async (input, init) => {
      const body = await (await original(input, init)).json();
      if (String(input).endsWith("accessToken")) delete body.scope;
      return Response.json(body);
    };
    if (extra) override(f, (u, b) => { if (u.pathname.endsWith("introspectToken")) b.scope += " rw_ads"; return b; });
    const c = await f.discovered();
    if (extra) {
      assert.equal(c.checkpoint, "provider_scope_missing"); assert.equal(c.discovery.accounts.length, 0);
      assert.ok(!f.calls.some(p => p.endsWith("adAccountUsers")));
    } else assert.equal(c.discovery.accounts.length, 1);
    assert.equal((await f.store.list("p", "grant")).length, 0);
  } finally { await f.close(); }
});
test("account choices display full IDs and strip misleading control characters while retaining opaque selection", async () => {
  const f = await connectionFixture("linkedin");
  try {
    override(f, (u, b) => { if (u.pathname.endsWith("adAccounts/2041")) b.name = "Same\u202eName\u0000"; return b; });
    const c = await f.discovered(), choice = c.discovery.accounts[0]!;
    assert.equal(choice.displayId, "2041"); assert.equal(choice.label, "SameName");
    assert.notEqual(choice.choiceRef, choice.displayId);
    await assert.rejects(f.call("selectConnectionAccount", { ...f.change(c), choiceRef: choice.displayId }), /invalid_account_choice/);
  } finally { await f.close(); }
});
