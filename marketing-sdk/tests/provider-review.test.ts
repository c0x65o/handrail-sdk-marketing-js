import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NativeProvider, providerPlan } from "../server/providers.js";
import { LinkedInMarketingClient } from "../support/owner-marketing/linkedin-client.js";
import { accountPath } from "../support/owner-marketing/meta-client.js";
import { capabilityKey, capabilityStatus, dailyExposureMinor, type Campaign, type Grant } from "../core/index.js";
import { validateAccountCapability } from "../server/capabilities.js";
import { testStore } from "./datastore.js";
import { fixtureEligibility, fixtureSettings } from "./capability-fixtures.js";

const grant: Grant = { id: "g", projectId: "p", revision: 1, provider: "linkedin", accountId: "123456", label: "Independent HTTP seam",
  currency: "USD", timezone: "UTC", permissions: ["setup", "prepare", "activate", "pause", "report"], expiresAt: "2099-01-01T00:00:00Z",
  revokedAt: null, secretRef: "test-only", organizationId: "2414183", targetingOptions: [{ kind: "locations", id: "urn:li:geo:103644278", label: "United States" }] };
const campaign: Campaign = { id: "c", projectId: "p", grantId: "g", revision: 1, creativeSetId: "cs", state: "draft",
  material: { purpose: "acquisition", settings: fixtureSettings("linkedin", "123456", "2414183"), name: "Review", headline: "Review", body: "Review",
    destination: "https://example.com", destinationDigest: "a".repeat(64), assetIds: [], audience: { provider: "linkedin", expansion: false, locations: ["urn:li:geo:103644278"] },
    budget: { currency: "USD", minor: 10000 }, advertisingBudget: { lifetime: { currency: "USD", minor: 10000 }, daily: { currency: "USD", minor: 1000 } },
    timezone: "UTC", startAt: "2026-01-01T00:00:00Z", endAt: "2026-01-03T00:00:00Z" },
  receipt: { ids: { campaign: "345396555" }, payloadDigest: "retained", intent: "paused", delivery: "unverified", providerRequestId: null,
    observedAt: "2026-01-01T00:00:00Z", evidence: "provider" } };
// Independent literals shaped from the official 202609 GET/schema examples, never copied from POST bodies.
const account = { id: 123456, currency: "USD", name: "Company A", reference: "urn:li:organization:2414183", servingStatuses: ["RUNNABLE"], status: "ACTIVE", type: "BUSINESS", test: false };
const analytic = { dateRange: { start: { year: 2026, month: 1, day: 1 }, end: { year: 2026, month: 1, day: 1 } },
  pivotValues: ["urn:li:sponsoredCampaign:345396555"], impressions: 40, clicks: 2, externalWebsiteConversions: 1, costInLocalCurrency: "1.25" };
async function seam(provider: "linkedin" | "meta", response: () => object, rows: () => unknown[] = () => [analytic]) {
  const dir = mkdtempSync(join(tmpdir(), "provider-review-")), store = await testStore(join(dir, "db"));
  const requests: URL[] = [];
  const port = new NativeProvider(provider, { use: async (_g, fn) => fn({ accessToken: "fixture-only-token", clientId: "fixture-app", clientSecret: "fixture-only-secret" }) }, store, async (url) => {
    const u = new URL(String(url)); requests.push(u);
    if (u.pathname.endsWith("introspectToken")) return Response.json({ active: true, scope: "rw_ads r_ads_reporting r_organization_admin w_organization_social r_organization_social" });
    if (u.pathname.endsWith("/adAccountUsers")) return Response.json({ elements: [{ account: "urn:li:sponsoredAccount:123456", user: "urn:li:person:fixture", role: "ACCOUNT_MANAGER" }], paging: { start: 0, count: 25, total: 1 } });
    if (u.pathname.endsWith("/organizationAcls")) return Response.json({ elements: [{ organization: "urn:li:organization:2414183", roleAssignee: "urn:li:person:fixture", role: "ADMINISTRATOR", state: "APPROVED" }], paging: { start: 0, count: 25, total: 1 } });
    if (u.pathname.endsWith("/me/permissions")) return Response.json({ data: [{ permission: "ads_management", status: "granted" }] });
    if (u.pathname.endsWith("/42")) return Response.json({ id: "42" });
    if (u.pathname.endsWith("/adAnalytics")) return Response.json({ elements: structuredClone(rows()) });
    return Response.json(response());
  });
  return { port, store, requests, close: async () => { await store.close(); rmSync(dir, { recursive: true, force: true }); } };
}
test("review: LinkedIn verification derives UTC from policy and identity/currency from ordinary no-timezone GET", async () => {
  let observed: any = account;
  const t = await seam("linkedin", () => observed);
  try {
    const result = await t.port.verify(grant);
    assert.equal(result.timezone, "UTC"); assert.equal(result.timezoneSource, "provider_reporting_and_budget_policy");
    assert.equal(result.accountId, "123456"); assert.ok(result.permissions.includes("activate"));
    for (const extras of [{ timeZone: "America/Chicago" }, { timezone: "Pacific/Auckland" }, { timeZone: false, timezone: "UTC" }]) {
      observed = { ...account, ...extras }; assert.equal((await t.port.verify(grant)).timezone, "UTC");
      await assert.rejects(t.port.verify({ ...grant, timezone: "America/Chicago" }), /linkedin_utc_required/);
    }
    for (const id of [undefined, null, false, "", "act_123456", "999", 999, 9007199254740992]) {
      observed = { ...account, id }; await assert.rejects(t.port.verify(grant));
    }
    for (const currency of [undefined, "EUR"]) { observed = { ...account, currency }; await assert.rejects(t.port.verify(grant), /account_context_changed/); }
    observed = account;
    // Safety-pause verification still checks account/currency, without requiring new eligibility or rewriting a legacy zone.
    const legacy = { ...grant, timezone: "America/Chicago" };
    assert.ok((await t.port.verify(legacy, campaign, [], "pause")).permissions.includes("pause"));
  } finally { await t.close(); }
});
test("review: Meta requires documented act_ string identity without numeric coercion", async () => {
  const id = "123456789012345678901234567890";
  const g = { ...grant, provider: "meta" as const, accountId: `act_${id}`, pageId: "42" };
  let observed: any = { id: `act_${id}`, currency: "USD", timezone_name: "UTC", funding_source_details: { id: "f" } };
  const t = await seam("meta", () => observed);
  try {
    assert.equal(accountPath(id), `act_${id}`);
    assert.equal((await t.port.verify(g)).accountId, g.accountId);
    for (const value of [undefined, null, false, 123456, "123456", "act_", "act_x", "act_act_123", "act_999"]) {
      observed = { ...observed, id: value }; await assert.rejects(t.port.verify(g));
    }
    for (const patch of [{ currency: "EUR" }, { timezone_name: undefined }]) {
      observed = { id: `act_${id}`, currency: "USD", timezone_name: "UTC", ...patch }; await assert.rejects(t.port.verify(g));
    }
    for (const value of [123, null, undefined, " 123", "act_x"]) assert.throws(() => accountPath(value));
  } finally { await t.close(); }
});
test("review: LinkedIn reports completed UTC days with inclusive API end, rejecting local DST/partial/future windows", async () => {
  let reportRows: unknown[] = [analytic];
  const t = await seam("linkedin", () => account, () => reportRows);
  try {
    const m = await t.port.metrics(campaign, grant, "2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z");
    assert.equal(m.spendMinor, 125); assert.equal(m.providerConversions, 1);
    assert.equal(m.reportingBasis?.timezoneSource, "provider_reporting_and_budget_policy");
    assert.equal(m.reportingBasis?.completeThrough, "2026-01-02T00:00:00Z");
    const request = t.requests.find(u => u.pathname.endsWith("/adAnalytics"))!;
    assert.equal(request.searchParams.get("dateRange"), "(start:(year:2026,month:1,day:1),end:(year:2026,month:1,day:1))");
    for (const invalid of [
      [{ ...analytic, pivotValues: ["urn:li:sponsoredCampaign:999"] }],
      [{ ...analytic, dateRange: { start: { year: 2026, month: 1, day: 1 }, end: { year: 2026, month: 1, day: 2 } } }],
      [{ ...analytic, dateRange: undefined }], [analytic, analytic],
    ]) {
      reportRows = invalid;
      await assert.rejects(t.port.metrics(campaign, grant, "2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z"), /metrics_scope_mismatch/);
    }
    const before = t.requests.length;
    for (const [from, until] of [["2026-03-08T06:00:00Z", "2026-03-09T05:00:00Z"], ["2026-01-01T00:00:01Z", "2026-01-02T00:00:00Z"], ["2099-01-01T00:00:00Z", "2099-01-02T00:00:00Z"]])
      await assert.rejects(t.port.metrics(campaign, grant, from!, until!));
    await assert.rejects(t.port.metrics(campaign, { ...grant, timezone: "America/Chicago" }, "2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z"), /linkedin_utc_required/);
    assert.equal(t.requests.length, before);
    const client = new LinkedInMarketingClient({ accessToken: "fixture-only-token", clientId: "fixture-app", clientSecret: "fixture-only-secret", fetchImpl: async () => { throw new Error("must reject before transport"); } });
    for (const since of ["2026-01-01T06:00:00Z", "2026-01-01T00:00:00-06:00", "2026-02-30", "2099-01-01"])
      await assert.rejects(client.getAnalytics("123456", { since, until: since }), /inclusive reporting date/);
  } finally { await t.close(); }
});
test("review: full material, project and grant identity bind eligibility; Meta daily semantics cannot be attested away", () => {
  const c = structuredClone(campaign), g = structuredClone(grant); fixtureEligibility(c, g);
  assert.equal(capabilityStatus(c.material, g).accountVerified, true);
  for (const patch of [{ headline: "Changed" }, { budget: { currency: "USD", minor: 9999 } }, { startAt: "2026-01-02T00:00:00Z" }, { assetIds: ["different"] }]) {
    const m = { ...c.material, ...patch }; assert.notEqual(capabilityKey(m, g), capabilityKey(c.material, g)); assert.equal(capabilityStatus(m, g).accountVerified, false);
  }
  assert.equal(capabilityStatus(c.material, { ...g, revokedAt: "2026-01-01T00:00:00Z" }).accountVerified, false);
  assert.equal(capabilityStatus(c.material, { ...g, expiresAt: "2026-01-01T00:00:00Z" }).accountVerified, false);
  for (const patch of [{ projectId: "other" }, { id: "other" }, { revision: 2 }]) assert.equal(capabilityStatus(c.material, { ...g, ...patch }).accountVerified, false);
  for (const patch of [{ timezone: "America/Chicago" }, { startAt: "2026-01-01T01:00:00Z" }]) assert.throws(() => providerPlan({ ...c, material: { ...c.material, ...patch } }, g, []), /linkedin_/);
  c.material.settings = fixtureSettings("meta", "act_123456", "42"); c.material.audience = { provider: "meta", locations: ["US"], ageMin: 18, ageMax: 65, expansion: false };
  Object.assign(g, { provider: "meta", accountId: "act_123456", pageId: "42" }); fixtureEligibility(c, g);
  assert.equal(dailyExposureMinor(c.material), null); assert.equal(capabilityStatus(c.material, g).accountVerified, false);
  assert.throws(() => validateAccountCapability(c, g, true), /meta_daily_budget_semantics_unverified/);
});

test("review: LinkedIn initialization retains image identity and a post-await authority loss prevents upload PUT", async () => {
  let permitted = true, retained = "", writes = 0;
  const client = new LinkedInMarketingClient({ accessToken: "fixture-only-token", clientId: "fixture-app", clientSecret: "fixture-only-secret", fetchImpl: async () => {
    writes++;
    permitted = false;
    return Response.json({ value: { image: "urn:li:image:review", uploadUrl: "https://fixture.invalid/upload" } });
  } });
  client.beforeWrite = async () => { assert.ok(permitted, "scope revoked"); };
  client.onAssetInitialized = async id => { retained = id; };
  await assert.rejects(client.uploadImage({ organizationId: "2414183", bytes: Buffer.from("test bytes") }), /scope revoked/);
  assert.equal(writes, 1); assert.equal(retained, "urn:li:image:review");
});
