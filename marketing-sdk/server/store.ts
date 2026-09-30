import { Database } from "./database.js";
import type { PoolOptions } from "mysql2/promise";
import type { PoolConfig } from "pg";
import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import type { Role } from "../core/index.js";
import { canonical } from "../core/index.js";
export const digest = (v: unknown) =>
  createHash("sha256").update(canonical(v)).digest("hex");
export const byteDigest = (b: Uint8Array) =>
  createHash("sha256").update(b).digest("hex");
export const id = () => randomUUID();
export class DomainError extends Error {
  constructor(
    public code: string,
    public status = 409,
  ) {
    super(code);
  }
}
export const requireThat: (
  condition: unknown,
  code: string,
  status?: number,
) => asserts condition = (condition, code, status) => {
  if (!condition) throw new DomainError(code, status);
};
export interface Principal {
  userId: string;
}
export class Store {
  readonly db: Database;
  constructor(path: string | Database) {
    this.db = typeof path === "string" ? new Database(path) : path;
  }
  static async maria(options: PoolOptions) {
    return new Store(await Database.maria(options));
  }
  static async postgres(options: PoolConfig & { schema?: string }) {
    return new Store(await Database.postgres(options));
  }
  async close() {
    await this.db.close();
  }
  async transaction<T>(fn: () => T | Promise<T>): Promise<T> {
    return await this.db.transaction(fn);
  }
  async get<T>(project: string, kind: string, key: string): Promise<T> {
    const row = await this.db
      .prepare(
        "SELECT body FROM records WHERE project_id=? AND kind=? AND id=?",
      )
      .get(project, kind, key);
    requireThat(row, "not_found", 404);
    return JSON.parse(String(row.body)) as T;
  }
  async list<T>(project: string, kind: string): Promise<T[]> {
    return (
      await this.db
        .prepare(
          `SELECT body FROM records WHERE project_id=? AND kind=? ORDER BY ${this.db.dialect === "sqlite" ? "rowid" : "sequence"}`,
        )
        .all(project, kind)
    ).map((row) => JSON.parse(String(row.body)) as T);
  }
  async put(
    project: string,
    kind: string,
    key: string,
    value: unknown,
    expected?: number,
  ) {
    const body = JSON.stringify(value);
    const version = (
      value as {
        revision?: number;
      }
    )?.revision;
    if (expected !== undefined) {
      const r = await this.db
        .prepare(
          "UPDATE records SET body=?,revision=COALESCE(?,revision+1) WHERE project_id=? AND kind=? AND id=? AND revision=?",
        )
        .run(body, version ?? null, project, kind, key, expected);
      requireThat(r.changes === 1, "revision_conflict");
    } else {
      await this.db
        .prepare(
          this.db.dialect === "mariadb"
            ? "INSERT INTO records(project_id,kind,id,revision,body) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE body=VALUES(body),revision=COALESCE(?,revision+1)"
            : "INSERT INTO records(project_id,kind,id,revision,body) VALUES(?,?,?,?,?) ON CONFLICT(project_id,kind,id) DO UPDATE SET body=excluded.body,revision=COALESCE(?,records.revision+1)",
        )
        .run(project, kind, key, version ?? 1, body, version ?? null);
    }
  }
  async append(
    project: string,
    aggregate: string,
    type: string,
    body: unknown,
  ) {
    await this.db
      .prepare(
        "INSERT INTO outbox(project_id,aggregate_id,type,body,created_at) VALUES(?,?,?,?,?)",
      )
      .run(
        project,
        aggregate,
        type,
        JSON.stringify(body),
        new Date().toISOString(),
      );
  }
  async authorize(
    principal: Principal,
    project: string,
    roles?: Role[],
    human = false,
  ): Promise<{
    role: Role;
    kind: "human" | "agent";
  }> {
    const row = await this.db
      .prepare(
        "SELECT m.role,u.kind FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.user_id=? AND m.project_id=? AND u.disabled=0",
      )
      .get(principal.userId, project);
    requireThat(
      row &&
        (!roles || roles.includes(row.role as Role)) &&
        (!human || row.kind === "human"),
      "forbidden",
      403,
    );
    return {
      role: row.role as Role,
      kind: row.kind as "human" | "agent",
    };
  }
  async createUser(
    login: string,
    password: string,
    kind: "human" | "agent" = "human",
  ) {
    const userId = id();
    const salt = randomBytes(16).toString("hex");
    await this.db
      .prepare("INSERT INTO users(id,login,password_hash,kind) VALUES(?,?,?,?)")
      .run(
        userId,
        login.toLowerCase().trim(),
        `${salt}:${scryptSync(password, salt, 64).toString("hex")}`,
        kind,
      );
    return userId;
  }
  /** Trusted host authentication bridge, never accept these fields from a client.
   * issuer/subject are stable verified identity IDs; role is the host's CURRENT
   * membership in this project (null removes it). No SDK password is created. */
  async bindExternalPrincipal(
    project: string,
    identity: { issuer: string; subject: string; kind?: "human" | "agent" },
    role: Role | null,
  ): Promise<Principal> {
    requireThat(identity && [identity.issuer, identity.subject].every(v =>
      typeof v === "string" && v.trim().length > 0 && v.length <= 500), "invalid_external_identity", 422);
    const kind = identity.kind ?? "human";
    requireThat(kind === "human" || kind === "agent", "invalid_identity_kind", 422);
    requireThat(role === null || ["admin", "editor", "approver", "analyst", "sales", "collector"].includes(role), "invalid_role", 422);
    const userId = `external:${digest([identity.issuer, identity.subject])}`;
    return this.transaction(async () => {
      const old = await this.db.prepare("SELECT password_hash,kind FROM users WHERE id=?").get(userId);
      if (old) requireThat(old.password_hash === "" && old.kind === kind, "external_identity_conflict");
      else await this.db.prepare("INSERT INTO users(id,login,password_hash,kind) VALUES(?,?,?,?)")
        .run(userId, userId, "", kind);
      // Delete/insert is atomic under the store guard and portable across backends.
      await this.db.prepare("DELETE FROM memberships WHERE user_id=? AND project_id=?").run(userId, project);
      if (role !== null) await this.db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(userId, project, role);
      return { userId };
    });
  }
  async login(login: string, password: string, ip: string, now = Date.now()) {
    return await this.transaction(async () => {
      await this.db
        .prepare("DELETE FROM auth_attempts WHERE at<=?")
        .run(now - 60000);
      const count = (await this.db
        .prepare("SELECT COUNT(*) AS n FROM auth_attempts WHERE ip=?")
        .get(ip))!;
      requireThat(Number(count.n) < 10, "authentication_rate_limited", 429);
      await this.db
        .prepare("INSERT INTO auth_attempts VALUES(?,?)")
        .run(ip, now);
      // Commit failed attempts too; invalid credentials are returned after the transaction.
      const row = await this.db
        .prepare(
          "SELECT id,password_hash,disabled FROM users WHERE login=? AND kind='human'",
        )
        .get(login.toLowerCase().trim());
      const [salt, hash] = String(row?.password_hash || "absent:").split(":");
      const calculated = scryptSync(password, salt!, 64);
      const expected = hash ? Buffer.from(hash, "hex") : Buffer.alloc(64);
      if (!row || !row.password_hash || row.disabled || !timingSafeEqual(calculated, expected))
        return null;
      const token = randomBytes(32).toString("base64url");
      await this.db
        .prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)")
        .run(byteDigest(Buffer.from(token)), String(row.id), now + 8 * 3600000);
      return token;
    });
  }
  /** Trusted host boundary; raw tokens are hashed immediately and never retained. */
  async revokeSession(token: string, now = Date.now()) {
    await this.db.prepare("UPDATE sessions SET revoked_at=COALESCE(revoked_at,?) WHERE token_hash=?")
      .run(new Date(now).toISOString(), byteDigest(Buffer.from(token)));
  }
  /** Use on password reset or account disablement; caller must be trusted host code. */
  async revokeUserSessions(userId: string, now = Date.now()) {
    await this.db.prepare("UPDATE sessions SET revoked_at=COALESCE(revoked_at,?) WHERE user_id=?")
      .run(new Date(now).toISOString(), userId);
  }
  async authenticate(token: string, now = Date.now()): Promise<Principal> {
    const row = await this.db
      .prepare(
        "SELECT s.user_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND s.revoked_at IS NULL AND u.disabled=0",
      )
      .get(byteDigest(Buffer.from(token)), now);
    requireThat(row, "authentication_required", 401);
    return {
      userId: String(row.user_id),
    };
  }
}
