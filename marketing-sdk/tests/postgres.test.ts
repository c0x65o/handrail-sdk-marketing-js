import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
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
