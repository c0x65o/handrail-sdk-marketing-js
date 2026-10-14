import type { MeasurementValue, MeasurementWindow } from "./measurement.js";

export type HistoricalRecordKind = "campaign" | "provider_object" | "material" | "targeting" | "budget" |
  "authority" | "operation" | "report" | "attribution" | "lead" | "event" | "outcome";
export type HistoricalJson = null | boolean | number | string | HistoricalJson[] | { [key: string]: HistoricalJson };
export type HistoricalMetric = "spendMinor" | "impressions" | "clicks" | "outboundClicks" | "providerConversions" | "qualified";
export interface HistoricalRecord {
  kind: HistoricalRecordKind;
  /** Original source key, retained without creating a replacement provider/event identity. */
  sourceId: string;
  sourceRevision: string;
  recordedAt: string | null;
  collectedAt: string | null;
  provenance: "legacy_observation" | "verified_evidence";
  evidenceId: string | null;
  missingReasons: string[];
  payload: { [key: string]: HistoricalJson };
  measurement?: { partition: string; window: MeasurementWindow; values: Partial<Record<HistoricalMetric, MeasurementValue>> };
  measurementMissingReason?: string;
}
export interface HistoricalTotal {
  /** Disjoint source partitions only. Revisions and collection snapshots have separate keys. */
  partition: string;
  window: MeasurementWindow;
  metric: HistoricalMetric;
  value: MeasurementValue;
  sourceRecordIds: string[];
}
export interface HistoricalCampaignSnapshot {
  schemaVersion: 1;
  projectId: string;
  nativeCampaignId: string;
  provider: "meta" | "linkedin" | "unknown";
  accountId: string | null;
  providerCampaignIds: string[];
  identityMissingReasons: string[];
  purpose: "acquisition" | "recruitment" | "unknown";
  purposeReason: string | null;
  source: { system: string; revision: string; capturedAt: string; receiptRefs: string[] };
  records: HistoricalRecord[];
  /** Source's independent enumeration, compared against the imported records. */
  expectedCounts: Partial<Record<HistoricalRecordKind, number>>;
  /** Source totals retain exact window, timezone, currency, snapshot and partition. */
  totals: HistoricalTotal[];
  unsettledOperationIds: string[];
}
export interface HistoricalImportReceipt {
  schemaVersion: 1;
  id: string;
  projectId: string;
  nativeCampaignId: string;
  sourceDigest: string;
  previousImportId: string | null;
  source: HistoricalCampaignSnapshot["source"];
  recordRefs: { kind: HistoricalRecordKind; sourceId: string; sourceRevision: string; digest: string }[];
  counts: Partial<Record<HistoricalRecordKind, number>>;
  totals: HistoricalTotal[];
  unsettledOperationIds: string[];
  importedAt: string;
  importedBy: string;
  /** Import is retention, not a grant, event replay or execution-owner transfer. */
  executionTransferred: false;
  status: "history_reconciled";
}
