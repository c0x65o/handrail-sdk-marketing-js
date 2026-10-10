import {
  digest, requireThat, inspectLiveSessions,
  type Store, type Principal, type SessionAuthority, type SessionBinding, type SessionInspection,
} from "@handrail/marketing/server";

/** These operations belong to the host's EXISTING auth/database. No SDK password
 * or session row is created. This is adapter glue, not a production auth engine. */
export interface ExistingHostSessions {
  authenticate(request: Request): Promise<{ issuer: string; subject: string; sessionRef: string }>;
  /** Fresh authoritative user, session, membership and authorization-config facts.
   * Return null for missing/disabled/revoked/expired/no membership. No side effects. */
  inspect(binding: SessionBinding, projectId: string): Promise<Omit<SessionInspection, "binding" | "projectId"> | null>;
  /** Serialize with every host logout/user/role/password/config writer. Acquire
   * host locks in deterministic identity/session order BEFORE any SDK Store lock.
   * Hold through local's commit acknowledgement. Bounded local operations only. */
  withRevocationGuard<T>(sessions: readonly SessionBinding[], local: () => Promise<T>): Promise<T>;
}
export function externalSessionAdapter(store: Store, host: ExistingHostSessions) {
  const authority: SessionAuthority = {
    async authenticateRequest(request) {
      const verified = await host.authenticate(request);
      return { userId: `external:${digest([verified.issuer, verified.subject])}`,
        externalIdentity: { issuer: verified.issuer, subject: verified.subject }, externalSessionRef: verified.sessionRef };
    },
    async inspectSession(binding, projectId) {
      const facts = await host.inspect(binding, projectId);
      requireThat(facts && facts.expiresAt > Date.now(), "authentication_required", 401);
      return { ...facts, binding, projectId };
    },
    async withLiveSessions(expected, local) {
      const bindings = [...new Map(expected.map(e => [digest(e.binding), e.binding])).entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, b]) => b);
      return host.withRevocationGuard(bindings, async () => {
        await inspectLiveSessions(authority, expected);
        // Cross-database hosts MUST keep their lock through this Store COMMIT.
        // A failed acknowledgement does not prove the commit did not happen.
        return local();
      });
    },
  };
  return {
    authority,
    /** Authenticate project routes and refresh only the existing stable SDK
     * identity/membership mapping from current HOST facts. Project comes from the
     * route, role NEVER from request JSON. Stable callback routes need no project
     * mapping: the initiating authenticated request already established it. */
    async authenticate(request: Request): Promise<Principal> {
      const p = await authority.authenticateRequest(request);
      const match = /^\/api\/projects\/([^/]+)\//.exec(new URL(request.url).pathname);
      if (match) {
        const project = decodeURIComponent(match[1]!);
        const binding = { ...p.externalIdentity!, userId: p.userId, sessionRef: p.externalSessionRef! };
        const facts = await authority.inspectSession(binding, project);
        await authority.withLiveSessions([facts], () => store.bindExternalPrincipal(project, { ...p.externalIdentity!, kind: facts.kind }, facts.role));
      }
      return p;
    },
  };
}
