import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { testStore } from "./datastore.js";
import { byteDigest } from "../server/store.js";
import { runtime, createHost } from "../reference/host.js";
import { createCredentialCipher } from "../support/vault-crypto.js";

test("v1 migration preserves sessions; mapping expiry, revocation and immutable identity agree after restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marketing-migration-"));
  const path = join(dir, "db");
  let s = await testStore(path);
  try {
    // Reconstruct the actual previous three-column session schema, with a live row.
    await s.db.prepare("DROP VIEW marketing_known_sessions").run();
    await s.db.prepare("DROP VIEW marketing_known_users").run();
    await s.db.prepare("ALTER TABLE sessions DROP COLUMN revoked_at").run();
    await s.db.prepare("DELETE FROM migrations WHERE version=2").run();
    const uid = await s.createUser("old-login", "");
    const token = randomBytes(32).toString("base64url");
    const expiry = Date.now() + 100000;
    const digest = byteDigest(Buffer.from(token));
    await s.db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(digest, uid, expiry);
    await s.close();
    s = await testStore(path);
    assert.deepEqual(await s.authenticate(token, expiry - 1), { userId: uid });
    await assert.rejects(s.authenticate(token, expiry), /authentication_required/);
    // Native Known Users binds a Date for MariaDB and ISO text for SQLite.
    const mapped = async (at: number) => s.db.prepare("SELECT u.id FROM marketing_known_sessions s JOIN marketing_known_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND s.revoked_at IS NULL AND u.disabled=0")
      .all(digest, s.db.dialect === "mariadb" ? new Date(at) : new Date(at).toISOString());
    assert.equal((await mapped(expiry - 1)).length, 1);
    assert.equal((await mapped(expiry)).length, 0);
    await s.db.prepare("UPDATE users SET login=? WHERE id=?").run("renamed-label", uid);
    assert.equal((await s.authenticate(token)).userId, uid);
    assert.deepEqual({ ...await s.db.prepare("SELECT * FROM marketing_known_users WHERE id=?").get(uid) }, { id: uid, display_name: "renamed-label", disabled: 0 });
    await assert.rejects(s.db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)").run(digest, uid, expiry));
    // The view also enforces current expiry independently of reader date encoding.
    await s.db.prepare("UPDATE sessions SET expires_at=? WHERE token_hash=?").run(Date.now() - 1, digest);
    assert.equal((await mapped(expiry - 3600000)).length, 0);
    await s.db.prepare("UPDATE sessions SET expires_at=? WHERE token_hash=?").run(expiry, digest);
    await s.revokeSession(token, expiry - 100);
    await s.revokeSession(token, expiry - 50);
    await s.close();
    s = await testStore(path);
    await assert.rejects(s.authenticate(token), /authentication_required/);
    assert.equal((await mapped(expiry - 1)).length, 0);
    const row = await s.db.prepare("SELECT * FROM sessions WHERE token_hash=?").get(digest);
    assert.equal(row!.revoked_at, new Date(expiry - 100).toISOString());
    assert.equal(Number(row!.expires_at), expiry);
    assert.ok(!JSON.stringify(row).includes(token));
    assert.equal((await s.db.prepare("SELECT version FROM migrations WHERE version=2").all()).length, 1);
  } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("two independent HTTP users cannot cross projects; logout, expiry, revoke-all and disabled users fail closed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marketing-sessions-"));
  const s = await testStore(join(dir, "db"));
  let host: Awaited<ReturnType<typeof createHost>> | undefined;
  try {
    for (const p of ["alpha", "beta"]) await s.db.prepare("INSERT INTO projects VALUES(?,?)").run(p, p);
    const alice = await s.createUser("alice", ""), bob = await s.createUser("bob", "b");
    // Ambiguous identities cannot be represented by the authoritative schema.
    await assert.rejects(s.createUser("alice", "duplicate"));
    await s.db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(alice, "alpha", "admin");
    await s.db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(bob, "beta", "analyst");
    const { service } = await runtime({ MARKETING_MODE: "fixture", MARKETING_PUBLIC_URL: "http://127.0.0.1" }, s);
    host = await createHost({ store: s, service, origin: "https://marketing.example", staticDir: dir, version: "local-source" });
    await new Promise<void>(r => host!.server.listen(0, "127.0.0.1", r));
    const address = host.server.address(); assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const login = async (username: string, password: string) => {
      const r = await fetch(`${base}/api/login`, { method: "POST", headers: { "content-type": "application/json", origin: "https://marketing.example" }, body: JSON.stringify({ username, password }) });
      assert.equal(r.status, 200);
      const cookie = r.headers.get("set-cookie")!;
      assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=Lax/);
      assert.equal(JSON.stringify(await r.json()).includes("session"), false);
      return cookie.split(";")[0]!;
    };
    const a = await login("alice", ""), b = await login("bob", "b");
    const call = (cookie: string, path: string, origin = "https://marketing.example") => fetch(base + path, { method: "POST", headers: { cookie, origin, "content-type": "application/json" }, body: JSON.stringify({ userId: alice, role: "admin" }) });
    assert.equal((await fetch(base + "/api/me", { headers: { cookie: a } })).status, 200);
    assert.equal((await call(a, "/api/projects/beta/workspace")).status, 403);
    assert.equal((await call(b, "/api/projects/alpha/workspace")).status, 403);
    const ownWorkspace = await fetch(base + "/api/projects/beta/workspace", { method: "POST", headers: { cookie: b, origin: "https://marketing.example", "content-type": "application/json" }, body: "{}" });
    assert.equal(ownWorkspace.status, 200);
    assert.equal((await ownWorkspace.json() as { role: string }).role, "analyst");
    // Role/principal fields in the request body cannot elevate this session.
    assert.equal((await call(b, "/api/projects/beta/saveCampaign")).status, 422);
    const deniedWrite = await fetch(base + "/api/projects/beta/saveCampaign", { method: "POST", headers: { cookie: b, origin: "https://marketing.example", "content-type": "application/json" }, body: "{}" });
    assert.equal(deniedWrite.status, 403);
    assert.equal((await call(a, "/api/logout", "https://other.example")).status, 403);
    assert.equal((await call(a, "/api/logout")).status, 200);
    assert.equal((await fetch(base + "/api/me", { headers: { cookie: a } })).status, 401);
    assert.equal((await fetch(base + "/api/me", { headers: { cookie: b } })).status, 200);
    const tokenB = b.slice(b.indexOf("=") + 1);
    await s.db.prepare("UPDATE sessions SET expires_at=? WHERE token_hash=?").run(Date.now() - 1, byteDigest(Buffer.from(tokenB)));
    assert.equal((await fetch(base + "/api/me", { headers: { cookie: b } })).status, 401);
    const b2 = await login("bob", "b"), a2 = await login("alice", "");
    await s.revokeUserSessions(bob);
    assert.equal((await fetch(base + "/api/me", { headers: { cookie: b2 } })).status, 401);
    assert.equal((await fetch(base + "/api/me", { headers: { cookie: a2 } })).status, 200);
    await s.db.prepare("UPDATE users SET disabled=1 WHERE id=?").run(alice);
    assert.equal((await fetch(base + "/api/me", { headers: { cookie: a2 } })).status, 401);
    const mappedDisabled = await s.db.prepare("SELECT id FROM marketing_known_users WHERE id=? AND disabled=0").all(alice);
    assert.equal(mappedDisabled.length, 0);
    await assert.rejects(s.authenticate("missing"), /authentication_required/);
    // Foreign-key constraints reject missing-user sessions before authentication.
    await assert.rejects(s.db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)").run(byteDigest(randomBytes(32)), "missing", Date.now() + 1000));
  } finally {
    if (host) { await new Promise<void>(r => host!.server.close(() => r())); await host.idle(); }
    await s.close(); rmSync(dir, { recursive: true, force: true });
  }
});

test("injected cipher preserves encrypted envelopes, key identity, rotation and tamper rejection", () => {
  const keys: Record<string, Uint8Array> = { old: randomBytes(32), next: randomBytes(32) };
  const resolve = (id: string) => { if (!keys[id]) throw new Error("key_unavailable"); return keys[id]!; };
  const old = createCredentialCipher("old", resolve), next = createCredentialCipher("next", resolve);
  const saved = old.encryptPayload("private synthetic credential");
  assert.equal(next.decryptPayloadAsString(saved.encrypted, saved.keyId), "private synthetic credential");
  assert.equal(next.encryptPayload("next").keyId, "next");
  const corrupted = Buffer.from(saved.encrypted, "base64"); corrupted[15] = corrupted[15]! ^ 1;
  assert.throws(() => next.decryptPayloadAsString(corrupted.toString("base64"), saved.keyId));
  assert.throws(() => next.decryptPayloadAsString(saved.encrypted, "absent"), /key_unavailable/);
  assert.throws(() => createCredentialCipher("bad", () => new Uint8Array(12)), /invalid_credential_key/);
});
