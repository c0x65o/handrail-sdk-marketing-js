import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MeasurementInput } from "../core/measurement.js";
import { buildMeasurementEvidence, measured, unknownMeasurement, saveMeasurementEvidence, readMeasurementEvidence, measurementDays, saveMeasurementRevision, readLatestMeasurementEvidence, aggregateMeasurementEvidence, compatibleMeasurementWindows, observedMeasurementSpend, readObservedMeasurementSpend } from "../server/measurement.js";
import { testStore } from "./datastore.js";

function input(): MeasurementInput {
  return {
    identity: { projectId: "p", nativeCampaignId: "native", sdkCampaignId: null, provider: "meta", accountId: "a", campaignIds: ["c"], materialVersion: null, purpose: "acquisition" },
    window: { from: "2026-10-07T00:00:00.000Z", until: "2026-10-09T00:00:00.000Z", timezone: "UTC", currency: "USD", minorUnitsPerMajor: 100 },
    source: { kind: "synthetic", collector: "measurement-test", apiVersion: "test", collectedAt: "2026-10-10T00:00:00.000Z", receiptIds: ["fixture-1"], snapshotDigests: ["a".repeat(64)], paginationComplete: true, missingReason: null, dataThrough: null },
    rows: ["2026-10-07", "2026-10-08"].map((day, i) => ({ campaignId: "c", day, placement: null, spendMinor: measured(i ? 900 : 100), impressions: measured(i ? 100 : 900), clicks: measured(20), outboundClicks: measured(10), landingViews: unknownMeasurement("not_requested"), providerConversions: unknownMeasurement("conversion_mapping_unqualified"), conversionDefinition: null, providerCpm: measured(i ? 90 : 100 / 900 * 10), providerOutboundCtrPercent: unknownMeasurement("not_returned") })),
    delivery: { configuredStatus: "ACTIVE", effectiveStatus: "ACTIVE", evidenceRefs: ["fixture-1"] },
    outcomes: null,
    maturity: { state: "unknown", reason: "attribution_coverage_unverified", evidenceRefs: [], reportingLagEndsAt: null, attributionEndsAt: null, rereadAt: null, coverageVerified: false },
  };
}
test("weighted CPM uses total spend and impressions; outbound clicks stay distinct; input is not mutated", () => {
  const data = input(), before = structuredClone(data), evidence = buildMeasurementEvidence(data);
  assert.equal(evidence.metrics.weightedCpm.value, 10);
  assert.equal(evidence.metrics.outboundCtrPercent.value, 2);
  assert.equal(evidence.metrics.clicks.value, 40);
  assert.equal(evidence.metrics.providerConversions.value, null);
  assert.equal(evidence.metrics.providerConversions.reason, "conversion_mapping_unqualified");
  assert.equal(evidence.maturity.state, "unknown");
  assert.equal(evidence.reconciliation.comparisons.length, 2);
  const discrepant = input(); discrepant.rows[0]!.providerCpm = measured(999);
  assert.equal(buildMeasurementEvidence(discrepant).reconciliation.status, "discrepant");
  assert.equal(evidence.verification.browser, "not_compared");
  assert.deepEqual(data, before);
});
test("missing campaign days, partial pagination and open windows never become zero or complete", () => {
  for (const change of [(d: MeasurementInput) => { d.rows.pop(); }, (d: MeasurementInput) => { d.source.paginationComplete = false; }, (d: MeasurementInput) => { d.source.collectedAt = "2026-10-08T12:00:00.000Z"; }]) {
    const data = input(); change(data);
    const result = buildMeasurementEvidence(data);
    assert.equal(result.coverage.complete, false);
    assert.equal(result.metrics.spendMinor.value, null);
    assert.equal(result.metrics.weightedCpm.value, null);
    assert.equal(result.observedDelivery, true);
  }
});
test("observed zeros stay zero but zero denominator ratios stay unknown", () => {
  const data = input();
  for (const row of data.rows) { row.spendMinor = measured(0); row.impressions = measured(0); row.outboundClicks = measured(0); }
  const result = buildMeasurementEvidence(data);
  assert.equal(result.metrics.spendMinor.value, 0);
  assert.deepEqual(result.metrics.weightedCpm, unknownMeasurement("zero_denominator"));
  assert.equal(result.observedDelivery, false);
});
test("rejects overlap, foreign identities, invalid counts and placement/total mixing", () => {
  for (const change of [(d: MeasurementInput) => { d.rows.push(d.rows[0]!); }, (d: MeasurementInput) => { d.rows[0]!.campaignId = "other"; }, (d: MeasurementInput) => { d.rows[0]!.impressions = measured(1.5); }, (d: MeasurementInput) => { d.rows[0]!.placement = "feed"; }]) {
    const data = input(); change(data); assert.throws(() => buildMeasurementEvidence(data));
  }
});
test("maturity requires independent attribution and lag evidence, not just a closed reporting day", () => {
  const data = input(); data.maturity.state = "mature";
  assert.throws(() => buildMeasurementEvidence(data), /maturity_evidence_required/);
  Object.assign(data.maturity, { evidenceRefs: ["lag-policy", "coverage", "reread"], coverageVerified: true,
    reportingLagEndsAt: "2026-10-09T03:00:00Z", attributionEndsAt: "2026-10-09T12:00:00Z", rereadAt: "2026-10-09T13:00:00Z" });
  assert.equal(buildMeasurementEvidence(data).maturity.state, "mature");
});
test("qualified costs require same window/currency and explicit outcome coverage", () => {
  const data = input();
  data.outcomes = { source: "host", window: structuredClone(data.window), collectedAt: data.source.collectedAt,
    evidenceRefs: ["forms"], qaExcluded: true, attributionComplete: false, completedSubmissions: measured(4), qualified: measured(2), customers: measured(0), revenueMinor: measured(0) };
  assert.equal(buildMeasurementEvidence(data).metrics.costPerQualifiedMinor.value, null);
  data.outcomes.attributionComplete = true;
  assert.equal(buildMeasurementEvidence(data).metrics.costPerQualifiedMinor.value, 500);
  data.outcomes.window.currency = "EUR";
  assert.throws(() => buildMeasurementEvidence(data), /outcome_window_mismatch/);
});
test("calendar coverage respects DST rather than 24-hour durations", () => {
  assert.deepEqual(measurementDays({ ...input().window, from: "2026-11-01T05:00:00.000Z", until: "2026-11-02T06:00:00.000Z", timezone: "America/Chicago" }), ["2026-11-01"]);
});
test("durable revisions preserve original facts, replay once, and reject cross-project or incompatible predecessors", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marketing-measurement-")), path = join(dir, "store");
  let store = await testStore(path);
  try {
    await store.db.prepare("INSERT INTO projects VALUES(?,?)").run("p", "Measurement");
    const data = input(), original = await saveMeasurementEvidence(store, data);
    assert.equal((await saveMeasurementEvidence(store, data)).id, original.id);
    assert.equal((await store.db.prepare("SELECT * FROM outbox WHERE type=?").all("measurement.collected")).length, 1);
    data.source.collectedAt = "2026-10-11T00:00:00.000Z"; data.rows[0]!.spendMinor = measured(150);
    const correction = await saveMeasurementEvidence(store, data, original.id);
    assert.equal(correction.previousEvidenceId, original.id);
    assert.equal(correction.metrics.spendMinor.value, 1050);
    assert.equal((await readMeasurementEvidence(store, "p", original.id)).metrics.spendMinor.value, 1000);
    await assert.rejects(readMeasurementEvidence(store, "other", original.id), /not_found/);
    data.identity.nativeCampaignId = "different";
    await assert.rejects(saveMeasurementEvidence(store, data, original.id), /measurement_revision_scope_mismatch/);
    await store.close(); store = await testStore(path);
    assert.equal((await readMeasurementEvidence(store, "p", correction.id)).digest, correction.digest);
  } finally { await store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("concurrent collection replay commits one revision and backfills retain the incomplete predecessor", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marketing-revision-")), store = await testStore(join(dir, "store"));
  try {
    await store.db.prepare("INSERT INTO projects VALUES(?,?)").run("p", "Revisions");
    const partial = input(); partial.rows.pop();
    const [first, replay] = await Promise.all([saveMeasurementRevision(store, partial), saveMeasurementRevision(store, partial)]);
    assert.equal(first.id, replay.id); assert.equal(first.coverage.complete, false);
    const complete = input(); complete.source.collectedAt = "2026-10-11T00:00:00.000Z";
    const backfill = await saveMeasurementRevision(store, complete);
    assert.equal(backfill.previousEvidenceId, first.id); assert.equal(backfill.coverage.complete, true);
    assert.equal((await saveMeasurementRevision(store, partial)).id, first.id);
    assert.equal((await readLatestMeasurementEvidence(store, complete))?.id, backfill.id);
    assert.equal((await store.db.prepare("SELECT * FROM outbox WHERE type=?").all("measurement.collected")).length, 2);
    const earlier = input(); earlier.source.collectedAt = "2026-10-09T00:00:00.000Z";
    await assert.rejects(saveMeasurementRevision(store, earlier), /measurement_revision_time_reversed/);
    assert.equal((await readLatestMeasurementEvidence(store, complete))?.id, backfill.id);
  } finally { await store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("portfolio aggregation never combines revisions, windows or currency and uses weighted metrics", () => {
  const a = input(), b = input();
  b.identity.nativeCampaignId = "second"; b.identity.campaignIds = ["second"];
  for (const row of b.rows) { row.campaignId = "second"; row.impressions = measured(4500); }
  const first = buildMeasurementEvidence(a), second = buildMeasurementEvidence(b);
  const aggregate = aggregateMeasurementEvidence([first, second]);
  assert.equal(aggregate.metrics.weightedCpm.value, 2);
  assert.equal(aggregate.metrics.impressions.value, 10000);
  assert.equal(aggregate.complete, false, "synthetic inputs are explicitly identified");
  assert.equal(aggregateMeasurementEvidence([first, first]).metrics.spendMinor.value, null);
  b.window.currency = "EUR";
  assert.equal(aggregateMeasurementEvidence([first, buildMeasurementEvidence(b)]).metrics.weightedCpm.value, null);
  b.window.currency = "USD"; b.window.from = "2026-10-06T00:00:00.000Z";
  assert.equal(aggregateMeasurementEvidence([first, buildMeasurementEvidence(b)]).metrics.spendMinor.value, null);
});

test("equivalent UTC instant formats are compatible; date-only windows are not instants", () => {
  const original = input().window;
  assert.equal(compatibleMeasurementWindows(original, { ...original, from: original.from.replace(".000Z", "Z") }), true);
  assert.throws(() => measurementDays({ ...original, from: "2026-10-07" }), /invalid_instant/);
});

test("current-day observed spend is distinct from final totals and does not confer spending authority", () => {
  const data=input(); data.source.kind="provider_api"; data.source.collectedAt="2026-10-08T12:00:00.000Z";
  const evidence=buildMeasurementEvidence(data), before=structuredClone(evidence);
  const observed=observedMeasurementSpend([evidence],{asOf:"2026-10-08T12:05:00.000Z",maxAgeMs:15*60000});
  assert.equal(evidence.metrics.spendMinor.value,null);
  assert.equal(observed.spendMinor.value,1000);
  assert.equal(observed.observationComplete,true); assert.equal(observed.fullWindowComplete,false);
  assert.equal(observed.reportingLagUnbounded,true);
  assert.deepEqual(observed.evidenceIds,[evidence.id]); assert.deepEqual(evidence,before);
  assert.equal(observed.oldestCollectedAt,data.source.collectedAt);
  for(const row of data.rows)row.spendMinor=measured(0);
  assert.equal(observedMeasurementSpend([buildMeasurementEvidence(data)],{asOf:data.source.collectedAt,maxAgeMs:0}).spendMinor.value,0);
  data.source.collectedAt="2026-10-09T01:00:00.000Z";
  assert.equal(observedMeasurementSpend([buildMeasurementEvidence(data)],{asOf:data.source.collectedAt,maxAgeMs:0}).fullWindowComplete,true);
});

test("observed-spend controls reject missing, stale, synthetic, failed, overlapping and incompatible evidence", () => {
  const fresh=()=>{const data=input(); data.source.kind="provider_api"; data.source.collectedAt="2026-10-08T12:00:00.000Z"; return data;};
  const options={asOf:"2026-10-08T12:05:00.000Z",maxAgeMs:15*60000};
  for(const change of [
    (d:MeasurementInput)=>{d.rows.pop();}, (d:MeasurementInput)=>{d.rows[0]!.spendMinor=unknownMeasurement("missing_spend");},
    (d:MeasurementInput)=>{d.source.paginationComplete=false;}, (d:MeasurementInput)=>{d.source.missingReason="expired_credentials";},
    (d:MeasurementInput)=>{d.source.collectedAt="2026-10-08T11:00:00.000Z";},
    (d:MeasurementInput)=>{d.source.collectedAt="2026-10-08T13:00:00.000Z";}, (d:MeasurementInput)=>{d.source.kind="synthetic";},
    (d:MeasurementInput)=>{d.window.until="2026-10-10T00:00:00.000Z";d.rows.push({...d.rows[0]!,day:"2026-10-09"});},
  ]) { const data=fresh(); change(data); const observed=observedMeasurementSpend([buildMeasurementEvidence(data)],options);
    assert.equal(observed.spendMinor.value,null);assert.equal(observed.observationComplete,false);assert.ok(observed.reasons.length); }
  const first=buildMeasurementEvidence(fresh());
  assert.equal(observedMeasurementSpend([],options).spendMinor.value,null);
  assert.equal(observedMeasurementSpend([first,first],options).spendMinor.value,null);
  for(const currency of ["USD","EUR"]) {
    const second=fresh(); second.identity.nativeCampaignId="other";second.identity.campaignIds=["other"];second.rows.forEach(row=>row.campaignId="other");second.window.currency=currency;
    assert.equal(observedMeasurementSpend([first,buildMeasurementEvidence(second)],options).spendMinor.value,currency==="USD"?2000:null);
    second.window.from="2026-10-08T00:00:00.000Z";second.rows.shift();
    assert.equal(observedMeasurementSpend([first,buildMeasurementEvidence(second)],options).spendMinor.value,null);
  }
  const corrupt=structuredClone(first);corrupt.rows[0]!.spendMinor.value=corrupt.rows[0]!.spendMinor.value!+1;
  assert.throws(()=>observedMeasurementSpend([corrupt],options),/measurement_integrity_mismatch/);
  assert.throws(()=>observedMeasurementSpend([first],{...options,maxAgeMs:-1}),/invalid_measurement_freshness/);
});

test("read-only observed-window selection preserves stored parent references and never falls back past a correction",async()=>{
  const data=input();data.source.kind="provider_api";data.source.collectedAt="2026-10-08T12:00:00.000Z";
  const parent=buildMeasurementEvidence(data), records=[parent];
  const store={list:async<T>(project:string,kind:string)=>{
    assert.equal(project,"p");assert.equal(kind,"measurementEvidence");return records as T[];
  }};
  const scope={projectId:"p",nativeCampaignId:"native",provider:"meta" as const,accountId:"a",campaignIds:["c"],
    window:{...data.window,from:"2026-10-08T00:00:00.000Z"}};
  const options={asOf:"2026-10-08T12:05:00.000Z",maxAgeMs:15*60000};
  const observed=await readObservedMeasurementSpend(store,[scope],options);
  assert.equal(observed.spendMinor.value,900);assert.equal(observed.fullWindowComplete,false);
  assert.deepEqual(observed.evidenceIds,[parent.id]);assert.equal(records.length,1);
  assert.equal((await readObservedMeasurementSpend(store,[{...scope,campaignIds:["replacement"]}],options)).spendMinor.value,null);
  assert.equal((await readObservedMeasurementSpend(store,[scope,{...scope,nativeCampaignId:"missing"}],options)).spendMinor.value,null);
  data.source.collectedAt="2026-10-08T12:01:00.000Z";data.source.paginationComplete=false;
  const partial=buildMeasurementEvidence(data,parent.id);records.push(partial);
  const corrected=await readObservedMeasurementSpend(store,[scope],options);
  assert.equal(corrected.spendMinor.value,null);assert.deepEqual(corrected.evidenceIds,[partial.id]);
  assert.ok(corrected.reasons.includes("pagination_incomplete"));
});

test("saved-window views retain provenance, reject newer partial scope and never count a projection as a provider reread", async () => {
  const {materializeMeasurementWindow, readCampaignMeasurementRevisions} = await import('../server/measurement.js');
  const dir = mkdtempSync(join(tmpdir(), "marketing-window-")), store = await testStore(join(dir, "store"));
  try {
    await store.db.prepare("INSERT INTO projects(id,name) VALUES(?,?)").run("p", "Measurement");
    const original = await saveMeasurementRevision(store, input());
    const scope = {projectId: "p", nativeCampaignId: "native", provider: "meta" as const, accountId: "a"};
    const window = {...original.window, until: "2026-10-08T00:00:00.000Z"};
    const first = await materializeMeasurementWindow(store, scope, window, "2026-10-11T00:00:00.000Z");
    assert.equal(first.status, "available");
    assert.equal(first.evidence!.metrics.spendMinor.value, 100);
    assert.deepEqual(first.sourceEvidenceIds, [original.id]);
    assert.equal(first.evidence!.source.collectedAt, original.source.collectedAt);
    assert.equal(first.evidence!.outcomes, null);
    assert.equal(first.evidence!.maturity.state, "unknown");
    assert.deepEqual(await readMeasurementEvidence(store, "p", first.evidence!.id), first.evidence);
    assert.deepEqual(await materializeMeasurementWindow(store, scope, window, "2026-10-11T00:00:00.000Z"), first);
    const narrower = input(); narrower.window = window; narrower.rows = [narrower.rows[0]!];
    narrower.source.collectedAt = "2026-10-11T00:00:00.000Z";
    const newer = await saveMeasurementRevision(store, narrower);
    const full = await materializeMeasurementWindow(store, scope, original.window, "2026-10-12T00:00:00.000Z");
    assert.equal(full.status, "refresh_required"); assert.equal(full.evidence, null); assert.deepEqual(full.sourceEvidenceIds, [newer.id]);
    const historical = await materializeMeasurementWindow(store, scope, original.window, "2026-10-10T12:00:00.000Z");
    assert.equal(historical.evidence!.id, original.id);
    assert.equal((await readCampaignMeasurementRevisions(store, {...scope, projectId: "other"})).length, 0);
    const failed = input(); failed.source.collectedAt = "2026-10-12T00:00:00.000Z";
    failed.source.missingReason = "permission_error"; failed.source.paginationComplete = false; failed.rows = [];
    const denial = await saveMeasurementRevision(store, failed);
    const unavailable = await materializeMeasurementWindow(store, scope, window, "2026-10-13T00:00:00.000Z");
    assert.equal(unavailable.evidence!.metrics.spendMinor.value, null);
    assert.deepEqual(unavailable.sourceEvidenceIds, [denial.id]);
    assert.equal((await materializeMeasurementWindow(store, scope, {...window, currency: "EUR"}, "2026-10-13T00:00:00.000Z")).reason, "saved_measurement_units_changed");
  } finally {await store.close(); rmSync(dir, {recursive: true, force: true});}
});
