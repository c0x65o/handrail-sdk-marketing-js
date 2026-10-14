import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { testStore } from "./datastore.js";
import { HistoricalCampaignImports, HistoricalProjectImports, type HistoricalProjectSource, type HistoricalCampaignSource } from "../server/adoption.js";
import { digest } from "../server/store.js";
import type { HistoricalCampaignSnapshot, HistoricalProjectSnapshot, HistoricalRecord } from "../core/adoption.js";

function snapshot(): HistoricalCampaignSnapshot {
  const window = { from: "2026-10-07T00:00:00Z", until: "2026-10-08T00:00:00Z", timezone: "UTC", currency: "USD", minorUnitsPerMajor: 100 };
  const row = (kind: HistoricalRecord["kind"], sourceId: string, payload: HistoricalRecord["payload"]): HistoricalRecord => ({
    kind, sourceId, sourceRevision: "1", recordedAt: null, collectedAt: "2026-10-09T00:00:00Z",
    provenance: "legacy_observation", evidenceId: null, missingReasons: ["historical_creation_time_unknown"], payload });
  return { schemaVersion: 1, projectId: "p", nativeCampaignId: "native", provider: "meta", accountId: "account",
    providerCampaignIds: ["original-provider-id"], identityMissingReasons: [], purpose: "acquisition", purposeReason: null,
    source: { system: "fixture-native", revision: "r1", capturedAt: "2026-10-10T00:00:00Z", receiptRefs: ["consistent-source-snapshot"] },
    records: [row("campaign", "native", { providerId: "original-provider-id", status: "paused" }),
      row("authority", "approval-1", { receipt: "original-expired-approval", approvedBudgetMinor: 1500 }),
      row("operation", "op-1", { outcome: "unknown", requestKey: "original-request" }),
      row("event", "conversion-1", { sourceEventId: "original-event", attributionId: "original-attribution" }),
      { ...row("report", "day-1", { impressions: 50, spend_minor: 125, outbound_clicks: null }),
        measurement: { partition: "provider-day-r1", window, values: { spendMinor: { value: 125, reason: null },
          impressions: { value: 50, reason: null }, outboundClicks: { value: null, reason: "legacy_did_not_collect" } } } }],
    expectedCounts: { campaign: 1, authority: 1, operation: 1, event: 1, report: 1 },
    totals: [
      { partition: "provider-day-r1", window, metric: "spendMinor", value: { value: 125, reason: null }, sourceRecordIds: ["day-1"] },
      { partition: "provider-day-r1", window, metric: "impressions", value: { value: 50, reason: null }, sourceRecordIds: ["day-1"] },
      { partition: "provider-day-r1", window, metric: "outboundClicks", value: { value: null, reason: "legacy_did_not_collect" }, sourceRecordIds: ["day-1"] },
    ], unsettledOperationIds: ["op-1"] };
}
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "marketing-adoption-")), path = join(dir, "db");
  const store = await testStore(path);
  await store.db.prepare("INSERT INTO projects VALUES(?,?)").run("p", "Adoption fixture");
  const uid = await store.createUser("importer", "fixture");
  await store.db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(uid, "p", "admin");
  const principal = await store.authenticate((await store.login("importer", "fixture", "fixture"))!);
  let current = snapshot(), checks = 0, failAt = 0;
  const source: HistoricalCampaignSource = {
    authorize: async (_p, project, campaign) => { assert.equal(project, "p"); assert.equal(campaign, "native"); },
    capture: async () => structuredClone(current),
    assertCurrent: async (_p, expected) => { checks++; assert.equal(digest(expected), digest(current)); if (checks === failAt) throw Error("source-access-revoked"); },
    withCurrentSnapshot: async (_p, _s, commit) => commit(),
  };
  return { store, path, principal, source, service: new HistoricalCampaignImports(store, source),
    get: () => current, set: (s: HistoricalCampaignSnapshot) => { current = s; }, fail: (n: number) => { checks = 0; failAt = n; },
    close: async () => { await store.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test("historical import retains identities, unknowns and unsettled receipts without campaign, grant or conversion execution", async () => {
  const f = await fixture(); try {
    const original = structuredClone(f.get()), receipt = await f.service.stage(f.principal, "p", "native", "first");
    assert.equal(receipt.executionTransferred, false); assert.deepEqual(receipt.unsettledOperationIds, ["op-1"]);
    assert.deepEqual((await f.service.read(f.principal, "p", receipt.id)).snapshot, original);
    for (const kind of ["campaign", "grant", "operation", "event", "advertisingBudgetReservation"])
      assert.equal((await f.store.list("p", kind)).length, 0, `${kind} must not be activated by historical import`);
    assert.equal(receipt.totals.find(x => x.metric === "outboundClicks")!.value.value, null);
    assert.equal((await f.store.list("p", "historicalRecord")).length, 5);
  } finally { await f.close(); }
});
test("concurrent replay, repeated capture and reopening preserve the first import and emit one compact event", async () => {
  const f = await fixture(); try {
    const [a,b] = await Promise.all([f.service.stage(f.principal,"p","native","same"),f.service.stage(f.principal,"p","native","same")]);
    assert.deepEqual(a,b);
    f.get().source.capturedAt = "2026-10-11T00:00:00Z";
    f.get().records.reverse(); f.get().totals.reverse();
    assert.deepEqual(await f.service.stage(f.principal,"p","native","same"),a);
    const reopened = await testStore(f.path); try {
      const service = new HistoricalCampaignImports(reopened,f.source);
      assert.deepEqual(await service.stage(f.principal,"p","native","another-key"),a);
      assert.equal((await service.read(f.principal,"p",a.id)).snapshot.source.capturedAt,"2026-10-10T00:00:00Z");
    } finally { await reopened.close(); }
    assert.equal((await f.store.db.prepare("SELECT * FROM outbox WHERE type=?").all("campaign.history_imported")).length,1);
  } finally { await f.close(); }
});
test("corrections append immutable imports; old request keys cannot acquire changed source records", async () => {
  const f = await fixture(); try {
    const first = await f.service.stage(f.principal,"p","native","original");
    const next = structuredClone(f.get()); next.source.revision = "r2";
    next.records[4]!.sourceRevision = "2"; next.records[4]!.payload.spend_minor = 130;
    next.records[4]!.measurement!.values.spendMinor!.value = 130; next.totals[0]!.value.value = 130; f.set(next);
    await assert.rejects(f.service.stage(f.principal,"p","native","original"),/historical_request_conflict/);
    const second = await f.service.stage(f.principal,"p","native","correction");
    assert.equal(second.previousImportId,first.id); assert.notEqual(first.id,second.id);
    assert.equal((await f.service.read(f.principal,"p",first.id)).snapshot.totals[0]!.value.value,125);
    assert.equal((await f.store.list("p","historicalRecord")).length,6);
  } finally { await f.close(); }
});
for(const change of ["count","duplicate","double-total","currency","window","sum","unknown","missing-total","missing-operation","fake-evidence","scope","purpose-reason","measurement-reason"] as const)
test(`historical import rejects ${change} discrepancies before acceptance`,async()=>{
  const f=await fixture();try{
    const s=f.get();
    if(change==="count")s.expectedCounts.report=2;
    if(change==="duplicate")s.records.push(structuredClone(s.records[0]!));
    if(change==="double-total")s.totals.push(structuredClone(s.totals[0]!));
    if(change==="currency")s.totals[0]!.window={...s.totals[0]!.window,currency:"EUR"};
    if(change==="window")s.totals[0]!.window={...s.totals[0]!.window,until:"2026-10-09T00:00:00Z"};
    if(change==="sum")s.totals[0]!.value.value=126;
    if(change==="unknown")s.totals[2]!.value={value:0,reason:null};
    if(change==="missing-total")s.totals.pop();
    if(change==="missing-operation")s.unsettledOperationIds.push("lost-receipt");
    if(change==="fake-evidence"){s.records[4]!.provenance="verified_evidence";s.records[4]!.evidenceId="invented";}
    if(change==="scope")s.projectId="other";
    if(change==="purpose-reason")s.purpose="unknown";
    if(change==="measurement-reason"){delete s.records[4]!.measurement;s.totals=[];}
    await assert.rejects(f.service.stage(f.principal,"p","native","bad"));
    assert.equal((await f.store.list("p","historicalImport")).length,0);
    assert.equal((await f.store.list("p","historicalRecord")).length,0);
  }finally{await f.close();}
});
test("source access loss before final commit rolls back history and outbox",async()=>{
  const f=await fixture();try{
    f.fail(2); await assert.rejects(f.service.stage(f.principal,"p","native","revoke"),/source-access-revoked/);
    assert.equal((await f.store.list("p","historicalImport")).length,0);
    assert.equal((await f.store.list("p","historicalRecord")).length,0);
    assert.equal((await f.store.db.prepare("SELECT * FROM outbox WHERE type=?").all("campaign.history_imported")).length,0);
  }finally{await f.close();}
});
test("compatible disjoint reports reconcile totals and preserve separate currencies",async()=>{
  const f=await fixture();try{
    const s=f.get(), second=structuredClone(s.records[4]!);second.sourceId="day-2";
    second.measurement!.values.spendMinor!.value=75;second.payload.spend_minor=75;
    s.records.push(second);s.expectedCounts.report=2;
    for(const t of s.totals){t.sourceRecordIds.push("day-2");if(t.metric==="spendMinor")t.value.value=200;if(t.metric==="impressions")t.value.value=100;}
    const euro=structuredClone(second);euro.sourceId="euro-day";euro.measurement!.partition="provider-eur-r1";euro.measurement!.window.currency="EUR";
    s.records.push(euro);s.expectedCounts.report=3;
    for(const [metric,value] of Object.entries(euro.measurement!.values))s.totals.push({partition:euro.measurement!.partition,window:euro.measurement!.window,
      metric:metric as typeof s.totals[number]["metric"],value:value!,sourceRecordIds:[euro.sourceId]});
    const receipt=await f.service.stage(f.principal,"p","native","currencies");
    assert.deepEqual(receipt.totals.filter(t=>t.metric==="spendMinor").map(t=>[t.window.currency,t.value.value]),[["USD",200],["EUR",75]]);
    assert.equal(receipt.totals.find(t=>t.metric==="outboundClicks")!.value.value,null);
  }finally{await f.close();}
});
test("revoked host access prevents historical reads despite a retained SDK membership",async()=>{
  const f=await fixture();try{
    const receipt=await f.service.stage(f.principal,"p","native","first");
    f.source.authorize=async()=>{throw Error("host-access-revoked");};
    await assert.rejects(f.service.read(f.principal,"p",receipt.id),/host-access-revoked/);
  }finally{await f.close();}
});
test("unpublished drafts retain unknown provider identity and purpose with explicit reasons",async()=>{
  const f=await fixture();try{
    const s=f.get();s.provider="unknown";s.accountId=null;s.providerCampaignIds=[];
    s.identityMissingReasons=["provider_not_selected"];s.purpose="unknown";s.purposeReason="legacy_draft_purpose_not_recorded";
    const receipt=await f.service.stage(f.principal,"p","native","unknown-draft");
    const retained=(await f.service.read(f.principal,"p",receipt.id)).snapshot;
    assert.equal(retained.provider,"unknown");assert.equal(retained.accountId,null);assert.equal(retained.purpose,"unknown");
    assert.equal(receipt.executionTransferred,false);
  }finally{await f.close();}
});

async function projectFixture() {
  const base = await fixture(), campaign = snapshot();
  let current: HistoricalProjectSnapshot = { schemaVersion: 1, scope: "project", projectId: "p",
    scopeReason: "Project operational history and records without campaign attribution",
    source: campaign.source, records: campaign.records.filter(r => r.kind !== "campaign"),
    expectedCounts: { authority: 1, operation: 1, event: 1, report: 1 }, totals: campaign.totals,
    unsettledOperationIds: campaign.unsettledOperationIds };
  current.records.find(r => r.kind === "event")!.payload.campaignId = null;
  let allowed = true, checks = 0, failAt = 0;
  const source: HistoricalProjectSource = {
    authorize: async (_p, project) => { assert.equal(project, "p"); if (!allowed) throw Error("project-source-access-revoked"); },
    capture: async () => structuredClone(current),
    assertCurrent: async (_p, expected) => {
      checks++; assert.equal(digest(expected), digest(current));
      if (!allowed || checks === failAt) throw Error("project-source-access-revoked");
    },
    withCurrentSnapshot: async (_p, _s, commit) => commit(),
  };
  return { ...base, campaignService: base.service, service: new HistoricalProjectImports(base.store, source), source,
    get: () => current, set: (s: HistoricalProjectSnapshot) => { current = s; },
    revoke: () => { allowed = false; }, fail: (n: number) => { checks = 0; failAt = n; } };
}
test("project retention preserves unattributed identities without a fabricated campaign or new execution authority", async () => {
  const f = await projectFixture(); try {
    const original = structuredClone(f.get()), receipt = await f.service.stage(f.principal, "p", "project-first");
    assert.equal(receipt.scope, "project"); assert.equal("nativeCampaignId" in receipt, false);
    assert.equal(receipt.executionTransferred, false); assert.deepEqual(receipt.unsettledOperationIds, ["op-1"]);
    assert.deepEqual((await f.service.read(f.principal, "p", receipt.id)).snapshot, original);
    assert.equal(original.records.find(r => r.kind === "event")!.payload.campaignId, null);
    assert.equal(receipt.totals.find(t => t.metric === "outboundClicks")!.value.value, null);
    for (const kind of ["campaign", "grant", "operation", "event", "advertisingBudgetReservation"])
      assert.equal((await f.store.list("p", kind)).length, 0);
    assert.equal((await f.store.db.prepare("SELECT * FROM outbox WHERE type=?").all("project.history_imported")).length, 1);
  } finally { await f.close(); }
});
test("project requests replay concurrently, survive reopen and remain independent of campaign requests", async () => {
  const f = await projectFixture(); try {
    const campaign = await f.campaignService.stage(f.principal, "p", "native", "shared-key");
    const [a,b] = await Promise.all([f.service.stage(f.principal, "p", "shared-key"), f.service.stage(f.principal, "p", "shared-key")]);
    assert.deepEqual(a,b); assert.notEqual(a.id, campaign.id);
    f.get().source.capturedAt = "2026-10-12T00:00:00Z"; f.get().records.reverse(); f.get().totals.reverse();
    const reopened = await testStore(f.path); try {
      const service = new HistoricalProjectImports(reopened, f.source);
      assert.deepEqual(await service.stage(f.principal, "p", "new-key"), a);
      assert.equal((await service.read(f.principal, "p", a.id)).snapshot.source.capturedAt, "2026-10-10T00:00:00Z");
    } finally { await reopened.close(); }
    await assert.rejects(f.service.read(f.principal, "p", campaign.id), /historical_scope_mismatch/);
    await assert.rejects(f.campaignService.read(f.principal, "p", a.id), /historical_scope_mismatch/);
    assert.equal((await f.store.db.prepare("SELECT * FROM outbox WHERE type=?").all("project.history_imported")).length, 1);
  } finally { await f.close(); }
});
test("project corrections preserve prior attribution gaps and require new request identities", async () => {
  const f = await projectFixture(); try {
    const first = await f.service.stage(f.principal, "p", "first"), next = structuredClone(f.get());
    next.source.revision = "r2"; next.records[2]!.sourceRevision = "2";
    next.records[2]!.payload.campaignId = "subsequently-verified-native-id"; f.set(next);
    await assert.rejects(f.service.stage(f.principal, "p", "first"), /historical_request_conflict/);
    const second = await f.service.stage(f.principal, "p", "correction");
    assert.equal(second.previousImportId, first.id);
    assert.equal((await f.service.read(f.principal, "p", first.id)).snapshot.records[2]!.payload.campaignId, null);
    assert.equal((await f.service.read(f.principal, "p", second.id)).snapshot.records[2]!.payload.campaignId, "subsequently-verified-native-id");
  } finally { await f.close(); }
});
for (const change of ["synthetic-campaign", "campaign-field", "wrong-project", "missing-scope", "missing-reason", "count", "missing-operation", "unknown-zero", "sum", "currency", "missing-total", "fake-evidence"] as const)
test(`project retention rejects ${change} before accepting history`, async () => {
  const f = await projectFixture(); try {
    const s = f.get();
    if (change === "synthetic-campaign") { s.records.push(snapshot().records[0]!); s.expectedCounts.campaign = 1; }
    if (change === "campaign-field") Object.assign(s, { nativeCampaignId: "invented" });
    if (change === "wrong-project") s.projectId = "other";
    if (change === "missing-scope") Reflect.deleteProperty(s, "scope");
    if (change === "missing-reason") s.scopeReason = "";
    if (change === "count") s.expectedCounts.event = 2;
    if (change === "missing-operation") s.unsettledOperationIds.push("lost-op");
    if (change === "unknown-zero") s.totals[2]!.value = { value: 0, reason: null };
    if (change === "sum") s.totals[0]!.value.value = 126;
    if (change === "currency") s.totals[0]!.window = { ...s.totals[0]!.window, currency: "EUR" };
    if (change === "missing-total") s.totals.pop();
    if (change === "fake-evidence") { s.records[3]!.provenance = "verified_evidence"; s.records[3]!.evidenceId = "invented"; }
    await assert.rejects(f.service.stage(f.principal, "p", "invalid"));
    assert.equal((await f.store.list("p", "historicalImport")).length, 0);
    assert.equal((await f.store.list("p", "historicalRecord")).length, 0);
  } finally { await f.close(); }
});
test("project import rolls back on access loss and retained history requires current source access", async () => {
  const f = await projectFixture(); try {
    f.fail(2); await assert.rejects(f.service.stage(f.principal, "p", "revoked-during-commit"), /project-source-access-revoked/);
    assert.equal((await f.store.list("p", "historicalImport")).length, 0);
    assert.equal((await f.store.list("p", "historicalRecord")).length, 0);
    f.fail(0); const receipt = await f.service.stage(f.principal, "p", "accepted");
    f.revoke(); await assert.rejects(f.service.read(f.principal, "p", receipt.id), /project-source-access-revoked/);
    await assert.rejects(f.service.stage(f.principal, "p", "accepted"), /project-source-access-revoked/);
  } finally { await f.close(); }
});
