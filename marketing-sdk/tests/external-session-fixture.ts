import type { Role } from "@handrail/marketing";
import { randomBytes, randomUUID } from "node:crypto";
import { externalSessionAdapter, type ExistingHostSessions } from "../examples/external-sessions.js";
import { byteDigest, digest, requireThat, type Store, type Principal } from "@handrail/marketing/server";

/** Disposable host schema ONLY, representing existing host auth. No fixture
 * identities go into SDK sessions/passwords. Both SQL dialects use the real DB. */
export async function externalSessionFixture(store: Store, hostStore: Store = store, authenticationStore: Store = hostStore, initialize = true) {
  if (initialize) {
  await hostStore.db.prepare("CREATE TABLE fixture_host_users (subject TEXT PRIMARY KEY, disabled INTEGER NOT NULL, revision INTEGER NOT NULL)").run();
  await hostStore.db.prepare("CREATE TABLE fixture_host_sessions (id TEXT PRIMARY KEY, cookie_hash TEXT NOT NULL, subject TEXT NOT NULL, expires_at BIGINT NOT NULL, revoked INTEGER NOT NULL)").run();
  await hostStore.db.prepare("CREATE TABLE fixture_host_memberships (subject TEXT NOT NULL, project_id TEXT NOT NULL, role TEXT NOT NULL, PRIMARY KEY(subject,project_id))").run();
  for (const subject of ["alice", "bob"]) {
    await hostStore.db.prepare("INSERT INTO fixture_host_users VALUES(?,0,1)").run(subject);
    for (const project of ["p", "other"]) await hostStore.db.prepare("INSERT INTO fixture_host_memberships VALUES(?,?,?)").run(subject, project, "admin");
  }
  }
  let configuration = "host-config-1";
  const host: ExistingHostSessions = {
    async authenticate(request) {
      const cookie = /(?:^|; )host_session=([^;]+)/.exec(request.headers.get("cookie") ?? "")?.[1] ?? "";
      const row = await authenticationStore.db.prepare("SELECT s.id,s.subject FROM fixture_host_sessions s JOIN fixture_host_users u ON u.subject=s.subject WHERE s.cookie_hash=? AND s.revoked=0 AND s.expires_at>? AND u.disabled=0").get(byteDigest(Buffer.from(cookie)), Date.now());
      requireThat(row, "authentication_required", 401);
      return { issuer: "https://existing-host.example", subject: String(row.subject), sessionRef: String(row.id) };
    },
    async inspect(binding, project) {
      if (binding.issuer !== "https://existing-host.example" || binding.userId !== `external:${digest([binding.issuer, binding.subject])}`) return null;
      const row = await hostStore.db.prepare("SELECT s.expires_at,u.revision,m.role FROM fixture_host_sessions s JOIN fixture_host_users u ON u.subject=s.subject JOIN fixture_host_memberships m ON m.subject=u.subject WHERE s.id=? AND s.subject=? AND m.project_id=? AND s.revoked=0 AND u.disabled=0 AND s.expires_at>?").get(binding.sessionRef, binding.subject, project, Date.now());
      return row ? { expiresAt: Number(row.expires_at), kind: "human", role: row.role as Role, revision: digest([row.revision, row.role, configuration]) } : null;
    },
    // This fixture host shares the SQL transaction guard. A separate host database
    // must supply its own coordinated lock; this is not a supplied Preview adapter.
    withRevocationGuard: (_sessions, local) => hostStore.transaction(local),
  };
  const adapter = externalSessionAdapter(store, host);
  const login = async (subject = "alice") => {
    const token = randomBytes(32).toString("base64url"), sessionRef = randomUUID();
    await hostStore.db.prepare("INSERT INTO fixture_host_sessions VALUES(?,?,?,?,0)").run(sessionRef, byteDigest(Buffer.from(token)), subject, Date.now() + 3600000);
    return { token, sessionRef };
  };
  const request = (token: string, path = "/api/projects/p/connections", init: RequestInit = {}) => new Request("https://sdk.example" + path, { ...init, headers: { cookie: `host_session=${token}`, ...init.headers } });
  const principal = (token: string, project = "p"): Promise<Principal> => adapter.authenticate(request(token, `/api/projects/${project}/connections`));
  return { ...adapter, host, login, request, principal,
    revoke: (session: string) => hostStore.db.prepare("UPDATE fixture_host_sessions SET revoked=1 WHERE id=?").run(session),
    disable: (subject = "alice") => hostStore.db.prepare("UPDATE fixture_host_users SET disabled=1,revision=revision+1 WHERE subject=?").run(subject),
    changeRole: (role: string, subject = "alice", project = "p") => hostStore.transaction(async () => {
      await hostStore.db.prepare("UPDATE fixture_host_memberships SET role=? WHERE subject=? AND project_id=?").run(role, subject, project);
      await hostStore.db.prepare("UPDATE fixture_host_users SET revision=revision+1 WHERE subject=?").run(subject);
    }),
    changeConfiguration: () => hostStore.transaction(async () => { configuration += ":changed"; }),
  };
}
