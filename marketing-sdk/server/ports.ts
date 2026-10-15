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
export interface ExistingCampaignInspection {
  candidateReceipt: Receipt;
  /** Provider image identity/owner/status do not verify original upload bytes. */
  originalMediaContentVerified: false;
  executionReady: false;
  missingReasons: ["original_media_content_binding_unverified", "execution_ownership_not_transferred"];
}
export interface ExistingMetaImageInspection {
  image: {accountId:string; hash:string; name:string; width:number; height:number; status:string; updatedAt:string|null};
  providerSnapshotDigest:string;
  observedAt:string;
  originalUploadBytesVerified:false;
  providerImageReadbackVerified:true;
  executionTransferred:false;
  spendingAuthorityGranted:false;
}
export interface ExistingMetaHierarchyInspection {
  provider:'meta'; source:'provider_api';
  snapshot:{account:{id:string;currency:string;timezone:string};
    campaign:{id:string;accountId:string;status:string;effectiveStatus:string};
    adsets:{id:string;accountId:string;campaignId:string;status:string;effectiveStatus:string}[];
    ads:{id:string;accountId:string;campaignId:string;adsetId:string;creativeId:string;status:string;effectiveStatus:string}[]};
  digest:string; observedAt:string; inventoryComplete:true; allPaused:true;
  scope:'exact_campaign_and_complete_children'; historicalEffectsSettled:false;
  materialVerified:false; executionTransferred:false; spendingAuthorityGranted:false;
}
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
  validateUpdate?(campaign: Campaign, grant: Grant, assets: Asset[]): void;
  /** Update stopped existing objects. Absence never permits recreating them. */
  update?(
    campaign: Campaign, grant: Grant, assets: Asset[],
    retain: (ids: Record<string, string>) => void | Promise<void>,
    beforeWrite: () => void | Promise<void>,
    beforeRead?: () => void | Promise<void>,
  ): Promise<Receipt>;
  /** Read existing provider identities against exact material. Does not create
   * objects, transfer execution ownership, or issue approval/spending authority. */
  inspectExistingCampaign?(
    campaign: Campaign, grant: Grant, assets: Asset[], providerIds: Record<string, string>,
    guard: () => Promise<void>,
  ): Promise<ExistingCampaignInspection>;
  inspectExistingMetaImage?(grant:Grant, imageId:string, guard:()=>Promise<void>):Promise<ExistingMetaImageInspection>;
  inspectExistingMetaHierarchy?(grant:Grant, ids:{campaign:string;adset:string;ad:string;creative:string}, guard:()=>Promise<void>):Promise<ExistingMetaHierarchyInspection>;
  prepare(
    campaign: Campaign,
    grant: Grant,
    assets: Asset[],
    key: string,
    retain: (ids: Record<string, string>) => void | Promise<void>,
    beforeWrite: () => void | Promise<void>,
    /** Current actor/grant/material/lease authority for discovery reads. This
     * never authorizes a write or replaces beforeWrite after discovery. */
    beforeRead?: () => void | Promise<void>,
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
