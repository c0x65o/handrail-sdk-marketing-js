import type { Role } from "../core/index.js";
import { Store, type Principal, digest, requireThat } from "./store.js";

/** Trusted server values only. A session reference is neither a cookie nor a bearer credential. */
export interface SessionBinding {
  issuer: string; subject: string; userId: string; sessionRef: string;
}
export interface SessionInspection {
  binding: SessionBinding; projectId: string; role: Role; kind: "human" | "agent";
  expiresAt: number;
  /** Changes with user/session/project rights or host authorization configuration. */
  revision: string;
}
/** Host revocation guard -> SDK Store transaction -> record CAS. Never hold over
 * provider HTTP. All host revoke/disable/role/config writers must share this guard.
 * Throw on unavailable/expired/revoked/changed authority, including after local().
 * Hold through local()'s commit acknowledgement; unknown commits require readback.
 * See design/PORTABLE-HANDOFF.md for the external-host obligation. */
export interface SessionAuthority {
  authenticateRequest(request: Request): Promise<Principal>;
  inspectSession(binding: SessionBinding, projectId: string): Promise<SessionInspection>;
  withLiveSessions<T>(expected: readonly SessionInspection[], local: () => Promise<T>): Promise<T>;
}
export function sessionBinding(principal: Principal): SessionBinding {
  if (principal.sessionTokenHash) {
    requireThat(!principal.externalSessionRef && !principal.externalIdentity, "invalid_session_binding", 401);
    return { issuer: "marketing:store", subject: principal.userId, userId: principal.userId, sessionRef: principal.sessionTokenHash };
  }
  const identity = principal.externalIdentity;
  requireThat(identity && principal.externalSessionRef && [identity.issuer, identity.subject, principal.externalSessionRef].every(s => typeof s === "string" && s.length > 0 && s.length <= 500), "host_session_authority_required", 401);
  requireThat(principal.userId === `external:${digest([identity.issuer, identity.subject])}`, "invalid_session_binding", 401);
  return { ...identity, userId: principal.userId, sessionRef: principal.externalSessionRef };
}
export function assertSessionInspection(actual: SessionInspection, binding: SessionBinding, project: string) {
  requireThat(actual && digest(actual.binding) === digest(binding) && actual.projectId === project &&
    typeof actual.revision === "string" && actual.revision.length > 0 && actual.revision.length <= 500 &&
    Number.isFinite(actual.expiresAt) && actual.expiresAt > Date.now() &&
    ["human", "agent"].includes(actual.kind) && ["admin", "editor", "approver", "analyst", "sales", "collector"].includes(actual.role), "session_authority_changed", 401);
}
export async function inspectLiveSessions(authority: SessionAuthority, expected: readonly SessionInspection[]) {
  for (const previous of expected) {
    const actual = await authority.inspectSession(previous.binding, previous.projectId);
    assertSessionInspection(actual, previous.binding, previous.projectId);
    requireThat(digest(actual) === digest(previous), "session_authority_changed", 401);
  }
}
/** Reference host adapter: reuses Store sessions, users, memberships and SQL guard.
 * extractToken belongs to the existing host cookie parser; raw cookies are never
 * persisted in bindings. External hosts implement the port against their own auth. */
export function createStoreSessionAuthority(store: Store, extractToken?: (request: Request) => string): SessionAuthority {
  const authority: SessionAuthority = {
    async authenticateRequest(request) {
      requireThat(extractToken, "host_authentication_required", 401);
      return store.authenticate(extractToken(request));
    },
    async inspectSession(binding, projectId) {
      requireThat(binding.issuer === "marketing:store" && binding.subject === binding.userId && /^[a-f0-9]{64}$/.test(binding.sessionRef), "invalid_session_binding", 401);
      const row = await store.db.prepare("SELECT s.expires_at,u.kind,m.role FROM sessions s JOIN users u ON u.id=s.user_id JOIN memberships m ON m.user_id=u.id WHERE s.token_hash=? AND s.user_id=? AND m.project_id=? AND s.revoked_at IS NULL AND u.disabled=0 AND s.expires_at>?")
        .get(binding.sessionRef, binding.userId, projectId, Date.now());
      requireThat(row, "authentication_required", 401);
      return { binding, projectId, role: row.role as Role, kind: row.kind as "human" | "agent", expiresAt: Number(row.expires_at), revision: digest([row.role, row.kind, Number(row.expires_at)]) };
    },
    async withLiveSessions(expected, local) {
      return store.transaction(async () => {
        await inspectLiveSessions(authority, expected);
        const result = await local();
        await inspectLiveSessions(authority, expected);
        return result;
      });
    },
  };
  return authority;
}
