import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { Store, MarketingServer } from "../server/index.js";
import { openDatastore } from "../reference/index.js";
import { postgresOptions } from "./datastore.js";
const skip = !process.env.MARKETING_TEST_POSTGRES_SOCKET;

test("PostgreSQL concurrent initialization, schema isolation and caught SQL failure rollback", { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "pg-init-"));
  const stores: Store[] = [];
  try {
    const options = (await postgresOptions(dir))!;
    stores.push(...await Promise.all([Store.postgres(options), Store.postgres(options)]));
    const a = stores[0]!;
    assert.deepEqual(await a.db.prepare("SELECT version FROM migrations ORDER BY version").all(), [{ version: 1 }, { version: 2 }]);
    const b = await Store.postgres({ ...options, schema: options.schema + "_other" }); stores.push(b);
    for (const s of [a, b]) await s.db.prepare("INSERT INTO projects VALUES(?,?)").run("same", "Independent");
    await a.put("same", "document", "id", { name: "Only here" });
    await assert.rejects(b.get("same", "document", "id"), /not_found/);
    await assert.rejects(a.transaction(async () => {
      await a.put("same", "document", "rolled-back", {});
      try { await a.db.prepare("SELECT missing_column FROM projects").all(); } catch { /* PostgreSQL abort cannot be swallowed */ }
    }), /transaction_aborted/);
    await assert.rejects(a.get("same", "document", "rolled-back"), /not_found/);
    assert.deepEqual(await a.db.prepare("SELECT '?' AS literal, ?::text AS bound /* ? */").get("value"), { literal: "?", bound: "value" });
    // Normal explicitly bound reference initialization uses the same adapter/schema.
    const url = new URL("postgresql://marketing_test@localhost/postgres");
    url.searchParams.set("host", options.host);
    url.searchParams.set("options", "-c search_path=public");
    const envStore = await openDatastore({ MARKETING_DATASTORE: "postgres", MARKETING_DATABASE_URL: url.href, MARKETING_POSTGRES_SCHEMA: options.schema });
    stores.push(envStore);
    assert.deepEqual(await envStore.get("same", "document", "id"), { name: "Only here" });
    await assert.rejects(Store.postgres({ ...options, schema: 'public' }), /invalid_marketing_schema/);
    await assert.rejects(openDatastore({ MARKETING_DATASTORE: "postgres", DATABASE_URL: url.href }), /marketing_postgres_environment_required/);
  } finally { for (const s of stores) await s.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("PostgreSQL executor excludes competitors, fences connection loss and allows replacement", { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "pg-lock-"));
  const options = (await postgresOptions(dir))!;
  const a = await Store.postgres(options), b = await Store.postgres(options);
  const control = new pg.Client(options); await control.connect();
  try {
    let lost = false;
    await assert.rejects(a.db.assertExecutionOwner(), /executor_lock_required/);
    await a.db.acquireExecutor(() => { lost = true; });
    await assert.rejects(b.db.acquireExecutor(), /executor_unavailable/);
    const { rows } = await control.query("SELECT pid FROM pg_locks WHERE locktype='advisory' AND classid=1296782405 AND objid=(hashtext($1)::bigint & 4294967295)::oid AND objsubid=2 AND granted", [options.schema]);
    assert.equal(rows.length, 1);
    await control.query("SELECT pg_terminate_backend($1)", [rows[0].pid]);
    await assert.rejects(a.db.assertExecutor(), /executor_lock_lost/);
    assert.equal(lost, true);
    await b.db.acquireExecutor();
    await assert.rejects(a.db.prepare("INSERT INTO projects VALUES(?,?)").run("stale", "No write"), /executor_lock_lost/);
    assert.deepEqual(await b.db.prepare("SELECT * FROM projects").all(), []);
  } finally { await control.end(); await a.close(); await b.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("PostgreSQL lost transaction connection rolls back a draft and its retry receipt", { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "pg-disconnect-"));
  const options = (await postgresOptions(dir))!;
  const store = await Store.postgres(options), control = new pg.Client(options);
  await control.connect();
  try {
    await store.db.prepare("INSERT INTO projects VALUES(?,?)").run("p", "Connection loss");
    const principal = await store.bindExternalPrincipal("p", { issuer: "test", subject: "owner" }, "admin");
    const service = MarketingServer.unconnected(store);
    const input = { requestKey: "interrupted", material: { name: "Retryable" } };
    await assert.rejects(store.transaction(async () => {
      await service.call(principal, "p", "saveDraft", input);
      const row = await store.db.prepare("SELECT pg_backend_pid() AS pid").get();
      await control.query("SELECT pg_terminate_backend($1)", [row!.pid]);
      // Allow the checked-out client's idle error event to arrive before COMMIT.
      await new Promise(r => setTimeout(r, 20));
    }), /connection|terminat|queryable/i);
    assert.deepEqual(await store.list("p", "campaignDraft"), []);
    assert.deepEqual(await store.db.prepare("SELECT * FROM requests").all(), []);
    assert.deepEqual(await store.db.prepare("SELECT * FROM outbox").all(), []);
    const saved = await service.call(principal, "p", "saveDraft", input);
    assert.equal(saved.revision, 1);
    assert.deepEqual(await service.call(principal, "p", "saveDraft", input), saved);
  } finally { await control.end(); await store.close(); rmSync(dir, { recursive: true, force: true }); }
});


test("PostgreSQL runtime open is DDL-free, schema-validated and separate from trusted idempotent migration", { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "pg-existing-"));
  const options = (await postgresOptions(dir))!;
  const control = new pg.Client(options); await control.connect();
  const schema = options.schema, role = schema + "_runtime";
  const stores: Store[] = [];
  try {
    await assert.rejects(Store.openExistingPostgres(options), /marketing_schema_missing/);
    assert.equal((await control.query("SELECT to_regnamespace($1) AS schema", [schema])).rows[0].schema, null);
    // An existing v1 installation is left untouched by runtime initialization.
    await control.query(`CREATE SCHEMA "${schema}"`);
    await control.query(`SET search_path TO "${schema}"`);
    await control.query(readFileSync(new URL("../../marketing-sdk/server/schema.postgres.sql", import.meta.url), "utf8"));
    await assert.rejects(Store.openExistingPostgres(options), /marketing_schema_version_mismatch/);
    assert.deepEqual((await control.query("SELECT version FROM migrations")).rows, [{ version: 1 }]);
    await Store.migratePostgres(options);
    const before = (await control.query("SELECT oid,relname FROM pg_class WHERE relnamespace=$1::regnamespace ORDER BY oid", [schema])).rows;
    await Store.migratePostgres(options);
    assert.deepEqual((await control.query("SELECT oid,relname FROM pg_class WHERE relnamespace=$1::regnamespace ORDER BY oid", [schema])).rows, before);
    // The runtime role owns no schema/table and cannot perform schema DDL.
    await control.query(`CREATE ROLE "${role}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`);
    await control.query(`GRANT USAGE ON SCHEMA "${schema}" TO "${role}"`);
    await control.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA "${schema}" TO "${role}"`);
    await control.query(`GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA "${schema}" TO "${role}"`);
    const runtimeOptions = { ...options, user: role };
    const restricted = new pg.Client(runtimeOptions); await restricted.connect();
    try {
      await assert.rejects(restricted.query(`CREATE TABLE "${schema}".forbidden(id int)`), /permission denied/);
      await assert.rejects(restricted.query(`ALTER TABLE "${schema}".projects ADD COLUMN forbidden int`), /must be owner/);
    } finally { await restricted.end(); }
    const statements: string[] = [];
    const runtime = await Store.openExistingPostgres({ ...runtimeOptions, onConnect: async c => {
      // Real pg queries still execute; capture startup SQL to prove no attempted DDL.
      const query = c.query.bind(c);
      c.query = ((sql: any, ...args: any[]) => {
        statements.push(typeof sql === "string" ? sql : sql.text);
        return (query as any)(sql, ...args);
      }) as typeof c.query;
    } });
    stores.push(runtime);
    assert.ok(statements.length > 5);
    assert.ok(statements.every(s => /^(SELECT|SET|BEGIN READ ONLY|COMMIT)/.test(s)), statements.join("\n"));
    await runtime.db.prepare("INSERT INTO projects VALUES(?,?)").run("p", "Runtime DML");
    const principal = await runtime.bindExternalPrincipal("p", { issuer: "fixture", subject: "owner" }, "admin");
    const draft = await MarketingServer.unconnected(runtime).call(principal, "p", "saveDraft", { requestKey: "draft", material: { name: "Preserved" } });
    assert.equal(draft.material.name, "Preserved");
    await runtime.db.acquireExecutor();
    await runtime.db.assertExecutionOwner();
    await assert.rejects(Store.migratePostgres(runtimeOptions), /permission denied|must be owner/);
    // Fail closed on future versions, absent required columns, and missing guard.
    await control.query("INSERT INTO migrations VALUES(999)");
    await assert.rejects(Store.openExistingPostgres(runtimeOptions), /marketing_schema_version_mismatch/);
    await assert.rejects(Store.migratePostgres(options), /marketing_schema_version_mismatch/);
    await control.query("DELETE FROM migrations WHERE version=999");
    await control.query("ALTER TABLE requests RENAME COLUMN digest TO missing_digest");
    await assert.rejects(Store.openExistingPostgres(runtimeOptions), /marketing_schema_invalid:requests.digest/);
    await control.query("ALTER TABLE requests RENAME COLUMN missing_digest TO digest");
    await control.query("DELETE FROM transaction_guard");
    await assert.rejects(Store.openExistingPostgres(runtimeOptions), /marketing_schema_guard_missing/);
    await control.query("INSERT INTO transaction_guard VALUES(1)");
    const url = new URL(`postgresql://${role}@localhost/postgres`);
    url.searchParams.set("host", options.host);
    const reopened = await openDatastore({ MARKETING_DATASTORE: "postgres", MARKETING_DATABASE_URL: url.href,
      MARKETING_POSTGRES_SCHEMA: schema, MARKETING_POSTGRES_INITIALIZATION: "open-existing" }); stores.push(reopened);
    await assert.rejects(openDatastore({ MARKETING_DATASTORE: "postgres", MARKETING_DATABASE_URL: url.href,
      MARKETING_POSTGRES_INITIALIZATION: "typo" }), /invalid_postgres_initialization/);
    assert.equal((await reopened.get<any>("p", "campaignDraft", draft.id)).material.name, "Preserved");
  } finally {
    for (const store of stores) await store.close();
    await control.end(); rmSync(dir, { recursive: true, force: true });
  }
});
