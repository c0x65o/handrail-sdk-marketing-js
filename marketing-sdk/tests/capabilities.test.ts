import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CAPABILITY_VERSION, LINKEDIN_COMBINATIONS, META_COMBINATIONS, capabilityBlockers, capabilityKey, capabilityStatus,
  type Asset, type Campaign, type Grant, type MetaSettings, type LinkedInSettings, type ProviderSettings } from "../core/index.js";
import { NativeProvider, providerPlan } from "../server/providers.js";
import { MetaMarketingClient } from "../support/owner-marketing/meta-client.js";
import { FixtureProvider, FixtureAgent, FixtureGeneration } from "../server/fixtures.js";
import { MarketingServer } from "../server/service.js";
import { metaExpansionOff } from "../server/capabilities.js";
import { testStore } from "./datastore.js";
import { byteDigest, digest } from "../server/store.js";

function sample(provider: "meta" | "linkedin") {
  const g: Grant = { id: "g", projectId: "p", revision: 1, provider, accountId: provider === "meta" ? "act_123" : "123", label: "Synthetic transport",
    currency: "USD", timezone: provider === "linkedin" ? "UTC" : "America/Chicago", permissions: ["setup", "prepare", "activate", "pause", "report"], expiresAt: "2099-01-01T00:00:00Z",
    revokedAt: null, secretRef: "synthetic", pageId: "42", instagramUserId: "43", organizationId: "44", targetingOptions: [
      { kind: "locations", id: "urn:li:geo:1", label: "United States" }, { kind: "interests", id: "10", label: "Gardens" },
      { kind: "interests", id: "11", label: "Design" }, { kind: "customAudiences", id: "20", label: "Existing customers" },
      { kind: "jobFunctions", id: "urn:li:function:1", label: "Function" }, { kind: "seniorities", id: "urn:li:seniority:1", label: "Seniority" },
      { kind: "industries", id: "urn:li:industry:1", label: "Industry" }, { kind: "staffCountRanges", id: "urn:li:staffCountRange:(2,10)", label: "Small" },
      { kind: "languages", id: "6", label: "English" }, { kind: "titles", id: "urn:li:title:1", label: "Designer" },
      { kind: "titles", id: "urn:li:title:2", label: "Architect" }, { kind: "employers", id: "urn:li:organization:9", label: "Synthetic company" },
    ] };
  const settings: ProviderSettings = provider === "meta" ? { version: CAPABILITY_VERSION, provider, accountId: g.accountId, apiVersion: "v26.0",
    format: "single_image", objective: "OUTCOME_TRAFFIC", optimization: "LINK_CLICKS", delivery: "ordinary", placements: ["facebook_feed"],
    identity: { pageId: "42" }, targeting: { languages: [], interestGroups: [], excludedCustomAudiences: [] }, nondiscriminationAccepted: true }
    : { version: CAPABILITY_VERSION, provider, accountId: g.accountId, apiVersion: "202609", format: "STANDARD_UPDATE", objective: "WEBSITE_VISIT",
      optimization: "NONE", bid: { mode: "manual", costType: "CPC", amountMinor: 35 }, placements: ["linkedin_feed"], identity: { organizationId: "44" },
      targeting: { include: {}, exclude: {} }, nondiscriminationAccepted: true, politicalConsent: true, politicalIntent: "NOT_POLITICAL" };
  const c: Campaign = { id: "c", projectId: "p", revision: 1, grantId: "g", creativeSetId: "cs", state: "draft", receipt: null,
    material: { name: "Synthetic", headline: "Headline", body: "Body", destination: "https://example.com/kit", destinationDigest: "a".repeat(64),
      assetIds: ["a"], audience: provider === "meta" ? { provider, locations: ["US"], ageMin: 25, ageMax: 54, expansion: false }
        : { provider, locations: ["urn:li:geo:1"], expansion: false }, purpose: "acquisition", settings,
      budget: { currency: "USD", minor: 42000 }, ...(provider === "linkedin" ? { advertisingBudget: { lifetime: { currency: "USD", minor: 42000 }, daily: { currency: "USD", minor: 3000 } } } : {}),
      startAt: provider === "linkedin" ? "2026-10-08T00:00:00Z" : "2026-10-08T05:00:00Z", endAt: provider === "linkedin" ? "2026-10-15T00:00:00Z" : "2026-10-15T05:00:00Z", timezone: g.timezone } };
  const a: Asset = { id: "a", projectId: "p", campaignId: "c", version: 1, kind: "image", digest: "a".repeat(64), mime: "image/png", width: 320,
    height: 180, seconds: null, source: "uploaded", jobId: null, rightsReceipt: "synthetic", parentAssetIds: [] };
  return { c, g, a };
}
function eligible(c: Campaign, g: Grant) {
  g.capabilityEvidence = [{ key: capabilityKey(c.material, g), verifiedAt: "2026-01-01T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z", receipt: "synthetic-intercepted-eligibility-only" }];
}
function metaMode(c: Campaign, row: typeof META_COMBINATIONS[number]) {
  const s = c.material.settings as MetaSettings;
  [s.delivery, s.objective, s.optimization] = row;
  if (s.delivery === "strict") s.targeting = { languages: [{ id: "6", label: "English" }], interestGroups: [[{ id: "10", label: "Gardens" }, { id: "11", label: "Design" }]], excludedCustomAudiences: [{ id: "20", label: "Existing customers" }] };
  if (s.delivery === "employment") {
    c.material.purpose = "recruitment"; c.material.applicantGoal = { event: "ApplicantRequestMOU", meaning: "completed_mou_request" };
    c.material.audience.ageMin = 18; c.material.audience.ageMax = 65;
    s.specialAdCategory = "EMPLOYMENT"; s.specialAdCategoryCountry = "US";
    s.conversion = { pixelId: "60", customConversionId: "61", event: "ApplicantRequestMOU" };
  }
}
function linkedInMode(c: Campaign, row: typeof LINKEDIN_COMBINATIONS[number]) {
  const s = c.material.settings as LinkedInSettings;
  s.objective = row[0]; s.optimization = row[1]; s.bid = row[2] === "manual" ? { mode: "manual", costType: "CPC", amountMinor: 35 } : { mode: "auto", costType: "CPM" };
  if (s.objective === "WEBSITE_CONVERSION") s.conversion = { id: "urn:lla:llaPartnerConversion:55", type: "LEAD", event: "Lead" };
}
test("versioned cross-product allowlists reject unsupported objectives, bids, formats, placement, account and purpose before fixture effects", async () => {
  const dir = mkdtempSync(join(tmpdir(), "capability-denials-")), store = await testStore(join(dir, "db"));
  try {
    await store.db.prepare("INSERT INTO projects VALUES(?,?)").run("p", "synthetic");
    const fixture = new FixtureProvider(store); let writes = 0;
    for (const objective of ["WEBSITE_VISIT", "WEBSITE_CONVERSION", "BRAND_AWARENESS", "ENGAGEMENT", "WEBSITE_VISITS", "JOB_APPLICANT"])
      for (const optimization of ["NONE", "MAX_CLICK", "ENHANCED_CONVERSION", "MAX_CONVERSION", "MAX_REACH"])
        for (const mode of ["manual", "auto"] as const) for (const costType of ["CPC", "CPM"]) {
          const { c, g, a } = sample("linkedin"), s = c.material.settings as LinkedInSettings;
          Object.assign(s, { objective, optimization, bid: { mode, costType, ...(mode === "manual" ? { amountMinor: 35 } : {}) } });
          if (objective === "WEBSITE_CONVERSION") s.conversion = { id: "urn:lla:llaPartnerConversion:55", type: "LEAD", event: "Lead" };
          const allowed = LINKEDIN_COMBINATIONS.some(r => r[0] === objective && r[1] === optimization && r[2] === mode && r[3] === costType);
          if (allowed) assert.equal((providerPlan(c, g, [a]) as any).campaign.optimizationTargetType, optimization);
          else await assert.rejects(fixture.prepare(c, g, [a], "denial", () => {}, () => { writes++; }));
        }
    for (const delivery of ["ordinary", "strict", "employment"] as const) for (const objective of ["OUTCOME_TRAFFIC", "OUTCOME_AWARENESS", "OUTCOME_LEADS"])
      for (const optimization of ["LINK_CLICKS", "IMPRESSIONS", "REACH", "OFFSITE_CONVERSIONS"]) {
        const { c, g, a } = sample("meta"); metaMode(c, META_COMBINATIONS.find(r => r[0] === delivery)!);
        Object.assign(c.material.settings!, { objective, optimization });
        const allowed = META_COMBINATIONS.some(r => r[0] === delivery && r[1] === objective && r[2] === optimization);
        if (allowed) providerPlan(c, g, [a]); else await assert.rejects(fixture.prepare(c, g, [a], "denial", () => {}, () => { writes++; }));
      }
    for (const change of [
      (c: Campaign) => { (c.material.settings as any).format = "document"; },
      (c: Campaign) => { (c.material.settings as any).format = "video"; },
      (c: Campaign) => { (c.material.settings as any).accountId = "act_999"; },
      (c: Campaign) => { (c.material.settings as any).identity.pageId = "999"; },
      (c: Campaign) => { (c.material.settings as any).placements = ["reels"]; },
      (c: Campaign) => { (c.material.settings as any).placements = ["facebook_feed", "facebook_feed"]; },
      (c: Campaign) => { (c.material.settings as any).bid = "arbitrary"; },
      (c: Campaign) => { c.material.purpose = "recruitment"; },
      (c: Campaign) => { (c.material as any).purpose = "unknown"; },
    ]) { const { c, g, a } = sample("meta"); change(c); await assert.rejects(fixture.prepare(c, g, [a], "denial", () => {}, () => { writes++; })); }
    assert.equal(writes, 0); assert.deepEqual(await store.list("p", "fixtureEffect"), []);
    const { c, g, a } = sample("meta"); assert.throws(() => providerPlan(c, g, [{ ...a, campaignId: "other" }]), /ownership/);
  } finally { await store.close(); rmSync(dir, { recursive: true, force: true }); }
});
test("professional Boolean exclusions, resolved labels, employment restrictions and exact evidence keys", () => {
  const { c, g } = sample("linkedin"), s = c.material.settings as LinkedInSettings;
  for (const targeting of [
    { include: { titles: [{ id: "urn:li:title:1", label: "Designer" }], jobFunctions: [{ id: "urn:li:function:1", label: "Function" }] }, exclude: {} },
    { include: { titles: [{ id: "urn:li:title:1", label: "Designer" }], seniorities: [{ id: "urn:li:seniority:1", label: "Level" }] }, exclude: {} },
    { include: { employers: [{ id: "urn:li:organization:9", label: "Employer" }], industries: [{ id: "urn:li:industry:1", label: "Industry" }] }, exclude: {} },
    { include: { employers: [{ id: "urn:li:organization:9", label: "Employer" }], staffCountRanges: [{ id: "urn:li:staffCountRange:(1,1)", label: "One" }] }, exclude: {} },
    { include: { staffCountRanges: [{ id: "urn:li:staffCountRange:(1,1)", label: "One" }] }, exclude: { staffCountRanges: [{ id: "urn:li:staffCountRange:(2,10)", label: "Small" }] } },
  ]) { s.targeting = targeting; assert.ok(capabilityBlockers(c.material).some(x => x.endsWith("conflict"))); }
  s.targeting = { include: { titles: [{ id: "urn:li:title:1", label: "Forged label" }] }, exclude: {} };
  assert.ok(capabilityBlockers(c.material, g).includes("unresolved_targeting_option"));
  const meta = sample("meta"); metaMode(meta.c, META_COMBINATIONS[4]);
  assert.deepEqual(capabilityBlockers(meta.c.material, meta.g), []);
  for (const mutate of [
    (v: any) => { v.settings.specialAdCategory = undefined; }, (v: any) => { v.audience.locations = ["CA"]; },
    (v: any) => { v.audience.ageMin = 25; }, (v: any) => { v.settings.targeting.languages = [{ id: "6", label: "English" }]; },
    (v: any) => { v.settings.conversion.event = "SUBMIT_APPLICATION"; }, (v: any) => { v.applicantGoal.meaning = "hire"; },
  ]) { const m = structuredClone(meta.c.material); mutate(m); assert.ok(capabilityBlockers(m).length > 0); }
  eligible(meta.c, meta.g); assert.equal(capabilityStatus(meta.c.material, meta.g).accountVerified, true);
  assert.equal(capabilityStatus(meta.c.material, { ...meta.g, revision: 2 }).accountVerified, false);
  assert.equal(capabilityStatus(meta.c.material, { ...meta.g, accountId: "act_999" }).accountVerified, false);
  assert.equal(capabilityStatus(meta.c.material, meta.g).deliveryObserved, false);
  const changed = structuredClone(meta.c.material); changed.audience.ageMax = 64;
  assert.notEqual(capabilityKey(changed, meta.g), capabilityKey(meta.c.material, meta.g));
});
test("expansion evidence accepts only two unique explicit zero bits", () => {
  for (const v of [undefined, null, false, "", 0, {}, { detailed_targeting: 0 }, { detailed_targeting: false, lookalike: 0 },
    { detailed_targeting: null, lookalike: 0 }, { detailed_targeting: 0, lookalike: 0, unknown: 0 },
    [{ key: "detailed_targeting", value: 0 }, { key: "detailed_targeting", value: 0 }],
    [{ key: "detailed_targeting", value: 0 }, { key: "lookalike", value: 0, extra: true }]]) assert.equal(metaExpansionOff(v), false);
  assert.equal(metaExpansionOff({ detailed_targeting: 0, lookalike: "0" }), true);
  assert.equal(metaExpansionOff([{ key: "lookalike", value: "0" }, { key: "detailed_targeting", value: 0 }]), true);
});

// Narrow intercepted HTTP edges; durable storage below them is the existing SQL testStore.
async function native(provider: "meta" | "linkedin") {
  const dir = mkdtempSync(join(tmpdir(), "capability-native-")), store = await testStore(join(dir, "db"));
  await store.db.prepare("INSERT INTO projects VALUES(?,?)").run("p", "synthetic");
  const fixture = sample(provider), bytes = readFileSync(new URL("../../marketing-sdk/tests/fixtures/test-pattern.png", import.meta.url));
  fixture.a.digest = byteDigest(bytes);
  await store.db.prepare("INSERT INTO blobs VALUES(?,?,?)").run("p", fixture.a.digest, bytes);
  await store.put("p", "asset", "a", fixture.a);
  const state = { objects: new Map<string, any>(), writes: 0, next: 100, loseRead: false, loseCampaignAck: false,
    requests: [] as { path: string; method: string; fields: string | null }[],
    drift: null as null | ((o: any, kind: string) => void) };
  const fetcher: typeof fetch = async (raw, init) => {
    const url = new URL(String(raw)), path = decodeURIComponent(url.pathname), last = path.split("/").at(-1)!;
    state.requests.push({ path, method: init?.method ?? "GET", fields: url.searchParams.get("fields") });
    const response = (object: any, kind: string) => { const o = structuredClone(object); state.drift?.(o, kind); return Response.json(o); };
    if (provider === "meta") {
      assert.ok(path.startsWith("/v26.0/"));
      if (init?.method === "POST") {
        state.writes++;
        if (last === "campaigns") {
          assert.equal(url.searchParams.get("is_adset_budget_sharing_enabled"), "false");
          assert.equal(url.searchParams.get("status"), "PAUSED");
          assert.equal(url.searchParams.has("daily_spend_cap"), false);
        }
        if (last === "adimages") return Response.json({ images: { file: { hash: "meta-image" } } });
        const body = typeof init.body === "string" ? JSON.parse(init.body) : Object.fromEntries([...url.searchParams].map(([key, value]) => {
          try { return [key, JSON.parse(value)]; } catch { return [key, value]; }
        }));
        if (body.campaign_id) body.campaign_id = String(body.campaign_id);
        if (body.adset_id) body.adset_id = String(body.adset_id);
        if (state.objects.has(last)) { Object.assign(state.objects.get(last), body); return Response.json({ success: true }); }
        const id = String(state.next++);
        if (body.creative) body.creative = { id: String(body.creative.creative_id) };
        if (last === "adsets" && body.promoted_object?.page_id) body.destination_type = "UNDEFINED";
        if (last === "adsets" && body.targeting.targeting_optimization === "none") body.targeting_optimization_types = { detailed_targeting: 0, lookalike: 0 };
        state.objects.set(id, { ...body, id, account_id: "123", _kind: last });
        if (last === "campaigns" && state.loseCampaignAck) throw new Error("synthetic lost campaign create acknowledgment");
        return Response.json({ id });
      }
      if (last === "permissions") return Response.json({ data: [{ permission: "ads_management", status: "granted" }] });
      if (last === "act_123") return response({ id: "act_123", currency: "USD", timezone_name: "America/Chicago", funding_source_details: { id: "fixture-only" } }, "account");
      if (last === "42") return response({ id: "42", instagram_business_account: { id: "43" } }, "page");
      if (last === "61") return response({ id: "61", account_id: "123", pixel: { id: "60" }, rule: JSON.stringify({ and: [{ event: { eq: "ApplicantRequestMOU" } }] }) }, "conversion");
      if (last === "search") return response({ data: [{ id: "10", name: "Gardens" }, { id: "11", name: "Design" }] }, "taxonomy");
      if (last === "customaudiences") return response({ data: [{ id: "20", name: "Existing customers" }] }, "audiences");
      if (last === "adimages") return response({ data: [{ hash: "meta-image", status: "ACTIVE" }] }, "image");
      const o = state.objects.get(last); assert.ok(o, `Unexpected synthetic Meta request ${path}`);
      if (state.loseRead && o._kind === "ads") { state.loseRead = false; throw new Error("synthetic lost read"); }
      const { _kind, ...fields } = o;
      const requested = url.searchParams.get("fields")?.split(",");
      return response(requested ? Object.fromEntries(requested.filter(k => Object.hasOwn(fields, k)).map(k => [k, fields[k]])) : fields, _kind);
    }
    if (path === "/rest/adAccounts/123") return response({ id: 123, currency: "USD" }, "account");
    if (path.includes("/adTargetingEntities")) return response({ elements: fixture.g.targetingOptions!.map(o => ({ urn: o.id, name: o.label })) }, "taxonomy");
    if (path.includes("/conversions/")) {
      const s = fixture.c.material.settings as LinkedInSettings;
      return response({ id: 55, account: "urn:li:sponsoredAccount:123", type: s.conversion?.type, enabled: true,
        name: s.conversion?.event, conversionMethod: "CONVERSIONS_API" }, "conversion");
    }
    if (init?.method === "PUT") {
      state.writes++; if (path.includes("/campaignConversions/")) state.objects.set("association", JSON.parse(String(init.body)));
      return new Response(null, { status: 201 });
    }
    if (last === "campaignConversions") return response({ elements: state.objects.has("association") ? [state.objects.get("association")] : [] }, "associations");
    if (path.includes("/campaignConversions/")) return response(state.objects.get("association"), "association");
    if (init?.method === "POST") {
      state.writes++; const body = JSON.parse(String(init.body));
      if (last === "images") return Response.json({ value: { uploadUrl: "https://fixture.invalid/upload", image: "urn:li:image:fixture" } });
      if (state.objects.has(last)) { Object.assign(state.objects.get(last), body.patch.$set); return new Response(null, { status: 204 }); }
      const id = last === "adCampaignGroups" ? "101" : last === "adCampaigns" ? "102" : "urn:li:sponsoredCreative:103";
      state.objects.set(id, { ...(body.creative ?? body), id, _kind: last });
      return Response.json({}, { status: 201, headers: { "x-restli-id": id } });
    }
    if (path.includes("/images/")) return response({ id: "urn:li:image:fixture", owner: "urn:li:organization:44", status: "AVAILABLE" }, "image");
    const o = state.objects.get(last); assert.ok(o, `Unexpected synthetic LinkedIn request ${path}`);
    if (state.loseRead && o._kind === "creatives") { state.loseRead = false; throw new Error("synthetic lost read"); }
    const { _kind, ...fields } = o; return response(fields, _kind);
  };
  const port = new NativeProvider(provider, { use: async (_g, fn) => fn({ accessToken: "synthetic", clientId: "synthetic", clientSecret: "synthetic" }) }, store, fetcher);
  return { ...fixture, state, port, store, close: async () => { await store.close(); rmSync(dir, { recursive: true, force: true }); } };
}
for (const provider of ["meta", "linkedin"] as const) test(`${provider} every offered combination has full native initial readback, repeat activation and read-only recovery`, async () => {
  const t = await native(provider);
  try {
    const count = (provider === "meta" ? META_COMBINATIONS.length : LINKEDIN_COMBINATIONS.length) * 3;
    for (let i = 0; i < count; i++) {
      t.c.material = sample(provider).c.material;
      if (provider === "meta") { metaMode(t.c, META_COMBINATIONS[Math.floor(i / 3)]!); const s = t.c.material.settings as MetaSettings;
        s.placements = i % 3 === 0 ? ["facebook_feed"] : i % 3 === 1 ? ["instagram_feed"] : ["facebook_feed", "instagram_feed"];
        if (s.placements.includes("instagram_feed")) s.identity.instagramUserId = "43"; }
      else { linkedInMode(t.c, LINKEDIN_COMBINATIONS[Math.floor(i / 3)]!); const s = t.c.material.settings as LinkedInSettings;
        s.targeting = i % 3 === 0 ? { include: { titles: [{ id: "urn:li:title:1", label: "Designer" }, { id: "urn:li:title:2", label: "Architect" }] }, exclude: { employers: [{ id: "urn:li:organization:9", label: "Synthetic company" }] } }
          : i % 3 === 1 ? { include: { jobFunctions: [{ id: "urn:li:function:1", label: "Function" }], seniorities: [{ id: "urn:li:seniority:1", label: "Seniority" }],
            industries: [{ id: "urn:li:industry:1", label: "Industry" }], staffCountRanges: [{ id: "urn:li:staffCountRange:(2,10)", label: "Small" }] }, exclude: {} }
          : { include: { employers: [{ id: "urn:li:organization:9", label: "Synthetic company" }] }, exclude: { titles: [{ id: "urn:li:title:1", label: "Designer" }] } }; }
      t.state.objects.clear(); t.state.next = 100; t.state.loseRead = true;
      eligible(t.c, t.g); let ids: Record<string, string> = {};
      await assert.rejects(t.port.prepare(t.c, t.g, [t.a], `case-${i}`, value => { ids = { ...value }; }, () => {}), /provider_request_failed/);
      assert.ok(ids.creative && ids.campaign); assert.equal(ids.readbackVersion, provider === "meta" ? "4" : "3"); const writes = t.state.writes;
      const payloadDigest = digest(t.port.plan(t.c, t.g, [t.a]));
      const receipt = await t.port.reconcile(t.c, t.g, { kind: "prepare", payloadDigest, receipt: { ids, payloadDigest, intent: "paused", delivery: "unverified", observedAt: new Date().toISOString(), evidence: "provider", providerRequestId: null } });
      assert.ok(receipt); assert.equal(t.state.writes, writes);
      const paused = { ...t.c, state: "paused" as const, receipt };
      const enabled = await t.port.activate(paused, t.g, () => {});
      assert.equal(enabled.intent, "enabled"); assert.equal(enabled.delivery, "unverified");
      const stopped = await t.port.pause({ ...paused, receipt: enabled }, t.g, () => {});
      assert.equal((await t.port.activate({ ...paused, receipt: stopped }, t.g, () => {})).intent, "enabled");
      const prior = t.state.writes;
      await assert.rejects(t.port.activate(paused, { ...t.g, revision: 2 }, () => {}), /account_capability_unverified/);
      assert.equal(t.state.writes, prior);
    }
  } finally { await t.close(); }
});
for (const provider of ["meta", "linkedin"] as const) test(`${provider} initial missing/drifted readback never acquires packet authority; failed preflight makes no writes`, async () => {
  const t = await native(provider);
  try {
    if (provider === "meta") { metaMode(t.c, META_COMBINATIONS[1]); const s = t.c.material.settings as MetaSettings; s.placements = ["instagram_feed"]; s.identity.instagramUserId = "43"; }
    else linkedInMode(t.c, LINKEDIN_COMBINATIONS[2]);
    await assert.rejects(t.port.prepare(t.c, t.g, [t.a], "unverified", () => {}, () => {}), /account_capability_unverified/); assert.equal(t.state.writes, 0);
    eligible(t.c, t.g);
    t.state.drift = (o, kind) => { if (kind === "page") o.instagram_business_account = null; if (kind === "conversion") o.type = "SUBMIT_APPLICATION"; };
    await assert.rejects(t.port.prepare(t.c, t.g, [t.a], "identity", () => {}, () => {})); assert.equal(t.state.writes, 0);
    const changes: [string, (o: any) => void][] = provider === "meta" ? [
      ["campaigns", o => { delete o.id; }], ["adsets", o => { o.id = "999"; }],
      ["adcreatives", o => { delete o.id; }], ["ads", o => { o.id = "999"; }],
      ["account", o => { delete o.timezone_name; }], ["account", o => { o.currency = "EUR"; }],
      ["campaigns", o => { delete o.account_id; }], ["campaigns", o => { o.objective = "OUTCOME_SALES"; }],
      ["adsets", o => { o.targeting.flexible_spec[0].interests.reverse(); }], ["adsets", o => { delete o.targeting.excluded_custom_audiences; }],
      ["adsets", o => { o.targeting.targeting_automation.advantage_audience = false; }], ["adsets", o => { delete o.start_time; }],
      ["adsets", o => { o.end_time = "2026-10-16T05:00:00Z"; }], ["adsets", o => { o.bid_strategy = "LOWEST_COST_WITH_BID_CAP"; }],
      ["adcreatives", o => { delete o.object_story_spec.instagram_user_id; o.object_story_spec.instagram_actor_id = "43"; }],
      ["adcreatives", o => { o.object_story_spec.link_data.image_hash = "wrong"; }], ["ads", o => { o.creative.id = "wrong"; }],
      ["image", o => { o.data[0].status = null; }],
      ...[undefined, null, false, { detailed_targeting: false, lookalike: 0 }, { detailed_targeting: 0, lookalike: 0, unknown: 0 },
        [{ key: "detailed_targeting", value: 0 }, { key: "detailed_targeting", value: 0 }]].map(v => ["adsets", (o: any) => { o.targeting_optimization_types = v; }] as [string, (o: any) => void]),
    ] : [
      ["adCampaignGroups", o => { delete o.id; }], ["adCampaigns", o => { o.id = "999"; }],
      ["creatives", o => { delete o.id; }],
      ["account", o => { o.id = 999; }], ["account", o => { delete o.currency; }],
      ["adCampaigns", o => { delete o.optimizationTargetType; }], ["adCampaigns", o => { o.optimizationTargetType = "NONE"; }],
      ["adCampaigns", o => { delete o.politicalIntent; }], ["adCampaigns", o => { o.audienceExpansionEnabled = null; }],
      ["adCampaigns", o => { o.offsiteDeliveryEnabled = true; }], ["adCampaigns", o => { o.targetingCriteria.exclude = { or: {} }; }],
      ["adCampaigns", o => { o.targetingCriteria.include.and.push(o.targetingCriteria.include.and[0]); }],
      ["adCampaigns", o => { o.runSchedule.end++; }], ["adCampaigns", o => { delete o.unitCost; }],
      ["adCampaigns", o => { o.associatedEntity = "urn:li:organization:99"; }], ["adCampaignGroups", o => { delete o.account; }],
      ["image", o => { o.owner = "urn:li:organization:99"; }], ["image", o => { delete o.status; }],
      ["creatives", o => { o.content = { reference: "urn:li:share:999" }; }],
      ["creatives", o => { o.inlineContent.post.content.media.id = "urn:li:image:wrong"; }],
      ["association", o => { o.conversion = "urn:lla:llaPartnerConversion:99"; }],
      ["associations", o => { o.elements.push({ campaign: "urn:li:sponsoredCampaign:102", conversion: "urn:lla:llaPartnerConversion:99" }); }],
    ];
    for (const [kind, mutate] of changes) {
      t.state.objects.clear(); t.state.next = 100; t.state.drift = (o, k) => { if (k === kind) mutate(o); }; let ids: Record<string, string> = {};
      await assert.rejects(t.port.prepare(t.c, t.g, [t.a], "drift", value => { ids = { ...value }; }, () => {}));
      assert.equal(ids.readbackDigest, undefined, `${kind} must not acquire authority`);
    }
  } finally { await t.close(); }
});

test("LinkedIn OTHER/ApplicantRequestMOU uses its exact association and never job application semantics", async () => {
  const t = await native("linkedin");
  try {
    linkedInMode(t.c, LINKEDIN_COMBINATIONS[3]);
    t.c.material.purpose = "recruitment";
    t.c.material.applicantGoal = { event: "ApplicantRequestMOU", meaning: "completed_mou_request" };
    const s = t.c.material.settings as LinkedInSettings;
    s.conversion = { id: "urn:lla:llaPartnerConversion:55", type: "OTHER", event: "ApplicantRequestMOU" };
    eligible(t.c, t.g);
    for (const mutation of [
      (v: any) => { v.type = "SUBMIT_APPLICATION"; }, (v: any) => { v.name = "jobApplications"; },
      (v: any) => { delete v.conversionMethod; }, (v: any) => { v.enabled = null; },
      (v: any) => { v.account = "urn:li:sponsoredAccount:999"; },
    ]) { t.state.drift = (v, kind) => { if (kind === "conversion") mutation(v); };
      await assert.rejects(t.port.prepare(t.c, t.g, [t.a], "wrong-applicant-event", () => {}, () => {}));
      assert.equal(t.state.writes, 0);
    }
    t.state.drift = null;
    const receipt = await t.port.prepare(t.c, t.g, [t.a], "exact-applicant-event", () => {}, () => {});
    assert.equal(receipt.intent, "paused"); assert.equal(receipt.ids.conversion, s.conversion.id);
    assert.equal(t.state.objects.get("102").objectiveType, "WEBSITE_CONVERSION");
    assert.equal(t.state.objects.get("102").optimizationTargetType, "MAX_CONVERSION");
  } finally { await t.close(); }
});

test("review: post-await scope changes stop before native writes and expired eligibility still permits pause", async () => {
  const t = await native("linkedin");
  try {
    eligible(t.c, t.g);
    await assert.rejects(t.port.prepare(t.c, t.g, [t.a], "scope-change", () => {}, () => { t.g.revision++; }), /provider_scope_changed/);
    assert.equal(t.state.writes, 0);
    eligible(t.c, t.g);
    const receipt = await t.port.prepare(t.c, t.g, [t.a], "prepare", () => {}, () => {});
    const prepared = { ...t.c, receipt };
    const activated = await t.port.activate(prepared, t.g, () => {});
    t.g.capabilityEvidence = [];
    const paused = await t.port.pause({ ...prepared, receipt: activated }, t.g, () => {});
    assert.equal(paused.intent, "paused"); assert.deepEqual(paused.ids, receipt.ids);
    await assert.rejects(t.port.activate({ ...prepared, receipt: paused }, t.g, () => {}), /account_capability_unverified/);
  } finally { await t.close(); }
});
test("review: unexpected LinkedIn conversions block even objectives without a requested conversion", async () => {
  const t = await native("linkedin");
  try {
    eligible(t.c, t.g);
    t.state.drift = (o, kind) => { if (kind === "associations") o.elements = [{ campaign: "urn:li:sponsoredCampaign:102", conversion: "urn:lla:llaPartnerConversion:99", associatedAt: 1503516717694 }]; };
    let ids: Record<string, string> = {};
    await assert.rejects(t.port.prepare(t.c, t.g, [t.a], "unexpected-conversion", value => { ids = value; }, () => {}), /unexpected_conversion_associations/);
    assert.equal(ids.readbackDigest, undefined);
  } finally { await t.close(); }
});

// Independent GET documents: no request body is used to synthesize these responses.
// Fixtures exercise documented schema shapes, not provider eligibility or delivery.
for (const provider of ["meta", "linkedin"] as const) test(`review: ${provider} matrix reconciles independent GET-shaped records without writes`, async () => {
  const t = await native(provider);
  try {
    const modes = provider === "meta" ? META_COMBINATIONS.length * 3 : LINKEDIN_COMBINATIONS.length;
    for (let i = 0; i < modes; i++) {
      t.c.material = sample(provider).c.material; t.state.objects.clear();
      let ids: Record<string, string>;
      if (provider === "meta") {
        const row = META_COMBINATIONS[Math.floor(i / 3)]!; metaMode(t.c, row);
        const s = t.c.material.settings as MetaSettings;
        s.placements = i % 3 === 0 ? ["facebook_feed"] : i % 3 === 1 ? ["instagram_feed"] : ["facebook_feed", "instagram_feed"];
        const instagram = i % 3 !== 0, facebook = i % 3 !== 1;
        if (instagram) s.identity.instagramUserId = "43";
        ids = { readbackVersion: "4", campaign: "100", adset: "101", creative: "102", ad: "103", image: "meta-image" };
        const strict = row[0] === "strict", employment = row[0] === "employment", awareness = row[1] === "OUTCOME_AWARENESS";
        t.state.objects.set("100", { _kind: "campaigns", id: "100", account_id: "123", status: "PAUSED", is_adset_budget_sharing_enabled: false, objective: row[1],
          special_ad_categories: employment ? ["EMPLOYMENT"] : [], ...(employment ? { special_ad_category_country: ["US"] } : {}) });
        t.state.objects.set("101", { _kind: "adsets", id: "101", account_id: "123", campaign_id: "100", status: "PAUSED",
          billing_event: "IMPRESSIONS", optimization_goal: row[2], bid_strategy: "LOWEST_COST_WITHOUT_CAP", lifetime_budget: "42000",
          start_time: "2026-10-08T05:00:00+0000", end_time: "2026-10-15T05:00:00+0000", destination_type: awareness ? "UNDEFINED" : "WEBSITE",
          ...(awareness ? { promoted_object: { page_id: "42" } } : employment ? { promoted_object: { pixel_id: "60", custom_conversion_id: "61" } } : {}),
          targeting: { geo_locations: { countries: ["US"] }, age_min: employment ? 18 : 25, age_max: employment ? 65 : 54,
            publisher_platforms: facebook && instagram ? ["facebook", "instagram"] : [facebook ? "facebook" : "instagram"],
            ...(facebook ? { facebook_positions: ["feed"] } : {}), ...(instagram ? { instagram_positions: ["stream"] } : {}),
            targeting_automation: { advantage_audience: 0 }, ...(strict ? { locales: [6], targeting_optimization: "none",
              flexible_spec: [{ interests: [{ id: "10", name: "Gardens" }, { id: "11", name: "Design" }] }],
              excluded_custom_audiences: [{ id: "20", name: "Existing customers" }] } : {}) },
          ...(strict ? { targeting_optimization_types: [{ key: "detailed_targeting", value: "0" }, { key: "lookalike", value: "0" }] } : {}) });
        t.state.objects.set("102", { _kind: "adcreatives", id: "102", account_id: "123", object_story_spec: { page_id: "42",
          ...(instagram ? { instagram_user_id: "43" } : {}), link_data: { image_hash: "meta-image", link: "https://example.com/kit", message: "Body", name: "Headline",
            call_to_action: { type: "LEARN_MORE", value: { link: "https://example.com/kit" } } } } });
        t.state.objects.set("103", { _kind: "ads", id: "103", account_id: "123", adset_id: "101", creative: { id: "102" }, status: "PAUSED" });
      } else {
        const row = LINKEDIN_COMBINATIONS[i]!; linkedInMode(t.c, row);
        ids = { readbackVersion: "3", group: "101", campaign: "102", creative: "103", image: "urn:li:image:fixture" };
        if (row[0] === "WEBSITE_CONVERSION") {
          ids.conversion = "urn:lla:llaPartnerConversion:55";
          t.state.objects.set("association", { campaign: "urn:li:sponsoredCampaign:102", conversion: "urn:lla:llaPartnerConversion:55", associatedAt: 1503516717694 });
        }
        const runSchedule = { start: Date.parse("2026-10-08T00:00:00Z"), end: Date.parse("2026-10-15T00:00:00Z") };
        t.state.objects.set("101", { _kind: "adCampaignGroups", id: 101, account: "urn:li:sponsoredAccount:123", status: "DRAFT", totalBudget: { amount: "420", currencyCode: "USD" }, runSchedule });
        t.state.objects.set("102", { _kind: "adCampaigns", id: 102, account: "urn:li:sponsoredAccount:123", campaignGroup: "urn:li:sponsoredCampaignGroup:101",
          associatedEntity: "urn:li:organization:44", status: "DRAFT", objectiveType: row[0], optimizationTargetType: row[1], type: "SPONSORED_UPDATES", format: "STANDARD_UPDATE",
          costType: row[3], unitCost: { amount: row[2] === "manual" ? "0.3500" : "0.00", currencyCode: "USD" }, dailyBudget: { amount: "30", currencyCode: "USD" },
          runSchedule, targetingCriteria: { include: { and: [{ or: { "urn:li:adTargetingFacet:locations": ["urn:li:geo:1"] } }] } },
          audienceExpansionEnabled: false, offsiteDeliveryEnabled: false, connectedTelevisionOnly: false, politicalIntent: "NOT_POLITICAL", locale: { country: "US", language: "en" } });
        t.state.objects.set("urn:li:sponsoredCreative:103", { _kind: "creatives", id: "urn:li:sponsoredCreative:103", campaign: "urn:li:sponsoredCampaign:102", intendedStatus: "DRAFT", content: { reference: "urn:li:share:700" } });
        t.state.objects.set("urn:li:share:700", { _kind: "posts", id: "urn:li:share:700", author: "urn:li:organization:44", commentary: "Body", contentLandingPage: "https://example.com/kit", contentCallToActionLabel: "LEARN_MORE",
          content: { media: { id: "urn:li:image:fixture", title: "Headline" } }, distribution: { feedDistribution: "NONE", thirdPartyDistributionChannels: [] }, lifecycleState: "PUBLISHED", visibility: "PUBLIC" });
      }
      const payloadDigest = digest(t.port.plan(t.c, t.g, [t.a]));
      const input = { kind: "prepare", payloadDigest, receipt: { ids, payloadDigest, intent: "paused" as const, delivery: "unverified" as const, providerRequestId: null, observedAt: "2026-01-01T00:00:00Z", evidence: "provider" as const } };
      assert.ok(await t.port.reconcile(t.c, t.g, input), `${provider} combination ${i}`);
      assert.equal(t.state.writes, 0);
      if (provider === "linkedin") {
        const object = t.state.objects.get("102");
        for (const amount of [null, false, "", "30.001", "3e1", 30]) {
          object.dailyBudget.amount = amount;
          assert.equal(await t.port.reconcile(t.c, t.g, input), null, `money ${amount} must be unknown/drift`);
        }
      }
    }
  } finally { await t.close(); }
});

const unknownSharing = [undefined, null, true, 0, 1, "false", "true", "0", "", [], {}, { value: false }];
test("Meta v4 sharing is literal false on native HTTP; every unknown/drift value blocks initial readback, recovery and activation", async () => {
  const t = await native("meta");
  try {
    eligible(t.c, t.g);
    const plan: any = t.port.plan(t.c, t.g, [t.a]);
    assert.equal(plan.readbackVersion, "4");
    assert.equal(plan.campaign.is_adset_budget_sharing_enabled, false);
    for (const value of unknownSharing) {
      t.state.objects.clear(); t.state.next = 100;
      t.state.drift = (o, k) => { if (k === "campaigns") o.is_adset_budget_sharing_enabled = value; };
      let ids: Record<string, string> = {};
      await assert.rejects(t.port.prepare(t.c, t.g, [t.a], "sharing", v => { ids = { ...v }; }, () => {}), /meta_budget_sharing_unverified/);
      assert.equal(ids.readbackVersion, "4"); assert.equal(ids.readbackDigest, undefined);
      assert.ok(ids.ad); // Complete IDs retained, no packet authority from an incomplete snapshot.
      const partial = { ids, payloadDigest: digest(plan), intent: "paused" as const, delivery: "unverified" as const,
        providerRequestId: null, observedAt: "2026-01-01T00:00:00Z", evidence: "provider" as const };
      const writes = t.state.writes;
      assert.equal(await t.port.reconcile(t.c, t.g, { kind: "prepare", payloadDigest: partial.payloadDigest, receipt: partial }), null);
      assert.equal(t.state.writes, writes);
    }
    t.state.drift = null; t.state.objects.clear(); t.state.next = 100;
    const receipt = await t.port.prepare(t.c, t.g, [t.a], "false", () => {}, () => {});
    const c = { ...t.c, receipt, state: "paused" as const };
    const savedReceipt = structuredClone(receipt), writes = t.state.writes;
    for (const value of unknownSharing) {
      t.state.drift = (o, k) => { if (k === "campaigns") o.is_adset_budget_sharing_enabled = value; };
      await assert.rejects(t.port.activate(c, t.g, () => {}), /meta_budget_sharing_unverified/);
      assert.equal(await t.port.reconcile(c, t.g, { kind: "prepare", payloadDigest: receipt.payloadDigest, receipt }), null);
      assert.equal(t.state.writes, writes); assert.deepEqual(receipt, savedReceipt);
    }
    t.state.drift = null;
    const active = await t.port.activate(c, t.g, () => {});
    // A status acknowledgment cannot bless sharing changed during activation.
    t.state.drift = (o, k) => { if (k === "campaigns") o.is_adset_budget_sharing_enabled = true; };
    assert.equal(await t.port.reconcile(c, t.g, { kind: "activate", payloadDigest: active.payloadDigest, receipt: active }), null);
    t.state.drift = null;
    await t.port.pause({ ...c, receipt: active }, t.g, () => {});
    await assert.rejects(t.port.activate(c, t.g, () => {
      t.state.objects.get("100").is_adset_budget_sharing_enabled = true;
    }), /provider_outcome_unknown/);
    assert.ok(t.state.requests.some(r => r.path.endsWith("/100") && r.fields?.includes("is_adset_budget_sharing_enabled")));
  } finally { await t.close(); }
});

test("Meta client refuses omitted, enabling or malformed sharing input before transport", async () => {
  let calls = 0;
  const client = new MetaMarketingClient({ accessToken: "fixture", fetchImpl: async () => { calls++; throw new Error("unexpected transport"); } });
  for (const value of unknownSharing) await assert.rejects(client.createPausedObject("act_123", "campaign", {
    objective: "OUTCOME_TRAFFIC", status: "PAUSED", is_adset_budget_sharing_enabled: value,
  }), /explicitly false/);
  assert.equal(calls, 0);
});

test("Meta lost campaign-create acknowledgment retains only known IDs; no automatic transport retry or invented recovery", async () => {
  const t = await native("meta");
  try {
    eligible(t.c, t.g); t.state.loseCampaignAck = true;
    let ids: Record<string, string> = {};
    await assert.rejects(t.port.prepare(t.c, t.g, [t.a], "lost-create", v => { ids = { ...v }; }, () => {}), /provider_request_failed/);
    assert.deepEqual(ids, { readbackVersion: "4", image: "meta-image" });
    assert.equal(t.state.writes, 2); // Image + uncertain campaign; no automatic retry.
    assert.equal(t.state.objects.get("100").is_adset_budget_sharing_enabled, false);
    const payloadDigest = digest(t.port.plan(t.c, t.g, [t.a]));
    assert.equal(await t.port.reconcile(t.c, t.g, { kind: "prepare", payloadDigest, receipt: {
      ids, payloadDigest, intent: "paused", delivery: "unverified", providerRequestId: null,
      observedAt: "2026-01-01T00:00:00Z", evidence: "provider",
    } }), null);
    assert.equal(t.state.writes, 2);
  } finally { await t.close(); }
});

test("Meta v1/v2/v3 receipts retain exact inspection digests and safety pause, never upgrade or qualify new activation", async () => {
  const t = await native("meta");
  try {
    eligible(t.c, t.g);
    const current = await t.port.prepare(t.c, t.g, [t.a], "current", () => {}, () => {});
    for (const version of [undefined, "1", "2", "3"]) {
      const explicit = version === "3", budget = version === "2" || explicit;
      // Historical GET field sets, independent of the implementation's version selection.
      const pick = (id: string, keys: string[]) => Object.fromEntries(keys.filter(k => Object.hasOwn(t.state.objects.get(id), k)).map(k => [k, t.state.objects.get(id)[k]]));
      const oldMaterial = {
        ...(explicit ? { account: { id: "act_123", currency: "USD", timezone: "America/Chicago" }, image: { hash: "meta-image", status: "ACTIVE" } } : {}),
        campaign: pick("100", ["id", "objective", "special_ad_categories", ...(budget ? ["spend_cap"] : []), ...(explicit ? ["account_id", "special_ad_category_country"] : [])]),
        adset: pick("101", ["id", "campaign_id", "billing_event", "optimization_goal", "bid_strategy", "lifetime_budget", ...(budget ? ["daily_budget"] : []), "start_time", "end_time", "targeting", ...(explicit ? ["account_id", "destination_type", "promoted_object", "targeting_optimization_types"] : [])]),
        creative: pick("102", ["id", ...(explicit ? ["account_id"] : []), "object_story_spec"]),
        ad: pick("103", ["id", ...(explicit ? ["account_id"] : []), "adset_id", "creative"]),
      };
      const { readbackVersion: _version, ...ids } = current.ids;
      const receipt = { ...current, payloadDigest: `immutable-historical-${version ?? "v1"}`, ids: {
        ...ids, ...(version ? { readbackVersion: version } : {}), readbackDigest: digest(oldMaterial) } };
      const c = { ...t.c, receipt, state: "paused" as const }, saved = structuredClone(receipt);
      const operation = { kind: "prepare", payloadDigest: receipt.payloadDigest, receipt };
      for (const value of [undefined, false, true]) {
        t.state.objects.get("100").is_adset_budget_sharing_enabled = value;
        assert.deepEqual((await t.port.reconcile(c, t.g, operation))?.ids, receipt.ids);
        const writes = t.state.writes;
        await assert.rejects(t.port.activate(c, t.g, () => {}), /meta_readback_requalification_required/);
        assert.equal(t.state.writes, writes);
      }
      for (const id of ["100", "101", "103"]) t.state.objects.get(id).status = "ACTIVE";
      assert.equal((await t.port.reconcile(c, t.g, { ...operation, kind: "activate" }))?.intent, "enabled");
      const paused = await t.port.pause({ ...c, state: "enabled" }, { ...t.g, capabilityEvidence: [] }, () => {});
      assert.equal(paused.intent, "paused"); assert.deepEqual(paused.ids, saved.ids); assert.equal(paused.payloadDigest, saved.payloadDigest);
      assert.deepEqual(receipt, saved);
      if (version === "3") {
        // Exercise the service too: receipt-based pause must survive the new
        // plan digest while CURRENT actor, grant and lease still fence writes.
        await t.store.db.acquireExecutor();
        const principal = { userId: await t.store.createUser("historical-pause-review", "") };
        await t.store.db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(principal.userId, "p", "admin");
        await t.store.put("p", "grant", t.g.id, t.g);
        await t.store.put("p", "campaign", c.id, { ...c, state: "enabled" });
        await t.store.put("p", "destination", c.material.destinationDigest, { url: c.material.destination, source: "public_https" });
        const server = new MarketingServer(t.store, { meta: t.port, linkedin: t.port, google: t.port }, new FixtureGeneration(), new FixtureAgent(t.store), "live");
        for (const guard of ["actor", "grant", "lease"] as const) {
          const op = await server.call(principal, "p", "pause", { campaignId: c.id, requestKey: `pause-${guard}` });
          const writes = t.state.writes;
          if (guard === "actor") await t.store.db.prepare("UPDATE memberships SET role=? WHERE user_id=?").run("analyst", principal.userId);
          if (guard === "grant") await t.store.put("p", "grant", t.g.id, { ...t.g, revision: t.g.revision + 1 });
          if (guard === "lease") await t.store.db.prepare("INSERT INTO leases VALUES(?,?,?)").run("p", t.g.accountId, "retained-unknown-operation");
          const blocked = await server.dispatch("p", op.id);
          assert.equal(blocked.state, "blocked");
          assert.equal(blocked.reason, guard === "actor" ? "forbidden" : guard === "grant" ? "grant_changed" : "account_execution_pending");
          assert.equal(t.state.writes, writes);
          await t.store.db.prepare("UPDATE memberships SET role=? WHERE user_id=?").run("admin", principal.userId);
          await t.store.put("p", "grant", t.g.id, t.g);
          if (guard === "lease") await t.store.db.prepare("DELETE FROM leases WHERE project_id=?").run("p");
        }
        for (const id of ["100", "101", "103"]) t.state.objects.get(id).status = "ACTIVE";
        const op = await server.call(principal, "p", "pause", { campaignId: c.id, requestKey: "historical-safe-pause" });
        assert.equal(op.payloadDigest, receipt.payloadDigest);
        const done = await server.dispatch("p", op.id);
        assert.equal(done.state, "succeeded", done.reason ?? "");
        assert.deepEqual(done.receipt?.ids, receipt.ids);
        assert.equal(done.receipt?.payloadDigest, receipt.payloadDigest);
      }
      const { readbackDigest: _digest, ...partialIds } = receipt.ids;
      assert.equal(await t.port.reconcile(c, t.g, { ...operation, receipt: { ...receipt, ids: partialIds } }), null);
    }
    assert.equal(await t.port.reconcile(t.c, t.g, { kind: "prepare", payloadDigest: current.payloadDigest,
      receipt: { ...current, ids: { ...current.ids, readbackVersion: "5" } } }), null);
  } finally { await t.close(); }
});

test("Meta daily remains denied by native prepare/activate despite exact account evidence; v4 does not qualify REACH normalization", async () => {
  const t = await native("meta");
  try {
    t.c.material.advertisingBudget = { lifetime: t.c.material.budget, daily: { currency: "USD", minor: 3000 } };
    eligible(t.c, t.g);
    // Planning can represent a denied daily request; no budget rewrite or new cap is inferred.
    const plan: any = t.port.plan(t.c, t.g, [t.a]);
    assert.equal(plan.campaign.is_adset_budget_sharing_enabled, false);
    assert.equal(plan.adset.daily_budget, "3000"); assert.equal(plan.adset.daily_spend_cap, undefined);
    assert.equal(capabilityStatus(t.c.material, t.g).accountVerified, false);
    await assert.rejects(t.port.prepare(t.c, t.g, [t.a], "daily", () => {}, () => {}), /meta_daily_budget_semantics_unverified/);
    await assert.rejects(t.port.activate({ ...t.c, receipt: { ids: { readbackVersion: "4", readbackDigest: "saved" }, payloadDigest: "saved",
      intent: "paused", delivery: "unverified", observedAt: "2026-01-01T00:00:00Z", evidence: "provider", providerRequestId: null } }, t.g, () => {}), /meta_daily_budget_semantics_unverified/);
    assert.equal(t.state.requests.length, 0);
    delete t.c.material.advertisingBudget;
    metaMode(t.c, META_COMBINATIONS.find(r => r[2] === "REACH")!); eligible(t.c, t.g);
    t.state.drift = (o, k) => { if (k === "adsets") { o.optimization_goal = "IMPRESSIONS"; o.frequency_control_specs = [{ event: "IMPRESSIONS", interval_days: 7, max_frequency: 2 }]; } };
    await assert.rejects(t.port.prepare(t.c, t.g, [t.a], "normalized", () => {}, () => {}), /provider_effective_material_mismatch/);
  } finally { await t.close(); }
});

test("Meta v4 SQL operation retains unknown HTTP effects, forbids retry replay and only reconciles observed false", async () => {
  const t = await native("meta");
  try {
    await t.store.db.acquireExecutor();
    const principal = { userId: await t.store.createUser("sharing-fixture", "") };
    await t.store.db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(principal.userId, "p", "admin");
    const destination = Buffer.from("intercepted destination");
    t.c.material.destinationDigest = byteDigest(destination); eligible(t.c, t.g);
    await t.store.put("p", "destination", t.c.material.destinationDigest, { url: t.c.material.destination, source: "public_https" });
    await t.store.put("p", "grant", t.g.id, t.g);
    await t.store.put("p", "campaign", t.c.id, t.c);
    await t.store.put("p", "setup", "s", { id: "s", grantId: t.g.id, state: "ready" });
    const server = new MarketingServer(t.store, { meta: t.port, linkedin: t.port, google: t.port },
      new FixtureGeneration(), new FixtureAgent(t.store), "live", () => Date.now(), async () => destination);
    const input = { campaignId: t.c.id, requestKey: "sharing-create" };
    const op = await server.call(principal, "p", "prepare", input);
    t.state.loseRead = true;
    const unknown = await server.dispatch("p", op.id);
    assert.equal(unknown.state, "unknown"); assert.equal(unknown.receipt?.ids.readbackVersion, "4");
    assert.ok(unknown.receipt?.ids.ad); assert.equal(unknown.receipt?.ids.readbackDigest, undefined);
    const writes = t.state.writes;
    assert.equal((await server.call(principal, "p", "prepare", input)).id, op.id);
    await assert.rejects(server.call(principal, "p", "prepare", { ...input, requestKey: "different" }), /existing_operation_requires_reconciliation/);
    assert.equal((await server.dispatch("p", op.id)).state, "unknown");
    for (const value of unknownSharing) {
      t.state.drift = (o, k) => { if (k === "campaigns") o.is_adset_budget_sharing_enabled = value; };
      assert.equal((await server.call(principal, "p", "reconcile", { operationId: op.id })).state, "unknown");
      assert.equal(Number((await t.store.db.prepare("SELECT COUNT(*) AS n FROM leases").get())!.n), 1);
    }
    assert.equal(t.state.writes, writes);
    t.state.drift = null;
    const result = await server.call(principal, "p", "reconcile", { operationId: op.id });
    assert.equal(result.state, "succeeded"); assert.equal(result.receipt?.ids.readbackVersion, "4");
    assert.equal(t.state.writes, writes);
    // The same headless live service continues to deny daily preparation at dispatch.
    const daily = { ...t.c, id: "daily", material: { ...t.c.material,
      advertisingBudget: { lifetime: t.c.material.budget, daily: { currency: "USD", minor: 3000 } } } };
    await t.store.put("p", "asset", t.a.id, { ...t.a, campaignId: daily.id });
    eligible(daily, t.g); await t.store.put("p", "grant", t.g.id, t.g); await t.store.put("p", "campaign", daily.id, daily);
    const denied = await server.call(principal, "p", "prepare", { campaignId: daily.id, requestKey: "daily" });
    const blocked = await server.dispatch("p", denied.id);
    assert.equal(blocked.state, "blocked"); assert.equal(blocked.reason, "meta_daily_budget_semantics_unverified");
    assert.equal(t.state.writes, writes);
  } finally { await t.close(); }
});
