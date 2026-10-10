import type { CreativeConnectionStatus } from "./creative-connections.js";
import type { Permission, Provider, PublicGrant, Setup } from "./index.js";

/** Browser-safe connection contracts. A Connection is never a provisional Grant. */
export type ConnectionProvider =
  | { kind: "advertising"; provider: Provider }
  | { kind: "creative"; provider: "openai" | "xai" };
export type ConnectionIntent =
  | { kind: "advertising"; operations: Permission[] }
  | { kind: "creative"; operation: "image" | "video" };
export type ConnectionPhase = "requirements" | "reviewing_provider_access" | "waiting_human"
  | "discovering" | "choosing_account" | "choosing_identity" | "reviewing_access"
  | "verifying" | "verified" | "failed_retryable" | "blocked" | "outcome_unknown"
  | "reconciling" | "needs_reauthorization" | "cancelling" | "cancelled";
export interface SafeEvidence {
  status: "not_checked" | "pending" | "verified" | "failed" | "expired" | "revoked" | "unavailable";
  basis: "configuration" | "human_decision" | "provider" | "fixture";
  observedAt: string | null; expiresAt: string | null; receiptRef: string | null; reason: string | null;
}
export type ConnectionAction = "review_provider" | "handoff" | "discover" | "identities"
  | "review_access" | "verify" | "reconcile" | "cancel" | "reconnect" | "requirements" | "revoke";
export interface NextAction {
  action: ConnectionAction; label: string; actor: "human" | "host_admin" | "sdk" | "provider" | "optional_agent";
  available: boolean; reason: string | null;
}
export interface AccountChoice {
  choiceRef: string; label: string; businessLabel: string | null; accountSuffix: string; displayId?: string;
  currency: string; timezone: string;
  timezoneSource: "provider_account" | "provider_reporting_and_budget_policy";
  roleSummary: string; limitations: string[];
}
export interface IdentityChoice {
  choiceRef: string; kind: "meta_page" | "instagram" | "linkedin_organization" | "google_manager";
  label: string; accountSuffix: string; displayId?: string;
}
export interface ConnectionAccessReview {
  decisionRef: string; digest: string; expiresAt: string;
  purpose: "provider_authorization" | "project_binding" | "revoke_project_access";
  providerAppLabel?: string; discoveryExpiresAt?: string;
  summary: string; oauthScopes: string[]; providerAccountRange: string; offlineAccess: boolean;
  providerLifetime: string; projectAccessExpiresAt: string | null;
}
export interface ConnectionView {
  id: string; projectId: string; revision: number; provider: ConnectionProvider; intent: ConnectionIntent;
  phase: ConnectionPhase; account: AccountChoice | null; identities: IdentityChoice[];
  accessReview: ConnectionAccessReview | null; grantId: string | null;
  checkpoint: string; currentActor: NextAction["actor"]; requested: boolean;
  configured: SafeEvidence; providerAuthorized: SafeEvidence; consented: SafeEvidence;
  accountVerified: SafeEvidence; capabilityVerified: SafeEvidence;
  readiness: { action: string; materialDigest: string | null; ready: boolean; blockers: string[]; evidence: SafeEvidence[] }[];
  actions: NextAction[]; updatedAt: string;
  discovery: { accounts: AccountChoice[]; identities: IdentityChoice[]; cursor: string | null;
    complete: boolean; expiresAt: string | null };
  handoffPath: string | null;
  handoff?: ConnectionHandoffDescriptor | null;
}
/** Non-authorizing navigation/wake hint. Resume requires the original current session. */
export interface ConnectionHandoffDescriptor {
  version: 1; correlator: string; browserStartUrl: string; expiresAt: string; returnRouteId: "marketing";
}
export interface ConnectionRequirement { code: string; explanation: string; actor: "human" | "host_admin"; }
export interface ConnectionCatalogue {
  project: { id: string; name: string }; canStart: boolean; canApprove: boolean;
  evidence: "fixture" | "provider"; assistance: { available: false; reason: string };
  providers: { provider: ConnectionProvider; label: string; description: string; limitations: string[];
    requirements: ConnectionRequirement[]; configured: boolean; callbackUri: string | null;
    secureSetupPath?: string; creativeBindings?: CreativeConnectionStatus[] }[];
  connections: ConnectionView[];
  historical: { grant: PublicGrant; setup: Setup | null }[];
}
export interface ConnectionTransition { connectionId: string; expectedRevision: number; requestKey: string; }
type Transition = { input: ConnectionTransition; output: ConnectionView };
type DecisionInput = ConnectionTransition & { decisionRef: string; digest: string; decision: "approved" | "rejected" };
export interface ConnectionCommands {
  connections: { input: Record<string, never>; output: ConnectionCatalogue };
  connection: { input: { connectionId?: string; startRequestKey?: string }; output: ConnectionView };
  startConnection: { input: { provider: ConnectionProvider; intent: ConnectionIntent; requestKey: string;
    expiresAt: string; offlineAccess: boolean }; output: ConnectionView };
  reviewConnectionProviderAccess: Transition;
  decideConnectionProviderAccess: { input: DecisionInput; output: ConnectionView };
  beginConnectionHandoff: Transition;
  discoverConnectionAccounts: { input: ConnectionTransition & { cursor?: string }; output: ConnectionView };
  selectConnectionAccount: { input: ConnectionTransition & { choiceRef: string }; output: ConnectionView };
  connectionIdentities: { input: ConnectionTransition & { cursor?: string }; output: ConnectionView };
  selectConnectionIdentity: { input: ConnectionTransition & { choiceRefs: string[] }; output: ConnectionView };
  reviewConnectionAccess: Transition;
  decideConnectionAccess: { input: DecisionInput; output: ConnectionView };
  resumeConnection: Transition;
  reconcileConnection: Transition;
  cancelConnection: Transition;
  reassignConnection: Transition;
  reviewConnectionRevocation: Transition;
  decideConnectionRevocation: { input: DecisionInput; output: ConnectionView };
}
