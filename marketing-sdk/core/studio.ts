import type { TextPlanningCommands as importTextPlanningCommands, TextPlanningReceipt, TextPlanningReview } from './text-planning.js';
import type { CampaignDraft, DraftMaterial, MarketingPurpose, Provider } from './index.js';
export const STUDIO_STEPS = ['brief', 'options', 'media', 'checks', 'tracking'] as const;
export type StudioStep = typeof STUDIO_STEPS[number];
export interface BusinessBrief {
  name: string; offer: string; audience: string; outcome: MarketingPurpose;
  destination: string | null; facts: string[]; constraints: string; direction: string;
}
export interface CopyVariant { headline: string; body: string; cta: string }
export interface CampaignOption {
  title: string; audienceHypothesis: string; offer: string; rationale: string;
  unknowns: string[]; provider: Provider; format: 'single_image' | 'search_text';
  destination: string | null; variants: CopyVariant[];
}
export interface StudioOption {
  id: string; revision: number; briefDigest: string; value: CampaignOption;
  provenance: { kind: 'manual' } | { kind: 'planning'; requestId: string; optionIndex: number; edited?: true };
}
export type CreativeOwner = { kind: 'draft'; draftId: string } | { kind: 'campaign'; campaignId: string };
export interface StudioAsset {
  id: string; projectId: string; version: 2; owner: CreativeOwner; creativeSetId: string;
  kind: 'image' | 'video'; source: 'imported' | 'generated' | 'fixture';
  digest: string; originalDigest: string; mime: string; width: number; height: number; seconds: number | null; bytes: number;
  rights: { declaration: string; actorId: string; at: string; verified: false };
  sourceAssetId: string | null; jobId: string | null;
}
export interface StudioState {
  brief: BusinessBrief; briefDigest: string; creativeSetId: string;
  options: StudioOption[]; selection: { optionId: string; revision: number; variant: number } | null;
  assetIds: string[]; lifecycle: 'active' | 'archived' | 'trash'; step: StudioStep;
  updatedAt: string; source: { id: string; revision: number } | null;
}
export type StudioDraft = CampaignDraft & { studio: StudioState };
export interface StudioCheck {
  step: StudioStep; code: string; state: 'pass' | 'blocked' | 'unknown';
  kind: 'technical' | 'editorial' | 'provider'; message: string;
}
export interface TrackingHandoff {
  projectId: string; draftId: string; revision: number; materialDigest: string;
  destination: string | null; destinationDigest: string | null; outcome: MarketingPurpose;
  testStatus?: import('./tracking.js').TrackingView;
  status: 'missing_integration' | 'not_tested' | 'passed' | 'pending' | 'stale' | 'cancelled' | 'expired'; receipt: TrackingReceipt | null;
}
export interface TrackingReceipt {
  testSessionId: string; bindingRevision: string; sourceId: string; eventRef: string;
  occurredAt: string; receivedAt: string; qaExcluded: boolean; consentBasis: string;
  stages: Record<'websiteObserved' | 'localReceived' | 'providerAccepted' | 'matched' | 'attributed',
    { state: 'unknown' | 'pending' | 'verified' | 'failed'; source: string; observedAt: string; expiresAt: string; reason: string | null }>;
}
export interface StudioReport {
  id: string; draftId: string; revision: number; inputDigest: string; createdAt: string;
  inputs: { material: DraftMaterial; briefDigest:string; selection:StudioState['selection']; assets:StudioAsset[]; account:import('./index.js').PublicGrant|null; destinationEvidence:{url:string;digest:string;source:string;observedAt:string}|null; capabilities:string; evaluatedAt:string; tracking:import('./tracking.js').TrackingView|null };
  checks: StudioCheck[]; tracking: TrackingHandoff; providerApproval: 'not_requested';
}
export interface PlanningUsage {
  inputTokens: number | null; outputTokens: number | null;
  cost: { value: string; unit: string; currency: string } | null;
  unavailableReason: string | null;
}
export interface PlanningAuthority {
  id: string; revision: number; projectId: string; actorId: string; sessionDigest: string;
  provider: 'openai' | 'xai'; model: string; purpose: 'campaign_planning';
  inputDigest: string; maxInputTokens: number; maxOutputTokens: number; maxAttempts: 1;
  maxCost: { value: string; unit: string; currency: string }; quoteRef: string;
  expiresAt: string; revokedAt: string | null; custodyRef: string; billingCapabilityRef: string;
  evidence: 'fixture';
}
export interface PlanningRequest {
  textReceipt?: TextPlanningReceipt;
  id: string; projectId: string; draftId: string; draftRevision: number; briefDigest: string;
  inputDigest: string; brief: BusinessBrief; model: string; provider: 'openai' | 'xai';
  promptVersion: string; schemaVersion: string; authorityId: string; authorityDigest: string;
  state: 'queued' | 'running' | 'unknown' | 'succeeded' | 'failed';
  providerResponseId: string | null; options: CampaignOption[]; reason: string | null;
  usage: PlanningUsage; outputDigest: string | null; createdAt: string;
}
export type DraftGenerationJob = Omit<import('./index.js').GenerationJob, 'campaignId'> & {
  version: 2; owner: {kind:'draft';draftId:string}; creativeSetId:string;
  draftRevision:number; sessionDigest:string; grantDigest:string;
  quote: { receipt:string; expiresAt:string; currency:string; maxUnitMinor:number };
};
export interface StudioView {
  draft: StudioDraft; assets: StudioAsset[]; jobs: DraftGenerationJob[]; generationAvailable: boolean; plans: PlanningRequest[]; reports: StudioReport[];
  generationQuotes: {grantId:string;kind:'image'|'video';model:string;quote:DraftGenerationJob['quote']|null}[];
  planning: { state: 'unavailable' | 'fixture' | 'interactive'; reason: string };
  textReviews?: TextPlanningReview[];
}
export interface LibraryItem {
  id: string; kind: 'draft' | 'campaign'; name: string; revision: number;
  lifecycle: 'active' | 'archived' | 'trash'; updatedAt: string; nextStep: string; providerState: string | null;
}
export interface StudioCommands extends importTextPlanningCommands {
  studioImportStatus:{input:{requestKey:string};output:{asset:StudioAsset|null}};
  reviewStudioDeletion: { input:{draftId:string;expectedRevision:number};output:{draftId:string;revision:number;eligible:false;reason:string;retained:{assets:number;revisions:number;planningRequests:number;mediaJobs:number};confirmationPolicy:string;recovery:'restore';providerDeletion:'unavailable'} };
  generateDraftMedia: { input: { draftId:string;expectedRevision:number;requestKey:string;grantId:string;prompt:string;rightsReceipt:string;quoteReceipt:string }; output:DraftGenerationJob };
  reconcileDraftMedia: { input:{jobId:string};output:DraftGenerationJob };
  promoteStudio: { input: { draftId: string; expectedRevision: number; grantId: string; expectedGrantRevision: number; requestKey: string }; output: import("./index.js").Campaign };
  studio: { input: { draftId: string }; output: StudioView };
  saveBrief: { input: { id?: string; expectedRevision?: number; requestKey: string; brief: BusinessBrief }; output: StudioDraft };
  saveStudioMaterial: { input: { draftId: string; expectedRevision: number; requestKey: string; material: DraftMaterial; step: StudioStep }; output: StudioDraft };
  saveCampaignOption: { input: { draftId: string; expectedRevision: number; requestKey: string; optionId?: string; value: CampaignOption }; output: StudioDraft };
  selectCampaignOption: { input: { draftId: string; expectedRevision: number; requestKey: string; optionId: string; optionRevision: number; variant: number }; output: StudioDraft };
  selectStudioMedia: { input: { draftId: string; expectedRevision: number; requestKey: string; assetIds: string[] }; output: StudioDraft };
  listCampaigns: { input: { query?: string; kind?: 'draft' | 'campaign'; lifecycle?: 'active' | 'archived' | 'trash'; cursor?: string; limit?: number }; output: { items: LibraryItem[]; nextCursor: string | null } };
  copyToDraft: { input: { id: string; kind: 'draft' | 'campaign'; expectedRevision: number; requestKey: string }; output: StudioDraft };
  setCampaignLifecycle: { input: { id: string; kind: 'draft' | 'campaign'; expectedRevision: number; requestKey: string; lifecycle: 'active' | 'archived' | 'trash' }; output: LibraryItem };
  checkStudio: { input: { draftId: string; expectedRevision: number; grantId?: string }; output: StudioReport };
  requestPlan: { input: { draftId: string; expectedRevision: number; authorityId: string; requestKey: string }; output: PlanningRequest };
  planningRequest: { input: { requestId: string }; output: PlanningRequest };
  reconcilePlanning: { input: { requestId: string }; output: PlanningRequest };
  applyPlanningOption: { input: { draftId: string; expectedRevision: number; requestKey: string; requestId: string; optionIndex: number }; output: StudioDraft };
}
export const emptyBrief = (): BusinessBrief => ({ name: 'Untitled campaign', offer: '', audience: '', outcome: 'acquisition', destination: null, facts: [], constraints: '', direction: '' });
