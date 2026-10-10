import type { BusinessBrief, PlanningRequest, PlanningUsage } from './studio.js';

/** Safe metadata. Neither this selection nor an identifier grants credential use. */
export interface TextPlanningConnection {
  id: string; label: string; provider: 'openai' | 'xai'; model: string;
  environment: string; revision: string; permissionRevision: string;
  credentialRevision: string; configurationRevision: string; expiresAt: string;
  state: 'available' | 'unavailable'; reason: string;
}
export interface TextPlanningQuote {
  receipt: string; operationId: string; requestDigest: string; connectionDigest: string;
  projectId: string; environment: string; provider: 'openai' | 'xai'; model: string;
  pricingRevision: string; currency: string; ceilingMinor: number; expiresAt: string;
  inputTokenUpperBound: number; meteringBasis: string; maxOutputTokens: number;
  maxAttempts: 1;
}
export interface TextPlanningReview {
  id: string; draftId: string; draftRevision: number; brief: BusinessBrief;
  connection: TextPlanningConnection; requestDigest: string; reviewDigest: string;
  prompt: string; schemaDigest: string; requestBytes: number;
  requestBody: unknown;
  quote: TextPlanningQuote; evidence: 'synthetic' | 'provider';
  state: 'review' | 'accepted' | 'cancelled';
}
export interface TextPlanningReceipt {
  evidence: 'synthetic' | 'provider'; reviewId: string; reviewDigest: string;
  attemptId: string | null; dispatchedAt: string | null;
  diagnosticRequestId: string | null;
  settlement: 'reserved' | 'unknown' | 'settled';
  settledMinor: number | null; currency: string;
}
export interface TextPlanningCommands {
  textPlanningConnections: { input: Record<string, never>; output: { connections: TextPlanningConnection[]; setup?: { provider:'openai'|'xai'; path:string; configured:boolean }[]; reason: string } };
  reviewTextPlan: { input: { draftId: string; expectedRevision: number; connectionId: string; maxOutputTokens: number; requestKey: string }; output: TextPlanningReview };
  approveTextPlan: { input: { reviewId: string; reviewDigest: string; requestKey: string }; output: PlanningRequest };
  cancelTextPlan: { input: { reviewId: string; reviewDigest: string }; output: TextPlanningReview };
}
/** Measured billing fact, never an estimate. All identity fields are required. */
export interface TextPlanningSettlement {
  requestId: string; attemptId: string; requestDigest: string; quoteReceipt: string;
  connectionDigest: string; projectId: string; environment: string;
  pricingRevision: string; currency: string; measuredMinor: number;
  usage: PlanningUsage; receipt: string;
}
