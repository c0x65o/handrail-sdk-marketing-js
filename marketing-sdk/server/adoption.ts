import type { HistoricalCampaignSnapshot, HistoricalImportReceipt, HistoricalRecord, HistoricalRecordKind, HistoricalProjectSnapshot, HistoricalProjectImportReceipt } from "../core/adoption.js";
import { canonical } from "../core/index.js";
import { measurementDays, readMeasurementEvidence, compatibleMeasurementWindows } from "./measurement.js";
import { Store, digest, requireThat, type Principal, DomainError } from "./store.js";

/** Host-owned identity/source binding. It supplies no provider-write authority.
 * Capture must use a consistent snapshot and explicitly project safe source columns.
 * withCurrentSnapshot verifies current actor access and source revision around commit. */
export interface HistoricalCampaignSource {
  authorize(principal: Principal, projectId: string, nativeCampaignId: string): Promise<void>;
  capture(principal: Principal, projectId: string, nativeCampaignId: string): Promise<HistoricalCampaignSnapshot>;
  assertCurrent(principal: Principal, snapshot: HistoricalCampaignSnapshot): Promise<void>;
  withCurrentSnapshot<T>(principal: Principal, snapshot: HistoricalCampaignSnapshot, commit: () => Promise<T>): Promise<T>;
}
export interface HistoricalProjectSource {
  authorize(principal: Principal, projectId: string): Promise<void>;
  capture(principal: Principal, projectId: string): Promise<HistoricalProjectSnapshot>;
  assertCurrent(principal: Principal, snapshot: HistoricalProjectSnapshot): Promise<void>;
  withCurrentSnapshot<T>(principal: Principal, snapshot: HistoricalProjectSnapshot, commit: () => Promise<T>): Promise<T>;
}
type Snapshot = HistoricalCampaignSnapshot | HistoricalProjectSnapshot;
type Receipt = HistoricalImportReceipt | HistoricalProjectImportReceipt;
const projectScope = (s: Snapshot): s is HistoricalProjectSnapshot => "scope" in s && s.scope === "project";
const kinds: HistoricalRecordKind[] = ["campaign", "provider_object", "material", "targeting", "budget", "authority", "operation", "report", "attribution", "lead", "event", "outcome"];
const metrics = ["spendMinor", "impressions", "clicks", "outboundClicks", "providerConversions", "qualified"];
const text = (v: unknown) => typeof v === "string" && v.length > 0;
const time = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v));
const recordKey = (r: Pick<HistoricalRecord, "kind" | "sourceId" | "sourceRevision">) => canonical([r.kind, r.sourceId, r.sourceRevision]);
// Re-reading unchanged source content does not invent a correction or replace its
// first capture time. Original per-record reporting/collection times remain hashed.
const snapshotDigest = (s: Snapshot) => digest({ ...s,
  source: { ...s.source, capturedAt: null, receiptRefs: [...s.source.receiptRefs].sort() },
  ...(!projectScope(s) ? { providerCampaignIds: [...s.providerCampaignIds].sort() } : {}), unsettledOperationIds: [...s.unsettledOperationIds].sort(),
  records: [...s.records].sort((a,b) => recordKey(a) < recordKey(b) ? -1 : recordKey(a) > recordKey(b) ? 1 : 0),
  totals: s.totals.map(t => ({ ...t, sourceRecordIds: [...t.sourceRecordIds].sort() })).sort((a,b) => canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0),
});
const validValue = (v: unknown): boolean => {
  const m = v as {value?: number | null;reason?: string | null} | null;
  return !!m && (m.value === null ? text(m.reason) : Number.isSafeInteger(m.value) && m.value! >= 0 && m.reason === null);
};
function validateJson(value: unknown): void {
  requireThat(value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value) ||
    typeof value === "object" && (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype), "historical_invalid_json", 422);
  if (value && typeof value === "object") for (const v of Object.values(value)) validateJson(v);
}
function validate(snapshot: Snapshot) {
  validateJson(snapshot);
  if (projectScope(snapshot)) {
    requireThat(snapshot.schemaVersion === 1 && text(snapshot.projectId) && text(snapshot.scopeReason) &&
      !["nativeCampaignId", "provider", "accountId", "providerCampaignIds", "purpose"].some(k => k in snapshot),
      "historical_project_identity_invalid", 422);
  } else {
    requireThat(snapshot.schemaVersion === 1 && text(snapshot.projectId) && text(snapshot.nativeCampaignId) &&
      ["meta", "linkedin", "unknown"].includes(snapshot.provider) && (snapshot.accountId === null || text(snapshot.accountId)) &&
      ["acquisition", "recruitment", "unknown"].includes(snapshot.purpose), "historical_identity_invalid", 422);
    requireThat(Array.isArray(snapshot.providerCampaignIds) && snapshot.providerCampaignIds.every(text) &&
      new Set(snapshot.providerCampaignIds).size === snapshot.providerCampaignIds.length, "historical_provider_identity_conflict", 422);
    requireThat(Array.isArray(snapshot.identityMissingReasons) && snapshot.identityMissingReasons.every(text) &&
      (snapshot.provider !== "unknown" && snapshot.accountId !== null && snapshot.providerCampaignIds.length > 0 || snapshot.identityMissingReasons.length > 0) &&
      (snapshot.purpose === "unknown" ? text(snapshot.purposeReason) : snapshot.purposeReason === null), "historical_missing_identity_reason_required", 422);
  }
  requireThat(snapshot.source && text(snapshot.source.system) && text(snapshot.source.revision) && time(snapshot.source.capturedAt) &&
    Array.isArray(snapshot.source.receiptRefs) && snapshot.source.receiptRefs.length > 0 && snapshot.source.receiptRefs.every(text), "historical_source_required", 422);
  requireThat(Array.isArray(snapshot.records) && snapshot.expectedCounts && Array.isArray(snapshot.totals) &&
    Array.isArray(snapshot.unsettledOperationIds), "historical_manifest_invalid", 422);
  const counts: Partial<Record<HistoricalRecordKind, number>> = {}, seen = new Set<string>();
  for (const r of snapshot.records) {
    requireThat(kinds.includes(r.kind) && text(r.sourceId) && text(r.sourceRevision) &&
      (r.recordedAt === null || time(r.recordedAt)) && (r.collectedAt === null || time(r.collectedAt)) &&
      ["legacy_observation", "verified_evidence"].includes(r.provenance) &&
      Array.isArray(r.missingReasons) && r.missingReasons.every(text) &&
      (r.recordedAt !== null && r.collectedAt !== null || r.missingReasons.length > 0) &&
      r.payload && typeof r.payload === "object" && !Array.isArray(r.payload), "historical_record_invalid", 422);
    requireThat(!seen.has(recordKey(r)), "historical_duplicate_identity", 422); seen.add(recordKey(r));
    requireThat(r.provenance === "verified_evidence" ? text(r.evidenceId) : r.evidenceId === null, "historical_evidence_provenance_invalid", 422);
    if (r.measurement) {
      requireThat((r.kind === "report" || r.kind === "outcome") && text(r.measurement.partition) && r.measurement.values &&
        Object.entries(r.measurement.values).every(([k,v]) => metrics.includes(k) && validValue(v)), "historical_measurement_invalid", 422);
      measurementDays(r.measurement.window);
    }
    if ((r.kind === "report" || r.kind === "outcome") && !r.measurement)
      requireThat(text(r.measurementMissingReason), "historical_measurement_reason_required", 422);
    counts[r.kind] = (counts[r.kind] ?? 0) + 1;
  }
  requireThat(Object.keys(snapshot.expectedCounts).every(k => kinds.includes(k as HistoricalRecordKind)) &&
    kinds.every(k => Number.isSafeInteger(snapshot.expectedCounts[k] ?? 0) && (snapshot.expectedCounts[k] ?? 0) === (counts[k] ?? 0)), "historical_count_mismatch", 422);
  const campaigns = snapshot.records.filter(r => r.kind === "campaign");
  requireThat(projectScope(snapshot) ? campaigns.length === 0 : campaigns.length > 0 && campaigns.every(r => r.sourceId === snapshot.nativeCampaignId), "historical_campaign_identity_mismatch", 422);
  const operations = new Set(snapshot.records.filter(r => r.kind === "operation").map(r => r.sourceId));
  requireThat(new Set(snapshot.unsettledOperationIds).size === snapshot.unsettledOperationIds.length &&
    snapshot.unsettledOperationIds.every(id => operations.has(id)), "historical_operation_missing", 422);
  const totalKeys = new Set<string>(), covered = new Set<string>();
  for (const total of snapshot.totals) {
    requireThat(text(total.partition) && metrics.includes(total.metric) && total.window &&
      text(total.window.currency) && Number.isSafeInteger(total.window.minorUnitsPerMajor) && total.window.minorUnitsPerMajor > 0,
      "historical_total_invalid", 422);
    measurementDays(total.window);
    const key = canonical([total.partition, total.window, total.metric]);
    requireThat(!totalKeys.has(key), "historical_duplicate_total", 422); totalKeys.add(key);
    requireThat(validValue(total.value), "historical_total_unknown_reason_required", 422);
    requireThat(Array.isArray(total.sourceRecordIds) && total.sourceRecordIds.length > 0 &&
      new Set(total.sourceRecordIds).size === total.sourceRecordIds.length &&
      total.sourceRecordIds.every(id => snapshot.records.some(r => r.sourceId === id && (r.kind === "report" || r.kind === "outcome"))), "historical_total_sources_missing", 422);
    const rows = snapshot.records.filter(r => r.measurement?.partition === total.partition && total.sourceRecordIds.includes(r.sourceId));
    requireThat(rows.length === total.sourceRecordIds.length && new Set(rows.map(r => r.sourceId)).size === rows.length &&
      rows.every(r => compatibleMeasurementWindows(r.measurement!.window, total.window) && validValue(r.measurement!.values[total.metric])),
      "historical_total_incompatible_sources", 422);
    const values = rows.map(r => r.measurement!.values[total.metric]!);
    for (const r of rows) {
      const coveredKey = canonical([recordKey(r), total.metric]);
      requireThat(!covered.has(coveredKey), "historical_total_double_count", 422); covered.add(coveredKey);
    }
    const sum = values.every(v => v.value !== null) ? values.reduce((n,v) => n + v.value!, 0) : null;
    requireThat(sum === total.value.value && (sum === null || Number.isSafeInteger(sum)), "historical_total_mismatch", 422);
  }
  requireThat(snapshot.records.every(r => !r.measurement || Object.keys(r.measurement.values).every(metric =>
    covered.has(canonical([recordKey(r), metric])))), "historical_total_coverage_missing", 422);
  return counts;
}
async function optional<T>(store: Store, project: string, kind: string, key: string): Promise<T | null> {
  try { return await store.get<T>(project, kind, key); }
  catch (e) { if (e instanceof DomainError && e.code === "not_found") return null; throw e; }
}

/** Immutable historical retention. Execution adoption is a separate reconciled transition. */
export class HistoricalCampaignImports {
  constructor(readonly store: Store, readonly source: HistoricalCampaignSource) {}
  async stage(principal: Principal, project: string, nativeCampaignId: string, requestKey: string): Promise<HistoricalImportReceipt> {
    requireThat(text(nativeCampaignId) && text(requestKey), "historical_request_invalid", 422);
    await this.store.authorize(principal, project, ["admin", "editor"]);
    await this.source.authorize(principal, project, nativeCampaignId);
    const snapshot = structuredClone(await this.source.capture(principal, project, nativeCampaignId));
    requireThat(snapshot.projectId === project && snapshot.nativeCampaignId === nativeCampaignId, "historical_scope_mismatch", 403);
    return await persistHistory(this.store, this.source, principal, project, snapshot, requestKey) as HistoricalImportReceipt;
  }
  async readRequest(principal: Principal, project: string, requestKey: string) {
    requireThat(text(requestKey), "historical_request_invalid", 422);
    await this.store.authorize(principal, project);
    const request = await optional<{ receiptId: string }>(this.store, project, "historicalImportRequest", digest([principal.userId, requestKey]));
    return request ? this.read(principal, project, request.receiptId) : null;
  }
  async read(principal: Principal, project: string, importId: string) {
    await this.store.authorize(principal, project);
    const receipt = await this.store.get<HistoricalImportReceipt>(project, "historicalImport", importId);
    requireThat("nativeCampaignId" in receipt && text(receipt.nativeCampaignId), "historical_scope_mismatch", 403);
    await this.source.authorize(principal, project, receipt.nativeCampaignId);
    const snapshot = await this.store.get<HistoricalCampaignSnapshot>(project, "historicalSnapshot", importId);
    requireThat(snapshotDigest(snapshot) === receipt.sourceDigest, "historical_snapshot_reconciliation_failed");
    await this.source.authorize(principal, project, receipt.nativeCampaignId);
    await this.store.authorize(principal, project);
    return { receipt, snapshot };
  }
}

// Both scopes use the same reconciliation and immutable persistence. Campaign v1
// digests and keys stay unchanged so already-imported receipts remain readable.
async function persistHistory<S extends Snapshot>(store: Store, source: {
  assertCurrent(principal: Principal, snapshot: S): Promise<void>;
  withCurrentSnapshot<T>(principal: Principal, snapshot: S, commit: () => Promise<T>): Promise<T>;
}, principal: Principal, project: string, snapshot: S, requestKey: string): Promise<Receipt> {
  const counts = validate(snapshot), sourceDigest = snapshotDigest(snapshot);
  const isProject = projectScope(snapshot), nativeCampaignId = isProject ? null : snapshot.nativeCampaignId;
  const identity = isProject ? { scope: "project" as const } : { nativeCampaignId: nativeCampaignId! };
  const pointerKey = digest(isProject ? [snapshot.source.system, "project", project] : [snapshot.source.system, nativeCampaignId]);
  const key = digest(isProject ? [principal.userId, "project", requestKey] : [principal.userId, requestKey]);
  return source.withCurrentSnapshot(principal, snapshot, () => store.transaction(async () => {
    await store.authorize(principal, project, ["admin", "editor"]);
    await source.assertCurrent(principal, snapshot);
    const replay = await optional<{ sourceDigest: string; receiptId: string }>(store, project, "historicalImportRequest", key);
    if (replay) {
      requireThat(replay.sourceDigest === sourceDigest, "historical_request_conflict");
      const receipt = await store.get<Receipt>(project, "historicalImport", replay.receiptId);
      await source.assertCurrent(principal, snapshot);
      return receipt;
    }
    const id = `${isProject ? "project_history" : "history"}_${sourceDigest}`, existing = await optional<Receipt>(store, project, "historicalImport", id);
    if (existing) {
      await store.put(project, "historicalImportRequest", key, { sourceDigest, receiptId: id });
      await source.assertCurrent(principal, snapshot);
      return existing;
    }
    for (const r of snapshot.records) if (r.provenance === "verified_evidence") {
      const evidence = await readMeasurementEvidence(store, project, r.evidenceId!);
      requireThat(evidence.source.kind === "provider_api" && (projectScope(snapshot)
        ? evidence.identity.nativeCampaignId === null
        : evidence.identity.nativeCampaignId === snapshot.nativeCampaignId && evidence.identity.provider === snapshot.provider &&
          evidence.identity.accountId === snapshot.accountId && evidence.identity.campaignIds.every(id => snapshot.providerCampaignIds.includes(id))), "historical_evidence_scope_mismatch", 422);
      requireThat(r.kind === "report" && r.measurement && compatibleMeasurementWindows(r.measurement.window, evidence.window) &&
        Object.entries(r.measurement.values).every(([metric, value]) => {
          const actual = metric === "qualified" ? evidence.outcomes?.qualified : evidence.metrics[metric as keyof typeof evidence.metrics];
          return actual && canonical(value) === canonical(actual);
        }), "historical_verified_values_mismatch", 422);
    }
    const previous = await optional<{ id: string }>(store, project, "historicalImportCurrent", pointerKey);
    const recordRefs: HistoricalImportReceipt["recordRefs"] = [];
    for (const record of snapshot.records) {
      const hash = digest({ project, ...identity, system: snapshot.source.system, record });
      const saved = await optional<HistoricalRecord>(store, project, "historicalRecord", hash);
      if (saved) requireThat(digest(saved) === digest(record), "historical_record_corrupt");
      else await store.put(project, "historicalRecord", hash, record);
      recordRefs.push({ kind: record.kind, sourceId: record.sourceId, sourceRevision: record.sourceRevision, digest: hash });
    }
    const receipt: Receipt = { schemaVersion: 1, id, projectId: project, ...identity, sourceDigest,
      previousImportId: previous?.id ?? null, source: snapshot.source, recordRefs, counts, totals: snapshot.totals,
      unsettledOperationIds: snapshot.unsettledOperationIds, importedAt: new Date().toISOString(), importedBy: principal.userId,
      executionTransferred: false, status: "history_reconciled" };
    await store.put(project, "historicalSnapshot", id, snapshot);
    await store.put(project, "historicalImport", id, receipt);
    await store.put(project, "historicalImportCurrent", pointerKey, { id });
    await store.put(project, "historicalImportRequest", key, { sourceDigest, receiptId: id });
    // Read back persisted bytes before accepting retention. No campaign/event/grant writes.
    requireThat(snapshotDigest(await store.get(project, "historicalSnapshot", id)) === sourceDigest, "historical_snapshot_reconciliation_failed");
    for (const ref of recordRefs) {
      const record = await store.get<HistoricalRecord>(project, "historicalRecord", ref.digest);
      requireThat(digest({ project, ...identity, system: snapshot.source.system, record }) === ref.digest, "historical_record_reconciliation_failed");
    }
    await store.append(project, nativeCampaignId ?? project, isProject ? "project.history_imported" : "campaign.history_imported", { importId: id, sourceDigest, counts, executionTransferred: false });
    await store.authorize(principal, project, ["admin", "editor"]);
    await source.assertCurrent(principal, snapshot);
    return receipt;
  }));

}

export class HistoricalProjectImports {
  constructor(readonly store: Store, readonly source: HistoricalProjectSource) {}
  async stage(principal: Principal, project: string, requestKey: string): Promise<HistoricalProjectImportReceipt> {
    requireThat(text(requestKey), "historical_request_invalid", 422);
    await this.store.authorize(principal, project, ["admin", "editor"]);
    await this.source.authorize(principal, project);
    const snapshot = structuredClone(await this.source.capture(principal, project));
    requireThat(snapshot.projectId === project && projectScope(snapshot), "historical_scope_mismatch", 403);
    return await persistHistory(this.store, this.source, principal, project, snapshot, requestKey) as HistoricalProjectImportReceipt;
  }
  async readRequest(principal: Principal, project: string, requestKey: string) {
    requireThat(text(requestKey), "historical_request_invalid", 422);
    await this.store.authorize(principal, project);
    await this.source.authorize(principal, project);
    const request = await optional<{ receiptId: string }>(this.store, project, "historicalImportRequest", digest([principal.userId, "project", requestKey]));
    await this.source.authorize(principal, project);
    await this.store.authorize(principal, project);
    return request ? this.read(principal, project, request.receiptId) : null;
  }
  async read(principal: Principal, project: string, importId: string) {
    await this.store.authorize(principal, project);
    await this.source.authorize(principal, project);
    const receipt = await this.store.get<HistoricalProjectImportReceipt>(project, "historicalImport", importId);
    requireThat(receipt.scope === "project", "historical_scope_mismatch", 403);
    const snapshot = await this.store.get<HistoricalProjectSnapshot>(project, "historicalSnapshot", importId);
    requireThat(projectScope(snapshot) && snapshotDigest(snapshot) === receipt.sourceDigest, "historical_snapshot_reconciliation_failed");
    await this.source.authorize(principal, project);
    await this.store.authorize(principal, project);
    return { receipt, snapshot };
  }
}
