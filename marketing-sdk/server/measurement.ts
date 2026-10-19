import type { MeasurementEvidence, MeasurementInput, MeasurementValue, MeasurementWindow } from "../core/measurement.js";
import { digest, requireThat, type Store } from "./store.js";
import { instant } from "./validation.js";
import { localDate } from "./reporting.js";

export const unknownMeasurement = (reason: string): MeasurementValue => ({ value: null, reason });
export const measured = (value: number): MeasurementValue => {
  requireThat(Number.isFinite(value) && value >= 0, "invalid_measurement", 422);
  return { value, reason: null };
};
export function compatibleMeasurementWindows(a: MeasurementWindow, b: MeasurementWindow): boolean {
  return Date.parse(a.from) === Date.parse(b.from) && Date.parse(a.until) === Date.parse(b.until) && a.timezone === b.timezone &&
    a.currency === b.currency && a.minorUnitsPerMajor === b.minorUnitsPerMajor;
}
function validateValue(value: MeasurementValue, count = false) {
  requireThat(value && (value.value === null ? typeof value.reason === "string" && value.reason.length > 0
    : Number.isFinite(value.value) && value.value >= 0 && value.reason === null && (!count || Number.isSafeInteger(value.value))),
  "invalid_measurement", 422);
}
function ratio(numerator: MeasurementValue, denominator: MeasurementValue, scale: number): MeasurementValue {
  if (numerator.value === null) return unknownMeasurement(numerator.reason!);
  if (denominator.value === null) return unknownMeasurement(denominator.reason!);
  return denominator.value > 0 ? measured(numerator.value / denominator.value * scale) : unknownMeasurement("zero_denominator");
}
export function measurementDays(window: MeasurementWindow): string[] {
  instant(window.from); instant(window.until);
  requireThat(Number.isFinite(Date.parse(window.from)) && Number.isFinite(Date.parse(window.until)) &&
    Date.parse(window.from) < Date.parse(window.until) && /^[A-Z]{3}$/.test(window.currency) &&
    Number.isSafeInteger(window.minorUnitsPerMajor) && window.minorUnitsPerMajor > 0, "invalid_measurement_window", 422);
  // Both ends must be calendar boundaries; this works across DST transitions.
  for (const value of [window.from, window.until]) requireThat(localDate(value, window.timezone) !==
    localDate(Date.parse(value) - 1, window.timezone), "measurement_requires_local_midnights", 422);
  const start = localDate(window.from, window.timezone), end = localDate(window.until, window.timezone);
  const days: string[] = [];
  for (let cursor = Date.parse(start); cursor < Date.parse(end); cursor += 86400000) days.push(new Date(cursor).toISOString().slice(0, 10));
  return days;
}
function fields(value: object, allowed: string[]) {
  requireThat(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key)), "invalid_measurement_fields", 422);
}
function validateInputFields(input: MeasurementInput) {
  fields(input, ["identity", "window", "source", "rows", "snapshots", "placements", "delivery", "outcomes", "maturity"]);
  fields(input.identity, ["projectId", "nativeCampaignId", "sdkCampaignId", "provider", "accountId", "campaignIds", "materialVersion", "purpose"]);
  fields(input.window, ["from", "until", "timezone", "currency", "minorUnitsPerMajor"]);
  fields(input.source, ["kind", "collector", "apiVersion", "collectedAt", "receiptIds", "snapshotDigests", "paginationComplete", "missingReason", "dataThrough"]);
  fields(input.delivery, ["configuredStatus", "effectiveStatus", "evidenceRefs"]);
  fields(input.maturity, ["state", "reason", "evidenceRefs", "reportingLagEndsAt", "attributionEndsAt", "rereadAt", "coverageVerified"]);
  const rowFields = ["campaignId", "day", "placement", "spendMinor", "impressions", "clicks", "outboundClicks", "landingViews", "providerConversions", "conversionDefinition", "providerCpm", "providerOutboundCtrPercent"];
  const row = (value: object) => { fields(value, rowFields); for (const name of rowFields.slice(3).filter(k => k !== "conversionDefinition")) fields((value as any)[name], ["value", "reason"]); };
  input.rows.forEach(row);
  for (const snapshot of input.snapshots || []) {
    fields(snapshot, ["digest", "request", "collectedAt", "attempt", "rows", "error"]);
    fields(snapshot.request, ["kind", "campaignIds", "since", "until"]); snapshot.rows.forEach(row);
  }
  if (input.placements) { fields(input.placements, ["rows", "complete", "reason", "snapshotDigests"]); input.placements.rows.forEach(row); }
  if (input.outcomes) {
    fields(input.outcomes, ["source", "window", "collectedAt", "evidenceRefs", "qaExcluded", "attributionComplete", "completedSubmissions", "qualified", "customers", "revenueMinor"]);
    fields(input.outcomes.window, ["from", "until", "timezone", "currency", "minorUnitsPerMajor"]);
    for (const name of ["completedSubmissions", "qualified", "customers", "revenueMinor"] as const) fields(input.outcomes[name], ["value", "reason"]);
  }
}
/** Pure evidence construction. Never infers zeros from absent rows or maturity from a closed day. */
export function buildMeasurementEvidence(input: MeasurementInput, previousEvidenceId: string | null = null): MeasurementEvidence {
  validateInputFields(input);
  const value = structuredClone(input), { identity, window, source, rows } = value;
  const days = measurementDays(window);
  requireThat(["meta", "linkedin"].includes(identity.provider) && ["acquisition", "recruitment", "unknown"].includes(identity.purpose) && identity.projectId && identity.nativeCampaignId && identity.accountId && identity.campaignIds.length > 0 &&
    identity.campaignIds.every(id => typeof id === "string" && id.length > 0) &&
    new Set(identity.campaignIds).size === identity.campaignIds.length, "invalid_measurement_identity", 422);
  requireThat(["provider_api", "synthetic"].includes(source.kind) && typeof source.paginationComplete === "boolean" && Number.isFinite(Date.parse(source.collectedAt)) && source.receiptIds.length > 0 && source.snapshotDigests.length > 0 &&
    source.snapshotDigests.every(d => /^[a-f0-9]{64}$/.test(d)), "measurement_provenance_required", 422);
  const seen = new Set<string>();
  const countFields = ["spendMinor", "impressions", "clicks", "outboundClicks", "landingViews"] as const;
  for (const row of rows) {
    requireThat(identity.campaignIds.includes(row.campaignId) && days.includes(row.day) && row.placement === null,
      "measurement_row_scope_mismatch", 422);
    const key = `${row.campaignId}/${row.day}`;
    requireThat(!seen.has(key), "measurement_overlapping_rows", 422); seen.add(key);
    for (const field of countFields) validateValue(row[field], true);
    for (const field of ["providerConversions", "providerCpm", "providerOutboundCtrPercent"] as const) validateValue(row[field]);
    requireThat(row.providerConversions.value === null || Boolean(row.conversionDefinition), "conversion_definition_required", 422);
  }
  const missingCampaignDays = identity.campaignIds.flatMap(c => days.filter(day => !seen.has(`${c}/${day}`)).map(day => `${c}/${day}`));
  const reasons: string[] = [];
  if (!source.paginationComplete) reasons.push("pagination_incomplete");
  if (source.missingReason) reasons.push(source.missingReason);
  if (missingCampaignDays.length) reasons.push("campaign_days_missing");
  if (Date.parse(source.collectedAt) < Date.parse(window.until)) reasons.push("window_open_at_collection");
  const complete = reasons.length === 0;
  const sum = (field: typeof countFields[number] | "providerConversions"): MeasurementValue => {
    if (!complete) return unknownMeasurement(reasons.join(";"));
    const missing = rows.find(row => row[field].value === null);
    if (missing) return unknownMeasurement(missing[field].reason!);
    if (field === "providerConversions" && new Set(rows.map(row => row.conversionDefinition)).size !== 1)
      return unknownMeasurement("incompatible_conversion_definitions");
    const total = rows.reduce((sum, row) => sum + row[field].value!, 0);
    return field !== "providerConversions" && !Number.isSafeInteger(total) ? unknownMeasurement("measurement_sum_overflow") : measured(total);
  };
  const spendMinor = sum("spendMinor"), impressions = sum("impressions"), outboundClicks = sum("outboundClicks");
  let costPerQualifiedMinor = unknownMeasurement("qualified_outcome_coverage_unverified");
  if (value.outcomes) {
    const outcomes = value.outcomes;
    requireThat(Number.isFinite(Date.parse(outcomes.collectedAt)) && outcomes.source && typeof outcomes.qaExcluded === "boolean" &&
      typeof outcomes.attributionComplete === "boolean" && Array.isArray(outcomes.evidenceRefs), "invalid_outcome_provenance", 422);
    for (const field of ["completedSubmissions", "qualified", "customers", "revenueMinor"] as const) validateValue(outcomes[field], true);
    requireThat(compatibleMeasurementWindows(window, outcomes.window), "outcome_window_mismatch", 422);
    if (outcomes.qaExcluded && outcomes.attributionComplete && outcomes.evidenceRefs.length && identity.purpose !== "unknown")
      costPerQualifiedMinor = ratio(spendMinor, outcomes.qualified, 1);
  }
  for (const snapshot of value.snapshots || []) {
    const { digest: hash, ...body } = snapshot;
    requireThat(digest(body) === hash, "measurement_snapshot_integrity_mismatch", 422);
  }
  if (value.snapshots) requireThat(source.snapshotDigests.every(hash => value.snapshots!.some(s => s.digest === hash)), "measurement_snapshot_missing", 422);
  if (value.placements) {
    const keys = new Set<string>();
    for (const row of value.placements.rows) {
      requireThat(identity.campaignIds.includes(row.campaignId) && days.includes(row.day) && typeof row.placement === "string" && row.placement.length > 0,
        "measurement_row_scope_mismatch", 422);
      const key = `${row.campaignId}/${row.day}/${row.placement}`;
      requireThat(!keys.has(key), "measurement_overlapping_rows", 422); keys.add(key);
      for (const field of countFields) validateValue(row[field], true);
      for (const field of ["providerConversions", "providerCpm", "providerOutboundCtrPercent"] as const) validateValue(row[field]);
    }
    // A successful breakdown request is not proof of complete placement coverage.
    const aligned = complete && rows.length > 0 && rows.every(total => {
      const breakdown = value.placements!.rows.filter(row => row.campaignId === total.campaignId && row.day === total.day);
      return breakdown.length > 0 && (["spendMinor", "impressions"] as const).every(field =>
        total[field].value !== null && breakdown.every(row => row[field].value !== null) &&
        breakdown.reduce((sum, row) => sum + row[field].value!, 0) === total[field].value);
    });
    if (value.placements.complete && !aligned) {
      value.placements.complete = false;
      value.placements.reason = "placement_totals_not_reconciled";
    }
  }
  const maturity = value.maturity;
  requireThat(["unknown", "immature", "mature"].includes(maturity.state) && maturity.reason && (maturity.state !== "mature" || (maturity.coverageVerified && maturity.evidenceRefs.length > 0 &&
    maturity.reportingLagEndsAt && maturity.attributionEndsAt && maturity.rereadAt &&
    Date.parse(maturity.reportingLagEndsAt) >= Date.parse(window.until) && Date.parse(maturity.attributionEndsAt) >= Date.parse(window.until) &&
    Date.parse(maturity.rereadAt) >= Math.max(Date.parse(maturity.reportingLagEndsAt), Date.parse(maturity.attributionEndsAt)) &&
    Date.parse(maturity.rereadAt) <= Date.parse(source.collectedAt))), "maturity_evidence_required", 422);
  const comparisons: MeasurementEvidence["reconciliation"]["comparisons"] = [];
  for (const row of rows) {
    const pairs = [
      ["cpm", row.providerCpm, ratio(row.spendMinor, row.impressions, 1000 / window.minorUnitsPerMajor)],
      ["outboundCtrPercent", row.providerOutboundCtrPercent, ratio(row.outboundClicks, row.impressions, 100)],
    ] as const;
    for (const [metric, reported, recomputed] of pairs) if (reported.value !== null && recomputed.value !== null)
      comparisons.push({ campaignId: row.campaignId, day: row.day, metric, reported: reported.value,
        recomputed: recomputed.value, delta: reported.value - recomputed.value });
  }
  const reconciliation: MeasurementEvidence["reconciliation"] = { basis: "provider_reported_vs_recomputed", comparisons,
    status: !comparisons.length ? "not_compared" : comparisons.some(c => c.delta !== 0) ? "discrepant" : "matched" };
  const confidenceReasons = [...reasons];
  for (const [name, metric] of Object.entries({ spendMinor, impressions, outboundClicks })) if (metric.value === null)
    confidenceReasons.push(`${name}:${metric.reason}`);
  if (maturity.state !== "mature") confidenceReasons.push(`attribution:${maturity.state}`);
  if (source.kind === "synthetic") confidenceReasons.push("synthetic_evidence");
  const body = { ...value, schemaVersion: 1 as const, previousEvidenceId,
    coverage: { complete, missingCampaignDays, reasons },
    metrics: { spendMinor, impressions, clicks: sum("clicks"), outboundClicks, landingViews: sum("landingViews"),
      providerConversions: sum("providerConversions"), weightedCpm: ratio(spendMinor, impressions, 1000 / window.minorUnitsPerMajor),
      outboundCtrPercent: ratio(outboundClicks, impressions, 100), costPerQualifiedMinor },
    reconciliation,
    observedDelivery: rows.some(row => (row.impressions.value ?? 0) > 0) ? true : impressions.value === 0 ? false : null,
    confidence: { state: confidenceReasons.length === 0 ? "complete" as const : "incomplete" as const, reasons: confidenceReasons },
    verification: { browser: "not_compared" as const, reason: "independent_browser_evidence_not_supplied" } };
  const hash = digest(body);
  return { ...body, id: `measurement_${hash}`, digest: hash };
}
/** Uses the existing durable store/outbox. Each revision is insert-only and content-addressed. */
export async function saveMeasurementEvidence(store: Store, input: MeasurementInput, previousEvidenceId: string | null = null): Promise<MeasurementEvidence> {
  const evidence = buildMeasurementEvidence(input, previousEvidenceId);
  return store.transaction(async () => {
    if (previousEvidenceId) {
      const previous = await readMeasurementEvidence(store, evidence.identity.projectId, previousEvidenceId);
      requireThat(digest(previous.identity) === digest(evidence.identity) && compatibleMeasurementWindows(previous.window, evidence.window),
        "measurement_revision_scope_mismatch", 422);
      requireThat(Date.parse(evidence.source.collectedAt) >= Date.parse(previous.source.collectedAt), "measurement_revision_time_reversed", 422);
    }
    const inserted = await store.db.prepare(store.db.dialect === "mariadb"
      ? "INSERT IGNORE INTO records(project_id,kind,id,revision,body) VALUES(?,?,?,?,?)"
      : "INSERT INTO records(project_id,kind,id,revision,body) VALUES(?,?,?,?,?) ON CONFLICT(project_id,kind,id) DO NOTHING")
      .run(evidence.identity.projectId, "measurementEvidence", evidence.id, 1, JSON.stringify(evidence));
    if (inserted.changes) await store.append(evidence.identity.projectId, evidence.identity.nativeCampaignId, "measurement.collected", {
      evidenceId: evidence.id, digest: evidence.digest, previousEvidenceId });
    return readMeasurementEvidence(store, evidence.identity.projectId, evidence.id);
  });
}
export async function readMeasurementEvidence(store: Store, projectId: string, evidenceId: string): Promise<MeasurementEvidence> {
  const evidence = await store.get<MeasurementEvidence>(projectId, "measurementEvidence", evidenceId);
  const { id, digest: hash, ...body } = evidence;
  requireThat(evidence.identity.projectId === projectId && id === `measurement_${hash}` && digest(body) === hash, "measurement_integrity_mismatch");
  return evidence;
}

const measurementScopeKey = (input: Pick<MeasurementInput, "identity" | "window">) => digest({ identity: input.identity, window: { ...input.window, from: new Date(input.window.from).toISOString(), until: new Date(input.window.until).toISOString() } });
export async function readLatestMeasurementEvidence(store: Store, scope: Pick<MeasurementInput, "identity" | "window">): Promise<MeasurementEvidence | null> {
  const row = await store.db.prepare("SELECT body FROM records WHERE project_id=? AND kind=? AND id=?")
    .get(scope.identity.projectId, "measurementHead", measurementScopeKey(scope));
  return row ? readMeasurementEvidence(store, scope.identity.projectId, JSON.parse(String(row.body)).evidenceId) : null;
}
/** Serialize head selection and deduplicate the collection independently of its predecessor. */
export async function saveMeasurementRevision(store: Store, input: MeasurementInput): Promise<MeasurementEvidence> {
  const frozen = structuredClone(input), collectionKey = digest(frozen), projectId = frozen.identity.projectId;
  return store.transaction(async () => {
    const receipt = await store.db.prepare("SELECT body FROM records WHERE project_id=? AND kind=? AND id=?")
      .get(projectId, "measurementCollection", collectionKey);
    if (receipt) return readMeasurementEvidence(store, projectId, JSON.parse(String(receipt.body)).evidenceId);
    const latest = await readLatestMeasurementEvidence(store, frozen);
    const evidence = await saveMeasurementEvidence(store, frozen, latest?.id ?? null);
    await store.put(projectId, "measurementCollection", collectionKey, { evidenceId: evidence.id });
    await store.put(projectId, "measurementHead", measurementScopeKey(frozen), { evidenceId: evidence.id });
    return evidence;
  });
}

/** Portfolio comparison accepts one revision per campaign and identical reporting units/windows. */
export function aggregateMeasurementEvidence(evidence: MeasurementEvidence[]): import("../core/measurement.js").MeasurementAggregate {
  const reasons: string[] = [], first = evidence[0], identities = new Set<string>();
  if (!first) reasons.push("no_measurement_evidence");
  for (const item of evidence) {
    const { id, digest: hash, ...body } = item;
    requireThat(id === `measurement_${hash}` && digest(body) === hash, "measurement_integrity_mismatch");
    if (first && (!compatibleMeasurementWindows(first.window, item.window) || first.identity.projectId !== item.identity.projectId)) reasons.push("incompatible_measurement_scope");
    if (!item.coverage.complete) reasons.push("incomplete_campaign_reporting");
    for (const campaignId of item.identity.campaignIds) {
      const key = `${item.identity.provider}/${item.identity.accountId}/${campaignId}`;
      if (identities.has(key)) reasons.push("overlapping_campaign_evidence"); identities.add(key);
    }
    if (item.source.kind === "synthetic") reasons.push("synthetic_evidence");
  }
  const incompatible = reasons.some(reason => reason !== "synthetic_evidence");
  const sum = (name: "spendMinor" | "impressions" | "clicks" | "outboundClicks" | "landingViews" | "providerConversions"): MeasurementValue => {
    if (incompatible || !first) return unknownMeasurement([...new Set(reasons)].join(";"));
    if (name === "providerConversions" && new Set(evidence.flatMap(e => e.rows.map(row => `${e.identity.provider}/${row.conversionDefinition}`))).size !== 1)
      return unknownMeasurement("incompatible_conversion_definitions");
    const missing = evidence.find(e => e.metrics[name].value === null);
    if (missing) return unknownMeasurement(missing.metrics[name].reason!);
    const total = evidence.reduce((n, e) => n + e.metrics[name].value!, 0);
    return name !== "providerConversions" && !Number.isSafeInteger(total) ? unknownMeasurement("measurement_sum_overflow") : measured(total);
  };
  const spendMinor = sum("spendMinor"), impressions = sum("impressions"), outboundClicks = sum("outboundClicks");
  const qualified = !incompatible && first && first.identity.purpose !== "unknown" && evidence.every(e =>
    e.identity.purpose === first.identity.purpose && e.outcomes?.qaExcluded && e.outcomes.attributionComplete && e.outcomes.evidenceRefs.length &&
    e.outcomes.qualified.value !== null && compatibleMeasurementWindows(e.window, e.outcomes.window))
    ? measured(evidence.reduce((n, e) => n + e.outcomes!.qualified.value!, 0)) : unknownMeasurement("qualified_outcome_coverage_unverified");
  for (const [name, metric] of Object.entries({ spendMinor, impressions, outboundClicks })) if (metric.value === null) reasons.push(`${name}:${metric.reason}`);
  return { evidenceIds: evidence.map(e => e.id), window: first && !incompatible ? first.window : null,
    complete: reasons.length === 0, reasons: [...new Set(reasons)], metrics: { spendMinor, impressions, clicks: sum("clicks"), outboundClicks,
      landingViews: sum("landingViews"), providerConversions: sum("providerConversions"),
      weightedCpm: ratio(spendMinor, impressions, 1000 / (first?.window.minorUnitsPerMajor || 1)),
      outboundCtrPercent: ratio(outboundClicks, impressions, 100), costPerQualifiedMinor: ratio(spendMinor, qualified, 1) } };
}

export interface MeasurementWindowScope {
  projectId: string;
  nativeCampaignId: string;
  provider: "meta" | "linkedin";
  accountId: string;
}

/** Keep current-day observed use separate from unknown full-day performance.
 * Callers supply their existing freshness policy and retain spending authority.
 * A complete page without a campaign-day row is still unknown, never zero. */
export function observedMeasurementSpend(evidence: MeasurementEvidence[], options: {asOf: string; maxAgeMs: number}): import("../core/measurement.js").ObservedMeasurementSpend {
  instant(options.asOf);
  requireThat(Number.isSafeInteger(options.maxAgeMs) && options.maxAgeMs >= 0, "invalid_measurement_freshness", 422);
  const reasons: string[] = [], first = evidence[0], identities = new Set<string>(), collected: string[] = [];
  if (!first) reasons.push("no_measurement_evidence");
  for (const item of evidence) {
    const {id, digest: hash, ...body} = item;
    requireThat(id === `measurement_${hash}` && digest(body) === hash, "measurement_integrity_mismatch");
    if (first && (first.identity.projectId !== item.identity.projectId || !compatibleMeasurementWindows(first.window, item.window)))
      reasons.push("incompatible_measurement_scope");
    for (const campaignId of item.identity.campaignIds) {
      const key = `${item.identity.provider}/${item.identity.accountId}/${campaignId}`;
      if (identities.has(key)) reasons.push("overlapping_campaign_evidence");
      identities.add(key);
    }
    if (item.source.kind !== "provider_api") reasons.push("synthetic_evidence");
    const age = Date.parse(options.asOf) - Date.parse(item.source.collectedAt);
    if (age < 0) reasons.push("collection_after_observation_time");
    else if (age > options.maxAgeMs) reasons.push("saved_measurement_stale");
    collected.push(item.source.collectedAt);
    // Only the still-open window is allowed. Missing rows, failed pagination,
    // permission errors and provider scope failures invalidate the observation.
    reasons.push(...item.coverage.reasons.filter(reason => reason !== "window_open_at_collection"));
    if (measurementDays(item.window).some(day => day > localDate(item.source.collectedAt, item.window.timezone)))
      reasons.push("unobserved_future_days");
    for (const row of item.rows) if (row.spendMinor.value === null) reasons.push(row.spendMinor.reason!);
  }
  const unique = [...new Set(reasons)];
  const total = unique.length ? null : evidence.reduce((sum, item) => sum + item.rows.reduce((n, row) => n + row.spendMinor.value!, 0), 0);
  if (total !== null && !Number.isSafeInteger(total)) unique.push("measurement_sum_overflow");
  const complete = unique.length === 0;
  collected.sort((a,b) => Date.parse(a) - Date.parse(b));
  return {basis:"observed_provider_spend", evidenceIds:evidence.map(item => item.id),
    window:first && !unique.includes("incompatible_measurement_scope") ? first.window : null,
    spendMinor:complete ? measured(total!) : unknownMeasurement(unique.join(";")), observationComplete:complete,
    fullWindowComplete:complete && evidence.every(item => item.coverage.complete),
    oldestCollectedAt:collected[0] ?? null, newestCollectedAt:collected.at(-1) ?? null,
    asOf:options.asOf, reasons:unique, reportingLagUnbounded:true};
}
export interface MeasurementWindowRead {
  status: "available" | "missing" | "refresh_required";
  reason: string | null;
  sourceEvidenceIds: string[];
  evidence: MeasurementEvidence | null;
}
/** Only saved record reads are available; no transaction or execution authority. */
export type MeasurementWindowReader = Pick<Store, "list">;
/** Reporting facts, not a receipt. IDs/digests belong to stored source evidence. */
export type MeasurementWindowProjection = Omit<MeasurementEvidence, "id" | "digest" | "previousEvidenceId">;
export type MeasurementWindowProjectionRead = {
  /** Immutable stored parent revisions, including for an ephemeral subset. */
  sourceEvidenceIds: string[];
} & (
  | { status: "available"; reason: null; projectionKind: "stored"; storedEvidenceId: string; projection: MeasurementWindowProjection }
  | { status: "available"; reason: null; projectionKind: "subset"; storedEvidenceId: null; projection: MeasurementWindowProjection }
  | { status: "missing" | "refresh_required"; reason: string; projectionKind: null; storedEvidenceId: null; projection: null }
);
const WINDOW_PROJECTION_COLLECTOR = "sdk_saved_window_projection_v1";
/** Read immutable revisions without treating a saved API observation as a fresh provider read. */
export async function readCampaignMeasurementRevisions(store: Pick<Store, "list">, scope: MeasurementWindowScope, asOf = new Date().toISOString()): Promise<MeasurementEvidence[]> {
  instant(asOf);
  const records = await store.list<MeasurementEvidence>(scope.projectId, "measurementEvidence");
  const selected = records.filter(e => e.identity.projectId === scope.projectId && e.identity.nativeCampaignId === scope.nativeCampaignId &&
    e.identity.provider === scope.provider && e.identity.accountId === scope.accountId && Date.parse(e.source.collectedAt) <= Date.parse(asOf));
  for (const evidence of selected) {
    const { id, digest: hash, ...body } = evidence;
    requireThat(id === `measurement_${hash}` && digest(body) === hash, "measurement_integrity_mismatch");
  }
  return selected.sort((a, b) => Date.parse(b.source.collectedAt) - Date.parse(a.source.collectedAt) || b.id.localeCompare(a.id));
}
/** Select a bounded view of the latest overlapping collection. Never combine stale
 * daily fragments to conceal a newer incomplete report. A narrower latest read
 * requires a fresh whole-window collection; it does not resurrect older totals.
 * The projection retains original collection time and source snapshots. */
async function selectMeasurementWindow(store: Pick<Store, "list">, scope: MeasurementWindowScope, window: MeasurementWindow, asOf: string): Promise<{
  status: MeasurementWindowRead["status"]; reason: string | null; sourceEvidenceIds: string[];
  evidence?: MeasurementEvidence; input?: MeasurementInput;
}> {
  const days = measurementDays(window);
  const revisions = await readCampaignMeasurementRevisions(store, scope, asOf);
  const latest = revisions.find(e => e.source.collector !== WINDOW_PROJECTION_COLLECTOR &&
    Date.parse(e.window.from) < Date.parse(window.until) && Date.parse(e.window.until) > Date.parse(window.from));
  if (!latest) return {status:"missing",reason:"no_saved_window_evidence",sourceEvidenceIds:[]};
  const sourceEvidenceIds=[latest.id];
  if (compatibleMeasurementWindows(latest.window,window)) return {status:"available",reason:null,sourceEvidenceIds,evidence:latest};
  if (latest.window.currency !== window.currency || latest.window.timezone !== window.timezone || latest.window.minorUnitsPerMajor !== window.minorUnitsPerMajor)
    return {status:"refresh_required",reason:"saved_measurement_units_changed",sourceEvidenceIds};
  if (Date.parse(latest.window.from) > Date.parse(window.from) || Date.parse(latest.window.until) < Date.parse(window.until))
    return {status:"refresh_required",reason:"latest_collection_does_not_cover_window",sourceEvidenceIds};
  return {status:"available",reason:null,sourceEvidenceIds,input:{
    identity:latest.identity,window,
    source:{...latest.source,collector:WINDOW_PROJECTION_COLLECTOR,receiptIds:[...latest.source.receiptIds,latest.id],dataThrough:null},
    rows:latest.rows.filter(row=>days.includes(row.day)),snapshots:latest.snapshots,
    ...(latest.placements?{placements:{...latest.placements,rows:latest.placements.rows.filter(row=>days.includes(row.day))}}:{}),
    delivery:latest.delivery,outcomes:null,
    maturity:{state:"unknown",reason:"subset_attribution_not_independently_qualified",evidenceRefs:sourceEvidenceIds,
      reportingLagEndsAt:null,attributionEndsAt:null,rereadAt:null,coverageVerified:false},
  }};
}

/** Read full reporting facts without retaining derived evidence or acquiring the
 * transaction guard. "available" means saved facts exist, not complete coverage.
 * Subsets retain original collection provenance and lose whole-window attribution
 * qualification. Host authorization must precede this server-only record read. */
export async function readMeasurementWindow(reader: MeasurementWindowReader, scope: MeasurementWindowScope,
  window: MeasurementWindow, asOf = new Date().toISOString()): Promise<MeasurementWindowProjectionRead> {
  const selected = await selectMeasurementWindow(reader, scope, window, asOf);
  if (!selected.evidence && !selected.input) return {
    status: selected.status as "missing" | "refresh_required", reason: selected.reason!,
    sourceEvidenceIds: selected.sourceEvidenceIds, projectionKind: null, storedEvidenceId: null, projection: null,
  };
  const evidence = selected.evidence ?? buildMeasurementEvidence(selected.input!);
  const { id, digest: _digest, previousEvidenceId: _previous, ...projection } = structuredClone(evidence);
  return selected.evidence
    ? { status: "available", reason: null, sourceEvidenceIds: selected.sourceEvidenceIds, projectionKind: "stored", storedEvidenceId: id, projection }
    : { status: "available", reason: null, sourceEvidenceIds: selected.sourceEvidenceIds, projectionKind: "subset", storedEvidenceId: null, projection };
}

export async function materializeMeasurementWindow(store: Store, scope: MeasurementWindowScope, window: MeasurementWindow, asOf = new Date().toISOString()): Promise<MeasurementWindowRead> {
  return store.transaction(async()=>{
    const selected=await selectMeasurementWindow(store,scope,window,asOf);
    const evidence=selected.evidence ?? (selected.input ? await saveMeasurementEvidence(store,selected.input) : null);
    return {status:selected.status,reason:selected.reason,sourceEvidenceIds:selected.sourceEvidenceIds,evidence};
  });
}

/** Read-only budget observations can borrow a host transaction via this narrow
 * record-reader interface. No projection, grant, outbox or execution write occurs.
 * Returned evidenceIds always identify stored parent revisions, never temporary
 * subset calculations. A missing campaign invalidates the whole observed amount. */
export async function readObservedMeasurementSpend(store: Pick<Store,"list">,
  scopes: (MeasurementWindowScope & {window: MeasurementWindow; campaignIds: string[]})[],
  options: {asOf: string; maxAgeMs: number}): Promise<import("../core/measurement.js").ObservedMeasurementSpend> {
  const items: MeasurementEvidence[]=[], evidenceIds: string[]=[], reasons: string[]=[];
  for (const scope of scopes) {
    const selected=await selectMeasurementWindow(store,scope,scope.window,options.asOf);
    evidenceIds.push(...selected.sourceEvidenceIds);
    if (selected.reason) {reasons.push(selected.reason);continue;}
    const evidence=selected.evidence ?? buildMeasurementEvidence(selected.input!);
    if (!scope.campaignIds.length || new Set(scope.campaignIds).size !== scope.campaignIds.length ||
      [...scope.campaignIds].sort().join("/") !== [...evidence.identity.campaignIds].sort().join("/")) {
      reasons.push("provider_campaign_binding_changed");continue;
    }
    items.push(evidence);
  }
  const result=observedMeasurementSpend(items.length === scopes.length ? items : [],options);
  result.evidenceIds=[...new Set(evidenceIds)];
  if (reasons.length) {
    result.reasons=[...new Set([...result.reasons,...reasons])];
    result.spendMinor=unknownMeasurement(result.reasons.join(";"));
    result.observationComplete=false;result.fullWindowComplete=false;
  }
  return result;
}
