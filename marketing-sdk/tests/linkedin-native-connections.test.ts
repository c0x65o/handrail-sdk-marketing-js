import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { connectionFixture } from "./connection-fixture.js";
import { fixtureEligibility, fixtureSettings } from "./capability-fixtures.js";
import { byteDigest } from "../server/store.js";
import { MarketingServer } from "../server/index.js";
import { trackingFixture } from "./tracking-fixture.js";
import { LinkedInMarketingClient } from "../support/owner-marketing/linkedin-client.js";
import type { Asset, Campaign, Grant } from "../core/index.js";

type Fixture = Awaited<ReturnType<typeof connectionFixture>>;
async function connected(f: Fixture) {
  const c = await f.call("resumeConnection", f.change(await f.approved()));
  assert.equal(c.phase, "verified");
  return f.store.get<Grant>("p", "grant", c.grantId!);
}
function changeResponse(f: Fixture, change: (url: URL, body: any) => any) {
  const original = f.connections.discovery.fetcher;
  (f.connections.discovery as { fetcher: typeof fetch }).fetcher = async (input, init) =>
    Response.json(change(new URL(String(input)), await (await original(input, init)).json()));
}
async function campaign(f: Fixture, g: Grant) {
  const transport = nativeTransport(f);
  const tracking = await trackingFixture(f.store, "https://example.com");
  const server = new MarketingServer(f.store, f.server.providers, f.server.generation, f.server.agent,
    "fixture", undefined, undefined, { connections: f.connections, tracking: tracking.options });
  const destination = tracking.source.destinations[0]!.url;
  const captured = await server.call(f.principal, "p", "captureDestination", { url: destination });
  const bytes = readFileSync(new URL("../../marketing-sdk/tests/fixtures/test-pattern.png", import.meta.url)), hash = byteDigest(bytes);
  await f.store.db.prepare("INSERT INTO blobs VALUES(?,?,?)").run("p", hash, bytes);
  const asset: Asset = { id: "a", projectId: "p", campaignId: "c", version: 1, kind: "image", digest: hash, mime: "image/png", width: 320, height: 180,
    seconds: null, source: "uploaded", jobId: null, rightsReceipt: "fixture", parentAssetIds: [] };
  await f.store.put("p", "asset", asset.id, asset);
  const c: Campaign = { id: "c", projectId: "p", revision: 1, grantId: g.id, creativeSetId: "cs", state: "draft", receipt: null,
    material: { settings: fixtureSettings("linkedin", "2041", "555"), purpose: "acquisition", name: "Fixture", headline: "Headline", body: "Body",
      destination, destinationDigest: captured.digest, assetIds: ["a"], audience: { provider: "linkedin", locations: ["urn:li:geo:1"], expansion: false },
      budget: { currency: "USD", minor: 42000 }, advertisingBudget: { lifetime: { currency: "USD", minor: 42000 }, daily: { currency: "USD", minor: 3000 } },
      startAt: new Date(Math.floor(Date.now() / 86400000) * 86400000 + 86400000).toISOString(),
      endAt: new Date(Math.floor(Date.now() / 86400000) * 86400000 + 8 * 86400000).toISOString(), timezone: "UTC" } };
  g.targetingOptions = [{ kind: "locations", id: "urn:li:geo:1", label: "United States" }]; fixtureEligibility(c, g);
  await f.store.put("p", "grant", g.id, g);
  await f.store.put("p", "campaign", c.id, c);
  if (g.permissions.includes("prepare")) {
    await server.call(f.principal, "p", "bindTracking", { owner: { kind: "campaign", id: c.id }, expectedRevision: c.revision,
      expectedBindingRevision: 0, sourceId: "site", sourceRevision: "1", destinationId: "tour", outcome: "inquiry", refundTreatment: null, requestKey: "tracking" });
    const check = await server.call(f.principal, "p", "checkCampaign", { campaignId: c.id, expectedRevision: c.revision,
      expectedGrantRevision: g.revision, requestKey: "preparation-check" });
    assert.equal(check.state, "ready", JSON.stringify(check.reasons));
    assert.equal(transport.writes(), 0, "Prerequisite checks must not write to LinkedIn");
  }
  return { c, asset, transport, server };
}
function nativeTransport(f: Fixture) {
  const original = f.connections.discovery.fetcher, objects = new Map<string, any>();
  let writes = 0, loseRead = false, postConflict = false;
  (f.connections.discovery as { fetcher: typeof fetch }).fetcher = async (input, init) => {
    const u = new URL(String(input)), path = decodeURIComponent(u.pathname), last = path.split("/").at(-1)!;
    if (path.endsWith("introspectToken")) return original(input, init);
    if (init?.method === "PUT") { writes++; return new Response(null, { status: 201 }); }
    if (init?.method === "POST") {
      writes++; const body = JSON.parse(String(init.body));
      if (last === "images") return Response.json({ value: { uploadUrl: "https://fixture.invalid/upload", image: "urn:li:image:fixture" } });
      const id = last === "adCampaignGroups" ? "101" : last === "adCampaigns" ? "102" : "urn:li:sponsoredCreative:103";
      objects.set(id, { ...(body.creative ?? body), id });
      if (postConflict && last === "creatives") objects.get(id).inlineContent.post.author = "urn:li:organization:999";
      return Response.json({}, { status: 201, headers: { "x-restli-id": id } });
    }
    if (path.endsWith("adTargetingEntities")) return Response.json({ elements: [{ urn: "urn:li:geo:1", name: "United States" }] });
    if (path.endsWith("campaignConversions")) return Response.json({ elements: [] });
    if (path.includes("/images/")) return Response.json({ id: "urn:li:image:fixture", owner: "urn:li:organization:555", status: "AVAILABLE" });
    if (path.endsWith("adAnalytics")) return Response.json({ elements: [{ dateRange: { start: { year: 2026, month: 1, day: 1 }, end: { year: 2026, month: 1, day: 1 } }, pivotValues: ["urn:li:sponsoredCampaign:102"], impressions: 40, clicks: 2, externalWebsiteConversions: 1, costInLocalCurrency: "1.25" }] });
    if (objects.has(last)) { if (loseRead && last === "urn:li:sponsoredCreative:103") { loseRead = false; throw Error("lost read acknowledgment"); } return Response.json(objects.get(last)); }
    return original(input, init);
  };
  return { objects, writes: () => writes, loseRead: () => { loseRead = true; }, conflict: () => { postConflict = true; } };
}

test("NEW reporting Connection uses actual NativeProvider/client verification and persisted metrics with r_ads only", async () => {
  const f = await connectionFixture("linkedin");
  try {
    const g = await connected(f);
    assert.deepEqual((await f.native.verify(g)).permissions, ["setup", "report"]);
    const { c } = await campaign(f, g);
    c.receipt = { ids: { campaign: "102" }, payloadDigest: "historical", intent: "paused", delivery: "unverified", observedAt: new Date().toISOString(), evidence: "provider", providerRequestId: null };
    await f.store.put("p", "campaign", c.id, c);
    const m = await f.server.call(f.principal, "p", "syncMetrics", { campaignId: c.id, from: "2026-01-01T00:00:00Z", until: "2026-01-02T00:00:00Z" });
    assert.equal(m.spendMinor, 125); assert.equal(m.impressions, 40); assert.equal(m.providerConversions, 1);
    assert.equal((await f.store.list("p", "metrics")).length, 1);
    assert.ok(!f.calls.some(p => /organization/.test(p)));
    changeResponse(f, (u, b) => { if (u.pathname.endsWith("introspectToken")) b.scope = "r_ads"; return b; });
    await assert.rejects(f.native.metrics(c, g, m.from, m.until), /provider_capability_missing/);
  } finally { await f.close(); }
});
for (const role of ["CAMPAIGN_MANAGER", "ACCOUNT_MANAGER", "ACCOUNT_BILLING_ADMIN"]) for (const pageRole of ["ADMINISTRATOR", "DIRECT_SPONSORED_CONTENT_POSTER"]) test(`NEW ${role}/${pageRole} Connection reaches native campaign preparation/readback`, async () => {
  const f = await connectionFixture("linkedin", true);
  try {
    changeResponse(f, (u, b) => { if (u.pathname.endsWith("adAccountUsers")) b.elements[0].role = role; if (u.pathname.endsWith("organizationAcls")) b.elements[0].role = pageRole; return b; });
    const g = await connected(f), { c, asset, transport } = await campaign(f, g);
    assert.ok((await f.native.verify(g, c, [asset], "prepare")).permissions.includes("prepare"));
    const receipt = await f.native.prepare(c, g, [asset], "fixture", () => {}, () => {});
    assert.ok(receipt.ids.readbackDigest); assert.equal(receipt.intent, "paused");
    assert.equal(transport.objects.get("102").associatedEntity, "urn:li:organization:555");
    assert.equal(transport.objects.get("urn:li:sponsoredCreative:103").inlineContent.post.author, "urn:li:organization:555");
  } finally { await f.close(); }
});
for (const denied of ["VIEWER", "CREATIVE_MANAGER", "CONTENT_ADMIN", "CONTENT_ADMINISTRATOR", "wrong-member", "wrong-org", "conflicting-org", "conflicting-state", "missing-admin-scope", "missing-read-scope"]) test(`native boundary denies ${denied} after a valid Connection while retaining reporting`, async () => {
  const f = await connectionFixture("linkedin", true);
  try {
    const g = await connected(f), { c, asset, transport } = await campaign(f, g);
    changeResponse(f, (u, b) => {
      if (u.pathname.endsWith("adAccountUsers") && ["VIEWER", "CREATIVE_MANAGER"].includes(denied)) b.elements[0].role = denied;
      if (u.pathname.endsWith("organizationAcls")) {
        const a = b.elements[0];
        if (denied.startsWith("CONTENT_")) a.role = denied;
        if (denied === "wrong-member") a.roleAssignee = "urn:li:person:other";
        if (denied === "wrong-org") a.organization = "urn:li:organization:999";
        if (denied === "conflicting-org") a.organizationTarget = "urn:li:organization:999";
        if (denied === "conflicting-state") b.elements.push({ ...a, role: "CONTENT_ADMIN", state: "REVOKED" });
      }
      if (u.pathname.endsWith("introspectToken")) {
        if (denied === "missing-admin-scope") b.scope = b.scope.replace("r_organization_admin", "");
        if (denied === "missing-read-scope") b.scope = b.scope.replace("r_organization_social", "");
      }
      return b;
    });
    const v = await f.native.verify(g); assert.ok(v.permissions.includes("report")); assert.ok(!v.permissions.includes("prepare"));
    await assert.rejects(f.native.prepare(c, g, [asset], "denied", () => {}, () => {}), /provider_capability_missing/);
    assert.equal(transport.writes(), 0);
  } finally { await f.close(); }
});
for (const kind of ["scope-loss", "inactive", "expired", "wrong-client", "missing-scope", "wrong-status", "wrong-auth-type"]) test(`native client cannot override current ${kind} with refresh response scope`, async () => {
  const client = new LinkedInMarketingClient({ refreshToken: "synthetic-refresh", clientId: "app", clientSecret: "synthetic-secret", fetchImpl: async (input, init) => {
    assert.equal(init?.redirect, "error");
    if (String(input).endsWith("accessToken")) return Response.json({ access_token: "synthetic-access", expires_in: 3600, scope: "rw_ads r_ads_reporting" });
    if (String(input).endsWith("introspectToken")) return Response.json({ active: kind !== "inactive", ...(kind === "missing-scope" ? {} : { scope: "r_ads" }), ...(kind === "expired" ? { expires_at: 1 } : {}), ...(kind === "wrong-client" ? { client_id: "other" } : {}), ...(kind === "wrong-status" ? {status:"revoked"} : {}), ...(kind === "wrong-auth-type" ? {auth_type:"other"} : {}) });
    return Response.json({ id: 2041, currency: "USD" });
  } });
  const reasons: Record<string,string> = {inactive:"token_inactive",expired:"token_expiry_unverified","wrong-client":"token_client_mismatch","wrong-status":"token_status_unverified","wrong-auth-type":"token_auth_type_unverified"};
  if (reasons[kind]) await assert.rejects(client.verifyConnection({ adAccountId: "2041" }), {code:"verification_failed",verificationReason:reasons[kind]});
  else { const v = await client.verifyConnection({ adAccountId: "2041" }); assert.equal(v.permissions.adsManagement, false); assert.equal(v.permissions.adsReporting, false); assert.equal(v.permissions.adsRead, kind === "scope-loss"); }
});

test("native verification retains a fixed token failure reason without provider values", async () => {
  const f=await connectionFixture("linkedin",true);
  try {
    const g=await connected(f);
    changeResponse(f,(u,b)=>u.pathname.endsWith("introspectToken")?{...b,client_id:"private-provider-value"}:b);
    await assert.rejects(f.native.verify(g),error=>{
      assert.equal((error as any).code,"provider_token_client_mismatch");
      assert.ok(!JSON.stringify(error).includes("private-provider-value"));return true;
    });
  } finally {await f.close();}
});

test("native preparation retains lost-ack identity, reconciles read-only, and rejects a conflicting post author", async () => {
  const f = await connectionFixture("linkedin", true);
  try {
    const g = await connected(f), { c, asset, transport } = await campaign(f, g);
    let ids: Record<string, string> = {}; transport.loseRead();
    await assert.rejects(f.native.prepare(c, g, [asset], "lost-ack", value => { ids = { ...value }; }, () => {}));
    assert.ok(ids.campaign && ids.creative);
    const count = transport.writes(), { digest } = await import("../server/store.js"), payloadDigest = digest(f.native.plan(c, g, [asset]));
    const receipt = await f.native.reconcile(c, g, { kind: "prepare", payloadDigest, receipt: { ids, payloadDigest, intent: "paused", delivery: "unverified", observedAt: new Date().toISOString(), evidence: "provider", providerRequestId: null } });
    assert.equal(transport.writes(), count); assert.ok(receipt?.ids.readbackDigest);
    transport.conflict();
    await assert.rejects(f.native.prepare(c, g, [asset], "post-conflict", () => {}, () => {}), /provider_effective_material_mismatch/);
  } finally { await f.close(); }
});
test("LinkedIn prerequisite receipts replay without provider reads and stale material cannot reach a write", async () => {
  const f = await connectionFixture("linkedin", true);
  try {
    const g = await connected(f), { c, asset, transport, server } = await campaign(f, g);
    const reads = f.calls.length;
    const checked = await server.call(f.principal, "p", "checkCampaign", { campaignId: c.id, expectedRevision: c.revision,
      expectedGrantRevision: g.revision, requestKey: "preparation-check" });
    assert.equal(checked.state, "ready"); assert.equal(f.calls.length, reads);
    const saved = await f.store.get<Campaign>("p", "campaign", c.id);
    saved.material.headline = "Changed since prerequisite check";
    await f.store.put("p", "campaign", c.id, saved);
    await assert.rejects(f.native.prepare(c, g, [asset], "stale", () => {}, () => {}), /campaign_prerequisites_stale/);
    assert.equal(transport.writes(), 0);
  } finally { await f.close(); }
});
for (const change of ["page-role", "account-status", "scope"] as const)
test(`LinkedIn prerequisite refresh refuses changed ${change} without advertising writes`, async () => {
  const f = await connectionFixture("linkedin", true);
  try {
    const g = await connected(f), { c, transport, server } = await campaign(f, g);
    changeResponse(f, (u, b) => {
      if (change === "page-role" && u.pathname.endsWith("organizationAcls")) b.elements[0].role = "CONTENT_ADMIN";
      if (change === "account-status" && u.pathname.endsWith("adAccounts/2041")) b.status = "CANCELED";
      if (change === "scope" && u.pathname.endsWith("introspectToken")) b.scope = "r_ads r_ads_reporting";
      return b;
    });
    const checked = await server.call(f.principal, "p", "checkCampaign", { campaignId: c.id, expectedRevision: c.revision,
      expectedGrantRevision: g.revision, requestKey: "refresh-after-change" });
    assert.notEqual(checked.state, "ready"); assert.ok(checked.reasons.length); assert.equal(transport.writes(), 0);
    assert.notEqual((await server.call(f.principal, "p", "campaignCheck", { campaignId: c.id }))?.state, "ready");
  } finally { await f.close(); }
});
test("native role reads consume empty continuation pages and reject an arbitrary pagination URL before any write", async () => {
  const f = await connectionFixture("linkedin", true); let evil = false;
  try {
    const g = await connected(f);
    changeResponse(f, (u, b) => {
      if (u.pathname.endsWith("organizationAcls")) {
        const start = Number(u.searchParams.get("start"));
        b.paging = { start, count: 25, links: [] };
        if (start === 0) { b.elements = []; b.paging.links = [{ rel: "next", href: evil ? "https://evil.invalid/steal" : "/rest/organizationAcls?q=roleAssignee&state=APPROVED&start=25&count=25" }]; }
      }
      return b;
    });
    assert.ok((await f.native.verify(g)).permissions.includes("prepare")); evil = true;
    await assert.rejects(f.native.verify(g), /provider_discovery_incomplete/);
    assert.ok(!f.calls.some(url => url.includes("evil.invalid")));
  } finally { await f.close(); }
});
test("local membership loss during native ACL await fences the first write", async () => {
  const f = await connectionFixture("linkedin", true);
  try {
    const g = await connected(f), { c, asset, transport } = await campaign(f, g);
    f.boundary(async u => { if (u.pathname.endsWith("organizationAcls")) await f.store.db.prepare("DELETE FROM memberships WHERE user_id=? AND project_id=?").run(f.alice, "p"); });
    await assert.rejects(f.native.prepare(c, g, [asset], "late-loss", () => {}, async () => { await f.store.authorize(f.principal, "p", ["admin"]); }));
    assert.equal(transport.writes(), 0);
  } finally { await f.close(); }
});

test("publishing-only app configuration loss preserves the separate reporting Connection and native reports", async () => {
  const f = await connectionFixture("linkedin");
  try {
    const c = await f.call("resumeConnection", f.change(await f.approved()));
    delete f.custody.apps.linkedin!.linkedinAdvertising;
    const v = await f.call("connection", { connectionId: c.id });
    assert.equal(v.configured.status, "verified"); assert.equal(v.phase, "verified");
    assert.equal((await f.call("resumeConnection", f.change(v))).phase, "verified");
    const g = await f.store.get<Grant>("p", "grant", c.grantId!);
    assert.deepEqual((await f.native.verify(g)).permissions, ["setup", "report"]);
    f.custody.apps.linkedin!.clientId = "changed-client";
    await assert.rejects(f.call("resumeConnection", f.change(await f.call("connection", { connectionId: c.id }))), /connection_configuration_changed/);
  } finally { await f.close(); }
});
