import type { Grant } from '../core/index.js';
import type { DiscoveredAccount, DiscoveredIdentity } from './connection-discovery.js';
import type { SessionAuthority, SessionInspection } from './session-authority.js';
import type { Principal, Store } from './store.js';

/** Private, current access evidence from the existing credential/authority owner.
 * Never accept this structure from an HTTP client or treat it as approval. */
export interface CampaignAccessSnapshot {
  digest: string;
  sessions: SessionInspection[];
  expiresAt: number;
  /** Deadline of the exact usable credential envelope, not an invented provider
   * token expiry. The host must bind its custody revision into digest. */
  credentialExpiresAt: number;
  account: DiscoveredAccount | null;
  identities: DiscoveredIdentity[];
  receiptReferences: string[];
}

/** Host-owned connections can qualify preparation without copying credentials or
 * creating SDK OAuth records. Existing grant permissions, material approval,
 * provider checks, tracking and budgets remain separately required.
 *
 * Inspect current local state only. Credential refresh/discovery must finish
 * before these calls. observedCredentialExpiry pins a prior envelope deadline;
 * it is not permission to extend that envelope or skip custody revision checks.
 * withCampaignAuthority holds the host session/configuration/revocation guard
 * through local()'s commit. Recheck before and after; never hold over provider
 * HTTP. Native credential use must independently enforce the same authority.
 */
export interface CampaignAccess {
  readonly store: Store;
  readonly sessionAuthority: SessionAuthority;
  campaignAuthority(principal: Principal, grant: Grant, observedCredentialExpiry?: number): Promise<CampaignAccessSnapshot>;
  withCampaignAuthority<T>(principal: Principal, grant: Grant, expected: CampaignAccessSnapshot, local: () => Promise<T>): Promise<T>;
}
