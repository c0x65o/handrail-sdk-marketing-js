import test from "node:test";
import assert from "node:assert/strict";
import { collectProviderMeasurement, MetaMeasurementClient, LinkedInMeasurementClient, providerMoneyMinor, type CollectionOptions } from "../server/measurement-collectors.js";
import { buildMeasurementEvidence } from "../server/measurement.js";

const metaRow = (day: string, extras: object = {}) => ({ account_id: "10", campaign_id: "20", date_start: day, date_stop: day,
  spend: "1.005", impressions: "100", clicks: "5", outbound_clicks: [{ action_type: "outbound_click", value: "2" }],
  outbound_clicks_ctr: [{ action_type: "outbound_click", value: "2" }], cpm: "10.05", actions: [{ action_type: "lead", value: "1" }], ...extras });
function options(client: CollectionOptions["client"]): CollectionOptions {
  return { client,
    identity: { projectId: "p", nativeCampaignId: "n", sdkCampaignId: null, provider: client.provider, accountId: "10", campaignIds: ["20"], materialVersion: null, purpose: "acquisition" },
    window: { from: "2026-01-01T00:00:00.000Z", until: "2026-01-03T00:00:00.000Z", timezone: "UTC", currency: "USD", minorUnitsPerMajor: 100 },
    verifiedScope: { accountId: "10", campaignIds: ["20"], currency: "USD", timezone: "UTC", evidenceRefs: ["binding-verified"] },
    delivery: { configuredStatus: "ACTIVE", effectiveStatus: "ACTIVE", evidenceRefs: ["status-read"] }, outcomes: null,
    maturity: { state: "unknown", reason: "coverage_unverified", evidenceRefs: [], coverageVerified: false, reportingLagEndsAt: null, attributionEndsAt: null, rereadAt: null },
    now: () => "2026-01-05T00:00:00.000Z", sourceKind: "synthetic", retry: { attempts: 2, wait: async () => {} } };
}
test("Meta collector follows cursor on trusted endpoint and retains safe evidence with exact decimal rounding", async () => {
  const urls: URL[] = [];
  const client = new MetaMeasurementClient({ accessToken: "fixture-token", appSecret: "fixture-secret", fetchImpl: async (url, init) => {
    const u = new URL(String(url)); urls.push(u); assert.equal(init?.method, "GET");
    assert.equal(u.hostname, "graph.facebook.com"); assert.equal(u.searchParams.get("time_increment"), "1");
    return Response.json(u.searchParams.get("after") === "second" ? { data: [metaRow("2026-01-02")] }
      : { data: [metaRow("2026-01-01")], paging: { next: "https://untrusted.invalid/?access_token=fixture-token", cursors: { after: "second" } } });
  } });
  const result = await collectProviderMeasurement(options({ provider: "meta", client })), evidence = buildMeasurementEvidence(result);
  assert.equal(urls.length, 2); assert.equal(evidence.metrics.spendMinor.value, 202);
  assert.equal(evidence.metrics.weightedCpm.value, 10.1);
  assert.equal(evidence.metrics.outboundCtrPercent.value, 2);
  assert.equal(evidence.metrics.providerConversions.value, null);
  assert.equal(evidence.rows[0]!.providerCpm.value, 10.05);
  assert.equal(evidence.reconciliation.status, "discrepant");
  assert.ok(!JSON.stringify(evidence).includes("fixture-token")); assert.ok(!JSON.stringify(evidence).includes("fixture-secret"));
  assert.equal(evidence.snapshots?.length, 1);
  assert.equal(providerMoneyMinor("9007199254740992", 100).reason, "provider_money_overflow");
});
test("transient reads retry with separate receipts; denied reads stay unknown and are not retried", async () => {
  let calls = 0;
  const client = new MetaMeasurementClient({ accessToken: "private", fetchImpl: async () => ++calls === 1
    ? Response.json({ error: { message: "private", code: 4 } }, { status: 429 })
    : Response.json({ data: [metaRow("2026-01-01"), metaRow("2026-01-02")] }) });
  const collected = await collectProviderMeasurement(options({ provider: "meta", client }));
  assert.equal(collected.snapshots?.length, 2); assert.equal(collected.snapshots?.[0]?.error, "rate_limited");
  assert.equal(buildMeasurementEvidence(collected).coverage.complete, true);
  calls = 0;
  client.fetchImpl = async () => { calls++; return Response.json({ error: { code: 190, message: "private expired" } }, { status: 401 }); };
  const denied = buildMeasurementEvidence(await collectProviderMeasurement(options({ provider: "meta", client })));
  assert.equal(calls, 1); assert.equal(denied.metrics.spendMinor.value, null); assert.equal(denied.source.missingReason, "permission_error");
  assert.ok(!JSON.stringify(denied).includes("private"));
});
test("an incomplete second page or foreign campaign cannot become a successful zero or partial total", async () => {
  let calls = 0;
  const client = new MetaMeasurementClient({ accessToken: "fixture", fetchImpl: async () => {
    calls++; return Response.json({ data: [metaRow("2026-01-01")], paging: { next: "ignored", cursors: { after: "same" } } });
  } });
  const loop = buildMeasurementEvidence(await collectProviderMeasurement(options({ provider: "meta", client })));
  assert.equal(calls, 2); assert.equal(loop.source.missingReason, "provider_pagination_incomplete"); assert.equal(loop.metrics.impressions.value, null);
  client.fetchImpl = async () => Response.json({ data: [metaRow("2026-01-01", { campaign_id: "21" })] });
  const foreign = buildMeasurementEvidence(await collectProviderMeasurement(options({ provider: "meta", client })));
  assert.equal(foreign.source.missingReason, "measurement_row_scope_mismatch"); assert.equal(foreign.metrics.spendMinor.value, null);
});
test("placement rows reconcile separately and never double campaign totals", async () => {
  const client = new MetaMeasurementClient({ accessToken: "fixture", fetchImpl: async url => {
    const placements = new URL(String(url)).searchParams.has("breakdowns");
    return Response.json({ data: ["2026-01-01", "2026-01-02"].map(day => metaRow(day, placements ? { publisher_platform: "instagram", platform_position: "stream" } : {})) });
  } });
  const collected = await collectProviderMeasurement({ ...options({ provider: "meta", client }), includePlacements: true });
  const evidence = buildMeasurementEvidence(collected);
  assert.equal(evidence.metrics.spendMinor.value, 202); assert.equal(evidence.placements?.rows.length, 2); assert.equal(evidence.placements?.complete, true);
  collected.placements!.rows[0]!.impressions.value = 50;
  assert.throws(() => buildMeasurementEvidence(collected), /measurement_snapshot_integrity_mismatch/);
  client.fetchImpl = async url => {
    const placements = new URL(String(url)).searchParams.has("breakdowns");
    return Response.json({ data: ["2026-01-01", "2026-01-02"].map(day => metaRow(day, placements ? { publisher_platform: "instagram", platform_position: "stream", impressions: "50" } : {})) });
  };
  const mismatch = await collectProviderMeasurement({ ...options({ provider: "meta", client }), includePlacements: true });
  assert.equal(buildMeasurementEvidence(mismatch).placements?.reason, "placement_totals_not_reconciled");
});
test("LinkedIn collector retains UTC, campaign-scoped placement and conversion semantics", async () => {
  const client = new LinkedInMeasurementClient({ accessToken: "fixture", clientId: "client", clientSecret: "secret", fetchImpl: async (url, init) => {
    assert.equal(init?.method, "GET"); const u = new URL(String(url));
    assert.equal(u.searchParams.get("campaigns"), "List(urn:li:sponsoredCampaign:20)");
    const placement = u.searchParams.get("pivot") === "PLACEMENT_NAME";
    return Response.json({ elements: [1, 2].map(day => ({ dateRange: { start: { year: 2026, month: 1, day }, end: { year: 2026, month: 1, day } },
      pivotValues: [placement ? "LINKEDIN" : "urn:li:sponsoredCampaign:20"], costInLocalCurrency: "2.50", impressions: 500, clicks: 6, landingPageClicks: 3, externalWebsiteConversions: 0 })) });
  } });
  const data = options({ provider: "linkedin", client });
  const result = buildMeasurementEvidence(await collectProviderMeasurement({ ...data, includePlacements: true }));
  assert.equal(result.metrics.weightedCpm.value, 5); assert.equal(result.metrics.providerConversions.value, 0);
  assert.equal(result.metrics.outboundClicks.value, 6); assert.equal(result.placements?.complete, true);
  data.verifiedScope.accountId = "wrong";
  await assert.rejects(collectProviderMeasurement(data), /measurement_scope_unverified/);
});
test("empty and missing metric responses remain unknown, synthetic facts cannot claim full confidence", async () => {
  const client = new MetaMeasurementClient({ accessToken: "fixture", fetchImpl: async () => Response.json({ data: [] }) });
  const empty = buildMeasurementEvidence(await collectProviderMeasurement(options({ provider: "meta", client })));
  assert.equal(empty.metrics.spendMinor.value, null); assert.equal(empty.coverage.complete, false);
  client.fetchImpl = async () => Response.json({ data: [metaRow("2026-01-01", { spend: null }), metaRow("2026-01-02")] });
  const missing = buildMeasurementEvidence(await collectProviderMeasurement(options({ provider: "meta", client })));
  assert.equal(missing.metrics.spendMinor.value, null); assert.equal(missing.confidence.state, "incomplete");
});

test("LinkedIn failed date partitions and expired credentials preserve unknown spend without exposing diagnostics", async () => {
  let reads = 0;
  const client = new LinkedInMeasurementClient({ accessToken: "private-token", clientId: "client", clientSecret: "private-secret", fetchImpl: async url => {
    reads++; const range = new URL(String(url)).searchParams.get("dateRange")!;
    if (range.includes("start:(year:2026,month:1,day:31)")) return Response.json({ message: "private-secret" }, { status: 503 });
    return Response.json({ elements: [] });
  } });
  const data = options({ provider: "linkedin", client }); data.window.until = "2026-02-02T00:00:00.000Z";
  data.now = () => "2026-02-05T00:00:00.000Z";
  const failed = buildMeasurementEvidence(await collectProviderMeasurement(data));
  assert.equal(reads, 4); assert.equal(failed.source.paginationComplete, false); assert.equal(failed.metrics.spendMinor.value, null);
  assert.ok(!JSON.stringify(failed).includes("private-secret"));
  reads = 0; client.fetchImpl = async () => { reads++; return Response.json({ message: "private-token" }, { status: 401 }); };
  const expired = buildMeasurementEvidence(await collectProviderMeasurement(data));
  assert.equal(reads, 1); assert.equal(expired.source.missingReason, "permission_error"); assert.equal(expired.metrics.impressions.value, null);
});

// Current UTC day may be observed, but cannot be represented as a complete total.
test("LinkedIn current-day observations remain provisional and future dates are rejected", async () => {
  const today = new Date().toISOString().slice(0, 10), start = Date.parse(today);
  const day = {year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)), day: Number(today.slice(8, 10))};
  const client = new LinkedInMeasurementClient({accessToken: "fixture", clientId: "client", clientSecret: "secret", fetchImpl: async () =>
    Response.json({elements: [{dateRange: {start: day}, pivotValues: ["urn:li:sponsoredCampaign:20"], costInLocalCurrency: "1", impressions: 10, clicks: 1}]})});
  const input = options({provider: "linkedin", client});
  input.window = {...input.window, from: new Date(start).toISOString(), until: new Date(start + 86400000).toISOString()};
  input.now = () => new Date().toISOString();
  const evidence = buildMeasurementEvidence(await collectProviderMeasurement(input));
  assert.equal(evidence.observedDelivery, true);
  assert.equal(evidence.metrics.impressions.value, null);
  assert.ok(evidence.coverage.reasons.includes("window_open_at_collection"));
  const tomorrow = new Date(start + 86400000).toISOString().slice(0, 10);
  await assert.rejects(client.getAnalytics("10", {since: tomorrow, until: tomorrow}), {code: "provider_reporting_range_invalid"});
});
