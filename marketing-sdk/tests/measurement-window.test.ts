import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import type { MeasurementInput, MeasurementEvidence } from "../core/measurement.js";
import { Store, digest, measured, unknownMeasurement, readMeasurementWindow, saveMeasurementRevision,
  readMeasurementEvidence, materializeMeasurementWindow, type MeasurementWindowReader } from "../server/index.js";
import { testStore, postgresOptions } from "./datastore.js";

const asOf = "2026-10-15T00:00:00.000Z";
const scope = { projectId: "p", nativeCampaignId: "native", provider: "meta" as const, accountId: "a" };
function input(): MeasurementInput {
  const rows = ["2026-10-07", "2026-10-08"].map(day => ({ campaignId: "c", day, placement: null,
    spendMinor: measured(100), impressions: measured(1000), clicks: measured(0), outboundClicks: measured(0),
    landingViews: unknownMeasurement("not_requested"), providerConversions: unknownMeasurement("not_qualified"),
    conversionDefinition: null, providerCpm: measured(1), providerOutboundCtrPercent: measured(0) }));
  const snapshot = { request: { kind: "campaign_totals" as const, campaignIds: ["c"], since: "2026-10-07", until: "2026-10-08" },
    collectedAt: "2026-10-10T00:00:00.000Z", attempt: 1, rows, error: null };
  const hash = digest(snapshot);
  const window = { from: "2026-10-07T00:00:00.000Z", until: "2026-10-09T00:00:00.000Z", timezone: "UTC", currency: "USD", minorUnitsPerMajor: 100 };
  return {
    identity: { ...scope, sdkCampaignId: "sdk", campaignIds: ["c"], materialVersion: "v1", purpose: "acquisition" }, window,
    source: { kind: "synthetic", collector: "saved-window-fixture", apiVersion: "fixture", collectedAt: snapshot.collectedAt,
      receiptIds: ["saved-receipt"], snapshotDigests: [hash], paginationComplete: true, missingReason: null, dataThrough: window.until },
    rows, snapshots: [{ ...snapshot, digest: hash }],
    placements: { rows: rows.map(row => ({ ...row, placement: "feed" })), complete: true, reason: null, snapshotDigests: [hash] },
    delivery: { configuredStatus: "PAUSED", effectiveStatus: "PAUSED", evidenceRefs: ["saved-status"] },
    outcomes: { source: "fixture", window, collectedAt: snapshot.collectedAt, evidenceRefs: ["outcomes"], qaExcluded: true,
      attributionComplete: true, completedSubmissions: measured(2), qualified: measured(1), customers: measured(0), revenueMinor: measured(0) },
    maturity: { state: "mature", reason: "fixture_qualified", evidenceRefs: ["lag", "attribution"], coverageVerified: true,
      reportingLagEndsAt: window.until, attributionEndsAt: window.until, rereadAt: snapshot.collectedAt },
  };
}
const subset = () => ({ ...input().window, until: "2026-10-08T00:00:00.000Z" });
const facts = ({ id: _id, digest: _digest, previousEvidenceId: _previous, ...body }: MeasurementEvidence) => body;
async function snapshot(store: Store) {
  const result: Record<string, string[]> = {};
  // Every SDK base table, including auth, execution, outbox and guard state.
  for (const table of ["migrations", "transaction_guard", "projects", "users", "memberships", "sessions", "auth_attempts", "records", "requests", "blobs", "outbox", "leases"])
    result[table] = (await store.db.prepare(`SELECT * FROM ${table}`).all()).map(row => JSON.stringify(row)).sort();
  return result;
}
async function fixture(fn: (store: Store) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "measurement-window-"));
  const store = await testStore(join(dir, "store"));
  try {
    await store.db.prepare("INSERT INTO projects VALUES(?,?)").run("p", "Saved window");
    await fn(store);
  } finally { await store.close(); rmSync(dir, { recursive: true, force: true }); }
}

test("saved exact/subset reporting is effect-free, detached and explicit about stored provenance", async t => {
  const provider = t.mock.method(globalThis, "fetch", async () => { throw new Error("provider_forbidden"); });
  await fixture(async store => {
    const parent = await saveMeasurementRevision(store, input()), before = await snapshot(store);
    // No other Store capabilities are supplied to the public API.
    let lists = 0;
    const reader: MeasurementWindowReader = { list: async <T>(project: string, kind: string) => {
      lists++; return store.list<T>(project, kind);
    } };
    for (let i = 0; i < 3; i++) {
      const exact = await readMeasurementWindow(reader, scope, parent.window, asOf);
      assert.equal(exact.projectionKind, "stored"); assert.equal(exact.storedEvidenceId, parent.id);
      assert.deepEqual(exact.projection, facts(parent)); assert.deepEqual(exact.sourceEvidenceIds, [parent.id]);
      const read = await readMeasurementWindow(reader, scope, subset(), asOf);
      assert.equal(read.status, "available"); assert.equal(read.projectionKind, "subset"); assert.equal(read.storedEvidenceId, null);
      assert.deepEqual(read.sourceEvidenceIds, [parent.id]);
      const p = read.projection!;
      assert.equal("id" in p, false); assert.equal("digest" in p, false); assert.equal("previousEvidenceId" in p, false);
      assert.equal(p.source.collectedAt, parent.source.collectedAt);
      assert.deepEqual(p.source.receiptIds, [...parent.source.receiptIds, parent.id]);
      assert.deepEqual(p.snapshots, parent.snapshots); assert.deepEqual(p.identity, parent.identity);
      assert.equal(p.placements!.rows.length, 1); assert.equal(p.placements!.complete, true);
      assert.equal(p.metrics.spendMinor.value, 100); assert.equal(p.metrics.clicks.value, 0);
      assert.deepEqual(p.metrics.landingViews, unknownMeasurement("not_requested"));
      assert.equal(p.coverage.complete, true); assert.equal(p.maturity.state, "unknown");
      assert.deepEqual(p.maturity.evidenceRefs, [parent.id]); assert.equal(p.maturity.coverageVerified, false);
      assert.equal(p.outcomes, null); assert.equal(p.metrics.costPerQualifiedMinor.value, null);
      assert.equal(p.source.dataThrough, null); assert.equal(p.verification.browser, "not_compared");
      p.rows[0]!.spendMinor.value = 999; // Returned objects cannot alter retained facts.
    }
    assert.equal(lists, 6, "one project evidence list per read; no added fanout");
    assert.deepEqual(await snapshot(store), before);
    assert.deepEqual(await readMeasurementEvidence(store, "p", parent.id), parent);
    const projected = await readMeasurementWindow(reader, scope, subset(), asOf);
    const retained = await materializeMeasurementWindow(store, scope, subset(), asOf);
    assert.deepEqual(projected.projection, facts(retained.evidence!));
    assert.deepEqual(await readMeasurementEvidence(store, "p", retained.evidence!.id), retained.evidence);
    assert.equal((await store.list("p", "measurementEvidence")).length, 2);
    assert.equal((await store.db.prepare("SELECT * FROM outbox WHERE type=?").all("measurement.collected")).length, 2);
    assert.deepEqual(await readMeasurementWindow(reader, scope, subset(), asOf), projected, "retention is not a provider reread");
  });
  assert.equal(provider.mock.callCount(), 0);
});

test("latest overlap wins; future, absent, foreign and incompatible windows remain honest", async () => fixture(async store => {
  const parent = await saveMeasurementRevision(store, input());
  for (const changed of [{ projectId: "other" }, { nativeCampaignId: "other" }, { provider: "linkedin" as const }, { accountId: "other" }]) {
    const read = await readMeasurementWindow(store, { ...scope, ...changed }, parent.window, asOf);
    assert.equal(read.status, "missing"); assert.equal(read.projection, null); assert.deepEqual(read.sourceEvidenceIds, []);
  }
  assert.equal((await readMeasurementWindow(store, scope, parent.window, "2026-10-09T00:00:00.000Z")).status, "missing");
  const narrow = input(); narrow.window = subset(); narrow.rows = [narrow.rows[0]!]; narrow.placements!.rows = [narrow.placements!.rows[0]!];
  narrow.outcomes = null; narrow.source.collectedAt = "2026-10-11T00:00:00.000Z";
  const latest = await saveMeasurementRevision(store, narrow);
  const before = await snapshot(store);
  const full = await readMeasurementWindow(store, scope, parent.window, asOf);
  assert.equal(full.status, "refresh_required"); assert.equal(full.reason, "latest_collection_does_not_cover_window");
  assert.deepEqual(full.sourceEvidenceIds, [latest.id]); assert.equal(full.projection, null);
  assert.equal((await readMeasurementWindow(store, scope, parent.window, parent.source.collectedAt)).storedEvidenceId, parent.id);
  for (const units of [{ currency: "EUR" }, { minorUnitsPerMajor: 1000 }, { timezone: "Etc/UTC" }]) {
    const read = await readMeasurementWindow(store, scope, { ...subset(), ...units }, asOf);
    assert.equal(read.reason, "saved_measurement_units_changed"); assert.equal(read.projection, null);
  }
  await assert.rejects(readMeasurementWindow(store, scope, parent.window, "invalid"), /invalid_instant/);
  assert.deepEqual(await snapshot(store), before);
}));

test("newer incomplete observations never revive older complete or zero totals", async () => fixture(async store => {
  await saveMeasurementRevision(store, input());
  const failed = input(); failed.source.collectedAt = "2026-10-12T00:00:00.000Z";
  failed.source.paginationComplete = false; failed.source.missingReason = "permission_error"; failed.rows = [];
  const parent = await saveMeasurementRevision(store, failed), before = await snapshot(store);
  for (const window of [parent.window, subset()]) {
    const read = await readMeasurementWindow(store, scope, window, asOf);
    assert.equal(read.status, "available"); assert.equal(read.reason, null);
    assert.deepEqual(read.sourceEvidenceIds, [parent.id]); assert.equal(read.projection!.coverage.complete, false);
    assert.equal(read.projection!.metrics.spendMinor.value, null);
    assert.ok(read.projection!.coverage.reasons.includes("pagination_incomplete"));
    assert.ok(read.projection!.coverage.reasons.includes("campaign_days_missing"));
  }
  assert.deepEqual(await snapshot(store), before);
}));

test("saved reads reject tampered digests, content addresses and identity", async () => fixture(async store => {
  const parent = await saveMeasurementRevision(store, input());
  for (const change of [(e: MeasurementEvidence) => { e.digest = "0".repeat(64); },
    (e: MeasurementEvidence) => { e.id = "forged"; },
    (e: MeasurementEvidence) => { e.identity.campaignIds = ["foreign"]; },
    (e: MeasurementEvidence) => { e.rows[0]!.spendMinor.value = 999; }]) {
    const corrupt = structuredClone(parent); change(corrupt);
    await store.db.prepare("UPDATE records SET body=? WHERE project_id=? AND kind=? AND id=?")
      .run(JSON.stringify(corrupt), "p", "measurementEvidence", parent.id);
    const before = await snapshot(store);
    await assert.rejects(readMeasurementWindow(store, scope, subset(), asOf), /measurement_integrity_mismatch/);
    assert.deepEqual(await snapshot(store), before);
  }
}));

test("PostgreSQL saved reads execute only SELECT and succeed while transaction_guard is locked", { skip: !process.env.MARKETING_TEST_POSTGRES_SOCKET }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "measurement-guard-"));
  const options = (await postgresOptions(dir))!;
  const writer = await Store.postgres(options), control = new pg.Client(options);
  let reader: Store | undefined;
  const statements: string[] = [];
  try {
    await writer.db.prepare("INSERT INTO projects VALUES(?,?)").run("p", "Guard test");
    const parent = await saveMeasurementRevision(writer, input());
    reader = await Store.openExistingPostgres({ ...options, onConnect: async c => {
      await c.query("SET lock_timeout='500ms'");
      const query = c.query.bind(c);
      c.query = ((sql: any, ...args: any[]) => { statements.push(typeof sql === "string" ? sql : sql.text); return (query as any)(sql, ...args); }) as typeof c.query;
    } });
    await control.connect(); await control.query("BEGIN");
    await control.query(`SELECT id FROM "${options.schema}".transaction_guard WHERE id=1 FOR UPDATE`);
    const before = await snapshot(writer); statements.length = 0;
    for (const window of [parent.window, subset()]) assert.equal((await readMeasurementWindow(reader, scope, window, asOf)).status, "available");
    assert.equal(statements.length, 2);
    assert.ok(statements.every(sql => /^SELECT body FROM records WHERE project_id=/.test(sql)), statements.join("\n"));
    assert.deepEqual(await snapshot(writer), before);
  } finally {
    await control.query("ROLLBACK").catch(() => {}); await control.end(); await reader?.close(); await writer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
