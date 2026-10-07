export * from "./creative-connections.js";
export * from "./capabilities.js";
export * from "./connections.js";
import type { ConnectionCommands } from "./connections.js";
import type { ProviderSettings, ApplicantGoal, AccountCapabilityEvidence, TargetingOption } from "./capabilities.js";
/** Browser-safe public contract. No credentials, React or server imports. */
export type Provider = "meta" | "google" | "linkedin";
export type Role =
  | "admin"
  | "editor"
  | "approver"
  | "analyst"
  | "sales"
  | "collector";
export type Permission = "setup" | "prepare" | "activate" | "pause" | "report";
export interface Money {
  currency: string;
  minor: number;
}
/** Legacy Material.budget remains the lifetime approval; daily is never inferred. */
export interface AdvertisingBudget {
  lifetime: Money;
  daily?: Money;
  campaignDailyCeiling?: Money;
  campaignLifetimeCeiling?: Money;
}
export type MarketingPurpose = "acquisition" | "recruitment";
export interface ReportingBasis {
  window: "completed-provider-days" | "fixture-window" | "partial-or-open-window";
  timezone: string;
  timezoneSource?: "provider_account" | "provider_reporting_and_budget_policy";
  from: string;
  until: string;
  /** Exclusive end; provider aggregates are observations, never delivery proof. */
  completeThrough: string | null;
}
export interface Audience {
  provider: Provider;
  /** Provider identifiers, never silently translated between networks. */
  locations: string[];
  ageMin?: number;
  ageMax?: number;
  keywords?: string[];
  jobTitles?: string[];
  expansion: false;
}
export interface Material {
  /** Omitted only for legacy inspection/compatibility. */
  settings?: ProviderSettings;
  applicantGoal?: ApplicantGoal;
  name: string;
  headline: string;
  body: string;
  destination: string;
  searchHeadlines?: string[];
  searchDescriptions?: string[];
  destinationDigest: string;
  assetIds: string[];
  audience: Audience;
  budget: Money;
  advertisingBudget?: AdvertisingBudget;
  purpose?: MarketingPurpose;
  startAt: string;
  endAt: string;
  timezone: string;
}
export interface Campaign {
  id: string;
  projectId: string;
  revision: number;
  grantId: string;
  creativeSetId: string;
  /** Immutable local source attribution; never client-authored. */
  draftOrigin?: { draftId: string; revision: number; actorId: string; materialDigest: string; accountId: string };
  material: Material;
  state: "draft" | "paused" | "enabled" | "unknown";
  receipt: Receipt | null;
}
/** Local planning material. Missing/blank fields are not publication readiness. */
export type PartialSettings<T> = T extends (infer U)[] ? PartialSettings<U>[] : T extends object ? { [K in keyof T]?: PartialSettings<T[K]> } : T;
export type DraftMaterial = Omit<Partial<Material>, "name" | "audience" | "budget" | "settings"> & {
  settings?: PartialSettings<ProviderSettings>;
  name: string;
  audience?: Partial<Audience>;
  budget?: Partial<Money>;
};
/** Project-owned local document, never a provider campaign or an account grant. */
export interface CampaignDraft {
  id: string;
  projectId: string;
  revision: number;
  state: "draft";
  connection: "unconnected";
  grantId: null;
  receipt: null;
  material: DraftMaterial;
}
export interface Receipt {
  ids: Record<string, string>;
  payloadDigest: string;
  intent: "paused" | "enabled";
  delivery: "unverified" | "review_pending" | "delivering";
  providerRequestId: string | null;
  observedAt: string;
  evidence: "fixture" | "provider";
}
export interface Grant {
  id: string;
  projectId: string;
  revision: number;
  provider: Provider;
  accountId: string;
  label: string;
  currency: string;
  /** Provider reporting/budget zone. LinkedIn is UTC by policy, not an account field. */
  timezone: string;
  permissions: Permission[];
  expiresAt: string;
  revokedAt: string | null;
  secretRef: string;
  pageId?: string;
  instagramUserId?: string;
  /** Trusted account-scoped resolver/eligibility evidence, never browser authority. */
  targetingOptions?: TargetingOption[];
  capabilityEvidence?: AccountCapabilityEvidence[];
  /** Host-resolved display catalog for this account; labels confer no eligibility. */
  selectionOptions?: (import("./capabilities.js").ResolvedOption & {
    kind: "page" | "instagram" | "organization" | "pixel" | "conversion";
  })[];
  organizationId?: string;
}
export type PublicGrant = Omit<Grant, "secretRef">;
export interface Setup {
  id: string;
  projectId: string;
  revision: number;
  grantId: string;
  state: "requested" | "waiting_human" | "verifying" | "ready" | "blocked";
  reason: string | null;
  checkpoint: string;
  verifiedAt: string | null;
  capabilities: Permission[];
  accountId: string;
  handoffUrl: string | null;
}
export interface Packet {
  id: string;
  projectId: string;
  campaignId: string;
  campaignRevision: number;
  grantId: string;
  grantRevision: number;
  accountId: string;
  action: "activate";
  material: Material;
  assetDigests: string[];
  effectivePlan: unknown;
  receipt: Receipt;
  digest: string;
  createdAt: string;
  expiresAt: string;
}
export interface Decision {
  id: string;
  packetId: string;
  projectId: string;
  digest: string;
  actorId: string;
  decision: "approved" | "rejected";
  decidedAt: string;
  revokedAt: string | null;
}
export interface Operation {
  id: string;
  projectId: string;
  campaignId: string;
  kind: "prepare" | "activate" | "pause";
  packetId: string | null;
  payloadDigest: string;
  campaignRevision: number;
  grantRevision: number;
  accountId: string;
  state: "queued" | "running" | "succeeded" | "unknown" | "blocked";
  reason: string | null;
  receipt: Receipt | null;
  createdAt: string;
}
export interface GenerationGrant {
  id: string;
  projectId: string;
  provider: "openai" | "xai" | "fixture";
  model: string;
  kind: "image" | "video";
  maxJobs: number;
  usedJobs: number;
  maxSeconds: number;
  size: string;
  expiresAt: string;
  revokedAt: string | null;
  /** Enforced by host billing capability, independent from ad budget. */
  ceiling: Money;
  billingCapabilityRef: string;
}
export interface GenerationJob {
  id: string;
  projectId: string;
  campaignId: string;
  grantId: string;
  kind: "image" | "video";
  prompt: string;
  promptDigest: string;
  parentAssetIds: string[];
  rightsReceipt: string;
  state:
    | "queued"
    | "running"
    | "processing"
    | "retained"
    | "unknown"
    | "failed";
  providerRequestId: string | null;
  assetId: string | null;
  reason: string | null;
  createdAt: string;
}
export interface Asset {
  id: string;
  projectId: string;
  campaignId: string;
  version: number;
  kind: "image" | "video" | "storyboard";
  digest: string;
  mime: string;
  width: number | null;
  height: number | null;
  seconds: number | null;
  jobId: string | null;
  source: "fixture" | "generated" | "uploaded";
  rightsReceipt: string;
  parentAssetIds: string[];
}
/** Host-attested collector completeness; omitted purpose is legacy acquisition only. */
export interface FirstPartyCoverage {
  from: string;
  until: string;
  purpose?: MarketingPurpose;
}
export interface FirstPartyEvent {
  id: string;
  projectId: string;
  campaignId: string | null;
  kind: "click" | "form_completed" | "qualified" | "purchase" | "applicant_request_mou" | "application_completed" | "applicant_qualified" | "hired";
  /** Server-selected collector namespace; omission preserves the legacy namespace. */
  sourceId?: string;
  purpose?: MarketingPurpose;
  synthetic?: boolean;
  test?: boolean;
  productionMetricsExcluded?: boolean;
  personId: string;
  occurredAt: string;
  consentReceipt: string;
  /** Verified source completion/order/click receipt supplied by a trusted collector. */
  sourceReceipt: string;
  clickId: string | null;
  revenue: Money | null;
}
export interface Conversation {
  id: string;
  projectId: string;
  campaignId: string;
  leadEventId: string;
  consentReceipt: string;
  messages: { speaker: string; text: string; at: string }[];
}
export interface Metrics {
  id: string;
  projectId: string;
  campaignId: string;
  from: string;
  until: string;
  timezone: string;
  currency: string;
  observedAt: string;
  source: "fixture" | "provider";
  reportingBasis?: ReportingBasis;
  spendMinor: number | null;
  impressions: number | null;
  clicks: number | null;
  providerConversions: number | null;
}
export interface Metric {
  value: number | null;
  reason: string | null;
}
export interface Results {
  campaignId: string;
  timezone: string;
  currency: string;
  from: string;
  until: string;
  observedAt: string | null;
  stale: boolean;
  source: string;
  attribution: "last-paid-click-7d-v1";
  spendMinor: Metric;
  impressions: Metric;
  clicks: Metric;
  leads: Metric;
  /** Additive v2 basis; leads retains the historical unique-person contract. */
  completedSubmissions?: Metric;
  uniquePeople?: Metric;
  applicantRequests?: Metric;
  applicants?: Metric;
  purpose?: MarketingPurpose;
  applicantGoal?: ApplicantGoal;
  qualifiedApplicants?: Metric;
  hires?: Metric;
  excludedTestEvents?: Metric;
  leadBasis?: "trusted-source-submissions-v2;legacy-leads-unique-people-v1";
  reportingBasis?: ReportingBasis;
  qualified: Metric;
  customers: Metric;
  revenueMinor: Metric;
  ctr: Metric;
  mediaCacMinor: Metric;
  mediaRoas: Metric;
  providerConversions: Metric;
}
export interface Workspace {
  project: { id: string; name: string };
  role: Role;
  principalKind: "human" | "agent";
  grants: PublicGrant[];
  generationGrants: Omit<GenerationGrant, "billingCapabilityRef">[];
  campaigns: Campaign[];
  drafts: CampaignDraft[];
  /** This actor's saved planning results awaiting acknowledgment. */
  planningWrites?: PlanningWrite[];
  /** Opaque stale-scope check; conveys no authorization or session credential. */
  planningScope?: string;
  setups: Setup[];
  assets: Asset[];
  jobs: GenerationJob[];
  packets: Packet[];
  decisions: Decision[];
  operations: Operation[];
  mode: "fixture" | "live";
}
export type PlanningInput = { [K in "saveDraft" | "saveCampaign" | "promoteDraft"]:
  { command: K; input: Commands[K]["input"] } }["saveDraft" | "saveCampaign" | "promoteDraft"];
export interface PlanningWrite {
  id: string;
  actorId: string;
  command: PlanningInput["command"];
  result: Campaign | CampaignDraft;
  acknowledged: boolean;
}
export interface Commands extends ConnectionCommands {
  planningWrite: { input: PlanningInput & { requestKey: string; scope: string }; output: PlanningWrite };
  acknowledgePlanningWrite: { input: { id: string }; output: PlanningWrite };
  captureDestination: {
    input: { url: string };
    output: {
      digest: string;
      url: string;
      source: "fixture" | "public_https";
      observedAt: string;
    };
  };
  workspace: { input: Record<string, never>; output: Workspace };
  setup: { input: { grantId: string; requestKey: string }; output: Setup };
  resumeSetup: {
    input: { setupId: string; expectedRevision: number };
    output: Setup;
  };
  saveCampaign: {
    input: {
      requestKey?: string;
      id?: string;
      expectedRevision?: number;
      grantId: string;
      material: Material;
    };
    output: Campaign;
  };
  saveDraft: {
    input: {
      id?: string;
      expectedRevision?: number;
      requestKey: string;
      /** Replaces the complete local document at the expected revision. */
      material: DraftMaterial;
    };
    output: CampaignDraft;
  };
  promoteDraft: {
    input: { draftId: string; expectedRevision: number; grantId: string; expectedGrantRevision: number; material: Material };
    output: Campaign;
  };
  prepare: {
    input: { campaignId: string; requestKey: string };
    output: Operation;
  };
  packet: { input: { campaignId: string }; output: Packet };
  decide: {
    input: {
      packetId: string;
      digest: string;
      decision: "approved" | "rejected";
    };
    output: Decision;
  };
  revoke: { input: { decisionId: string }; output: Decision };
  execute: {
    input: { packetId: string; digest: string; requestKey: string };
    output: Operation;
  };
  pause: {
    input: { campaignId: string; requestKey: string };
    output: Operation;
  };
  reconcile: { input: { operationId: string }; output: Operation };
  generate: {
    input: {
      campaignId: string;
      grantId: string;
      prompt: string;
      rightsReceipt: string;
      parentAssetIds: string[];
      requestKey: string;
    };
    output: GenerationJob;
  };
  reconcileGeneration: { input: { jobId: string }; output: GenerationJob };
  storyboard: { input: { campaignId: string; text: string }; output: Asset };
  event: {
    input: Omit<FirstPartyEvent, "projectId" | "campaignId"> & {
      campaignId?: string;
    };
    output: FirstPartyEvent;
  };
  conversation: {
    input: Omit<Conversation, "projectId">;
    output: Conversation;
  };
  conversations: { input: { campaignId: string }; output: Conversation[] };
  results: {
    input: { campaignId: string; from: string; until: string };
    output: Results;
  };
  syncMetrics: {
    input: { campaignId: string; from: string; until: string };
    output: Metrics;
  };
}
export type Command = keyof Commands;
export interface MarketingClient {
  call<K extends Command>(
    command: K,
    input: Commands[K]["input"],
    options?: { signal?: AbortSignal },
  ): Promise<Commands[K]["output"]>;
  assetUrl(id: string): string;
}
export function createMarketingClient(
  baseUrl: string,
  projectId: string,
  fetcher: typeof fetch = fetch,
): MarketingClient {
  const root = `${baseUrl.replace(/\/$/, "")}/api/projects/${encodeURIComponent(projectId)}`;
  return {
    async call(command, input, options) {
      const response = await fetcher(`${root}/${command}`, {
        method: "POST",
        signal: options?.signal,
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Request failed");
      return body;
    },
    assetUrl: (id) => `${root}/assets/${encodeURIComponent(id)}`,
  };
}
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .filter((k) => object[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonical(object[k])}`)
    .join(",")}}`;
}
