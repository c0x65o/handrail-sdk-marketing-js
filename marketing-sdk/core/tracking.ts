import type { FirstPartyEvent, MarketingPurpose } from './index.js';

export const TRACKING_OUTCOMES = {
  inquiry: { label: 'Completed inquiry submission', purpose: 'acquisition', kind: 'form_completed' },
  qualified: { label: 'Qualified customer inquiry', purpose: 'acquisition', kind: 'qualified' },
  purchase: { label: 'Completed purchase', purpose: 'acquisition', kind: 'purchase' },
  mou: { label: 'Completed MOU request', purpose: 'recruitment', kind: 'applicant_request_mou' },
  application: { label: 'Completed application', purpose: 'recruitment', kind: 'application_completed' },
  applicant_qualified: { label: 'Qualified applicant', purpose: 'recruitment', kind: 'applicant_qualified' },
  hire: { label: 'Confirmed hire', purpose: 'recruitment', kind: 'hired' },
} as const satisfies Record<string, { label: string; purpose: MarketingPurpose; kind: FirstPartyEvent['kind'] }>;
export type TrackingOutcome = keyof typeof TRACKING_OUTCOMES;
export interface TrackingOwner { kind: 'draft' | 'campaign'; id: string }
export interface TrackingSource {
  id: string; projectId: string; revision: string; label: string; domain: string;
  environment: 'test' | 'production'; active: boolean;
  collector: 'available' | 'missing' | 'unavailable'; reason: string | null;
  outcomes: TrackingOutcome[];
  destinations: { id: string; label: string; url: string; testUrl: string | null }[];
  instructions: string[];
}
export interface TrackingBinding {
  id: string; projectId: string; revision: number; owner: TrackingOwner; ownerRevision: number;
  materialDigest: string; accountDigest: string | null; source: TrackingSource; destinationId: string; destination: string;
  outcome: TrackingOutcome; purpose: MarketingPurpose;
  providerMapping: { provider: string; accountId: string; event: string; configuration: string } | null;
  refundTreatment: 'gross_before_refunds' | null; createdAt: string;
  /** Configuration lineage only. Draft QA is not campaign test authority. */
  promotedFrom?: { owner: TrackingOwner; bindingId: string; bindingRevision: number; ownerRevision: number };
}
export interface TrackingDiagnostic {
  id: string; testId: string; eventRef: string; occurredAt: string; receivedAt: string;
  consentBasis: string; qaExcluded: true; eligibleAtReceipt: boolean;
  localReceipt: 'accepted'; providerDelivery: 'unavailable'; matching: 'unavailable';
  attribution: { campaignId: string | null; rule: 'last-paid-click-7d-v1'; source: 'first-party'; windowDays: 7 };
}
export interface TrackingTest {
  id: string; revision: number; bindingId: string; bindingRevision: number;
  createdAt: string; expiresAt: string; cancelledAt: string | null;
  observedAt: string | null; destinationUrl: string;
}
export interface TrackingView {
  owner: TrackingOwner; ownerRevision: number; purpose: MarketingPurpose; destination: string | null;
  sources: TrackingSource[]; binding: TrackingBinding | null; tests: TrackingTest[];
  diagnostics: TrackingDiagnostic[]; readiness: 'missing_integration' | 'not_tested' | 'pending' | 'passed' | 'stale' | 'cancelled' | 'expired';
  reason: string; canEdit: boolean;
}
export interface TrackingCommands {
  tracking: { input: { owner: TrackingOwner }; output: TrackingView };
  bindTracking: { input: { owner: TrackingOwner; expectedRevision: number; expectedBindingRevision: number; sourceId: string; sourceRevision: string; destinationId: string; outcome: TrackingOutcome; refundTreatment: 'gross_before_refunds' | null; requestKey: string }; output: TrackingBinding };
  startTrackingTest: { input: { owner: TrackingOwner; expectedBindingRevision: number; requestKey: string }; output: TrackingTest };
  /** Records a user's unverified observation only; never authenticated completion. */
  observeTrackingTest: { input: { owner: TrackingOwner; testId: string }; output: TrackingTest };
  cancelTrackingTest: { input: { owner: TrackingOwner; testId: string }; output: TrackingTest };
}
