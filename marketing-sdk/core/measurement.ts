/** Provider facts are distinct from host outcomes and optimizer interpretation. */
export interface MeasurementValue {
  value: number | null;
  reason: string | null;
}
export interface MeasurementWindow {
  /** Half-open UTC instants corresponding to provider-local calendar boundaries. */
  from: string;
  until: string;
  timezone: string;
  currency: string;
  minorUnitsPerMajor: number;
}
export interface MeasurementIdentity {
  projectId: string;
  nativeCampaignId: string;
  sdkCampaignId: string | null;
  provider: "meta" | "linkedin";
  accountId: string;
  campaignIds: string[];
  materialVersion: string | null;
  purpose: "acquisition" | "recruitment" | "unknown";
}
export interface MeasurementRow {
  campaignId: string;
  day: string;
  /** Null means campaign total. Placement rows never mix with total rows. */
  placement: string | null;
  spendMinor: MeasurementValue;
  impressions: MeasurementValue;
  clicks: MeasurementValue;
  outboundClicks: MeasurementValue;
  landingViews: MeasurementValue;
  providerConversions: MeasurementValue;
  conversionDefinition: string | null;
  providerCpm: MeasurementValue;
  providerOutboundCtrPercent: MeasurementValue;
}
export interface MeasurementSource {
  kind: "provider_api" | "synthetic";
  collector: string;
  apiVersion: string;
  collectedAt: string;
  /** Safe opaque receipt/digest references only; never credential-bearing URLs. */
  receiptIds: string[];
  snapshotDigests: string[];
  paginationComplete: boolean;
  missingReason: string | null;
  dataThrough: string | null;
}
export interface AttributionMaturity {
  state: "unknown" | "immature" | "mature";
  reason: string;
  evidenceRefs: string[];
  reportingLagEndsAt: string | null;
  attributionEndsAt: string | null;
  rereadAt: string | null;
  coverageVerified: boolean;
}
export interface MeasurementOutcomes {
  source: string;
  window: MeasurementWindow;
  collectedAt: string;
  evidenceRefs: string[];
  qaExcluded: boolean;
  attributionComplete: boolean;
  completedSubmissions: MeasurementValue;
  qualified: MeasurementValue;
  customers: MeasurementValue;
  revenueMinor: MeasurementValue;
}
export interface MeasurementSnapshot {
  digest: string;
  request: { kind: "campaign_totals" | "placements"; campaignIds: string[]; since: string; until: string };
  collectedAt: string;
  attempt: number;
  rows: MeasurementRow[];
  error: string | null;
}
export interface MeasurementPlacements {
  rows: MeasurementRow[];
  complete: boolean;
  reason: string | null;
  snapshotDigests: string[];
}
export interface MeasurementInput {
  identity: MeasurementIdentity;
  window: MeasurementWindow;
  source: MeasurementSource;
  rows: MeasurementRow[];
  snapshots?: MeasurementSnapshot[];
  placements?: MeasurementPlacements;
  delivery: { configuredStatus: string | null; effectiveStatus: string | null; evidenceRefs: string[] };
  outcomes: MeasurementOutcomes | null;
  maturity: AttributionMaturity;
}
export interface MeasurementEvidence extends MeasurementInput {
  schemaVersion: 1;
  id: string;
  digest: string;
  previousEvidenceId: string | null;
  coverage: { complete: boolean; missingCampaignDays: string[]; reasons: string[] };
  metrics: {
    spendMinor: MeasurementValue;
    impressions: MeasurementValue;
    clicks: MeasurementValue;
    outboundClicks: MeasurementValue;
    landingViews: MeasurementValue;
    providerConversions: MeasurementValue;
    weightedCpm: MeasurementValue;
    outboundCtrPercent: MeasurementValue;
    costPerQualifiedMinor: MeasurementValue;
  };
  reconciliation: {
    basis: "provider_reported_vs_recomputed";
    comparisons: { campaignId: string; day: string; metric: "cpm" | "outboundCtrPercent"; reported: number; recomputed: number; delta: number }[];
    status: "matched" | "discrepant" | "not_compared";
  };
  observedDelivery: boolean | null;
  confidence: { state: "complete" | "incomplete"; reasons: string[] };
  verification: { browser: "not_compared"; reason: string };
}

export interface MeasurementAggregate {
  evidenceIds: string[];
  window: MeasurementWindow | null;
  complete: boolean;
  reasons: string[];
  metrics: MeasurementEvidence["metrics"];
}
