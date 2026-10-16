import type { Grant } from "../core/index.js";
import { requireThat } from "./store.js";

/** Unknown provider lifetime is not a fabricated local deadline. Only a trusted
 * host may bind stop/read or separately authorized launch access to its actual running invocation. No SDK
 * reference host, UI or saved grant can infer that invocation is still alive. */
export async function assertCurrentGrant(grant: Grant, now: number,
  authority?: { assertInvocationGrant?(grant: Grant): Promise<void>; assertInvocationActivationGrant?(grant: Grant): Promise<void> }) {
  requireThat(!grant.revokedAt, "grant_expired_or_revoked");
  if (grant.lifetime !== undefined) {
    requireThat(grant.expiresAt === null && grant.lifetime.kind === "invocation" &&
      Object.keys(grant.lifetime).every(k => ["kind", "invocationRef"].includes(k)) &&
      typeof grant.lifetime.invocationRef === "string" && grant.lifetime.invocationRef.length > 0 &&
      grant.lifetime.invocationRef.length <= 500 && typeof grant.campaignId === "string" && grant.campaignId.length > 0 &&
      grant.permissions.length > 0 && new Set(grant.permissions).size === grant.permissions.length &&
      grant.permissions.every(p => p === "pause" || p === "report" || p === "activate" && !!authority?.assertInvocationActivationGrant), "invalid_invocation_grant", 403);
    if (grant.permissions.includes("activate")) await authority!.assertInvocationActivationGrant!(grant);
    else {
      requireThat(authority?.assertInvocationGrant, "invocation_grant_authority_required", 403);
      await authority.assertInvocationGrant(grant);
    }
    return;
  }
  requireThat(typeof grant.expiresAt === "string" && Date.parse(grant.expiresAt ?? "") > now, "grant_expired_or_revoked");
}
