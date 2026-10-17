import type { Campaign, Operation, Grant, Packet } from "../core/index.js";
import type { Principal } from "./store.js";

export type ExecutionAction = Operation["kind"] | "reconcile" | "read" | "revise_material";
/** A trusted host action may have revocation-based authority without a browser
 * session. This port never issues a session, grant, approval or spending right.
 * Host guards must precede SDK transactions and remain held through their local
 * commit. Never hold a host SQL transaction over provider I/O. */
export interface ExecutionAuthority {
  /** Optional current stop/read custody for an invocation-bound grant. Must
   * compare the exact host invocation, campaign, principal and grant identity;
   * throw after termination/revocation. This does not renew timestamp grants. */
  /** Optional host-owned launch authorization. The host must verify an exact
   * current owner approval or owner-delegated native action for this packet,
   * including unchanged spending terms. A configured port is authoritative:
   * refusal never falls back to an SDK human decision. It is rechecked before
   * every effect and never accepts credentials or approval claims from JSON. */
  activationApproval?(principal: Principal, campaign: Campaign, packet: Packet): Promise<HostActivationApproval>;
  assertInvocationGrant?(grant: Grant): Promise<void>;
  /** Explicit current launch custody for invocation grants. Must verify current
   * host launch policy and exact campaign/material; packet approval and budget
   * checks still apply independently. Generic stop/read custody is insufficient. */
  assertInvocationActivationGrant?(grant: Grant): Promise<void>;
  assertCurrent(principal: Principal, campaign: Campaign, action: ExecutionAction): Promise<void>;
  withCurrent<T>(principal: Principal, campaign: Campaign, action: ExecutionAction, local: () => Promise<T>): Promise<T>;
}

/** Existing host authority, not an SDK human decision or a new spending grant. */
export interface HostActivationApproval {
  authorityId: string;
  revision: string;
  receiptReferences: string[];
}
