import type { Campaign, Operation } from "../core/index.js";
import type { Principal } from "./store.js";

export type ExecutionAction = Operation["kind"] | "reconcile" | "read";
/** A trusted host action may have revocation-based authority without a browser
 * session. This port never issues a session, grant, approval or spending right.
 * Host guards must precede SDK transactions and remain held through their local
 * commit. Never hold a host SQL transaction over provider I/O. */
export interface ExecutionAuthority {
  assertCurrent(principal: Principal, campaign: Campaign, action: ExecutionAction): Promise<void>;
  withCurrent<T>(principal: Principal, campaign: Campaign, action: ExecutionAction, local: () => Promise<T>): Promise<T>;
}
