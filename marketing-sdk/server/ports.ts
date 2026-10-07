import type {
  Asset,
  Campaign,
  GenerationGrant,
  GenerationJob,
  Grant,
  Metrics,
  Permission,
  Receipt,
  Setup,
} from "../core/index.js";

/** The host owns execution. No scheduler is started by importing the SDK. */
export interface ProviderPort {
  readonly evidence: "fixture" | "provider";
  verify(
    grant: Grant,
    campaign?: Campaign,
    assets?: Asset[],
    intent?: Permission,
  ): Promise<{
    accountId: string;
    currency: string;
    timezone: string;
    timezoneSource?: "provider_account" | "provider_reporting_and_budget_policy";
    permissions: Permission[];
  }>;
  plan(campaign: Campaign, grant: Grant, assets: Asset[]): unknown;
  prepare(
    campaign: Campaign,
    grant: Grant,
    assets: Asset[],
    key: string,
    retain: (ids: Record<string, string>) => void | Promise<void>,
    beforeWrite: () => void | Promise<void>,
  ): Promise<Receipt>;
  activate(
    campaign: Campaign,
    grant: Grant,
    beforeWrite: () => void | Promise<void>,
  ): Promise<Receipt>;
  pause(
    campaign: Campaign,
    grant: Grant,
    beforeWrite: () => void | Promise<void>,
  ): Promise<Receipt>;
  reconcile(
    campaign: Campaign,
    grant: Grant,
    operation: {
      id: string;
      kind: string;
      payloadDigest: string;
      receipt: Receipt | null;
    },
  ): Promise<Receipt | null>;
  metrics(
    campaign: Campaign,
    grant: Grant,
    from: string,
    until: string,
  ): Promise<Omit<Metrics, "id" | "projectId" | "campaignId">>;
}
export interface GenerationOutput {
  requestId: string | null;
  state: "processing" | "failed" | "unknown" | "retained";
  bytes?: Uint8Array;
  mime?: string;
  width?: number;
  height?: number;
  seconds?: number;
}
export interface GenerationPort {
  readonly evidence: "fixture" | "generated";
  /** Validate dimensions/model/billing capability before reserving or submitting a paid job. */
  validate(grant: GenerationGrant): void;
  submit(
    job: GenerationJob,
    grant: GenerationGrant,
    retainRequestId: (requestId: string) => void | Promise<void>,
    beforeWrite?: () => Promise<void>,
  ): Promise<GenerationOutput>;
  reconcile(
    job: GenerationJob,
    grant: GenerationGrant,
  ): Promise<GenerationOutput>;
}
/** Replace with the released Agent SDK only when its implementation exists.
 * Host browser and vault capabilities remain server-only. No arbitrary URL,
 * shell, DOM, credential value, claimed role or human approval is an agent tool.
 */
export interface AgentPort {
  inspect(
    setup: Setup,
    grant: Grant,
  ): Promise<{
    state: "ready" | "waiting_human" | "blocked";
    reason: string | null;
    handoffUrl: string | null;
  }>;
}
export interface BillingPort {
  /** Harmless local metadata only: no provider call, reservation or spend authority. */
  inspect?(grant: GenerationGrant): Promise<{ state: "configured" | "unavailable"; currency?: string; maxUnitMinor?: number; expiresAt?: string }>;
  /** Existing, externally enforced generation authority; never inferred from ads authority. */
  authorize(grant: GenerationGrant, job: GenerationJob): Promise<void>;
}
