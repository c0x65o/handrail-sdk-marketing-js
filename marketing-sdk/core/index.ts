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
  material: Material;
  state: "draft" | "paused" | "enabled" | "unknown";
  receipt: Receipt | null;
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
  timezone: string;
  permissions: Permission[];
  expiresAt: string;
  revokedAt: string | null;
  secretRef: string;
  pageId?: string;
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
export interface FirstPartyEvent {
  id: string;
  projectId: string;
  campaignId: string | null;
  kind: "click" | "form_completed" | "qualified" | "purchase";
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
  setups: Setup[];
  assets: Asset[];
  jobs: GenerationJob[];
  packets: Packet[];
  decisions: Decision[];
  operations: Operation[];
  mode: "fixture" | "live";
}
export interface Commands {
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
      id?: string;
      expectedRevision?: number;
      grantId: string;
      material: Material;
    };
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
    async call(command, input) {
      const response = await fetcher(`${root}/${command}`, {
        method: "POST",
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
