import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import mysql from "mysql2/promise";
import { testStore } from "./datastore.js";
import { bootstrapFixture, seedQa } from "../reference/seed.js";
import { Store } from "../server/store.js";

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "marketing-store-"));
  const path = join(dir, "db");
  const store = await testStore(path);
  return {
    store,
    path,
    close: async () => {
      await store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
test("async rejection rolls back records, blobs, and journal together; caught nested failure aborts outer transaction", async () => {
  const f = await fixture(),
    s = f.store;
  try {
    await s.db.prepare("INSERT INTO projects VALUES(?,?)").run("p", "Rollback");
    await assert.rejects(
      s.transaction(async () => {
        await s.put("p", "test", "one", { revision: 1 });
        await s.db
          .prepare("INSERT INTO blobs VALUES(?,?,?)")
          .run("p", "digest", Buffer.from("bytes"));
        await new Promise((r) => setTimeout(r, 10));
        await s.append("p", "one", "test.created", {});
        throw new Error("injected_after_await");
      }),
      /injected_after_await/,
    );
    assert.equal((await s.list("p", "test")).length, 0);
    assert.equal((await s.db.prepare("SELECT * FROM blobs").all()).length, 0);
    assert.equal((await s.db.prepare("SELECT * FROM outbox").all()).length, 0);
    await assert.rejects(
      s.transaction(async () => {
        try {
          await s.transaction(async () => {
            await s.put("p", "test", "two", {});
            throw new Error("inner");
          });
        } catch {
          /* cannot commit a partial nested transition */
        }
      }),
      /transaction_aborted/,
    );
    assert.equal((await s.list("p", "test")).length, 0);
  } finally {
    await f.close();
  }
});
test("concurrent revision claims serialize and exactly one commits; case-sensitive project isolation", async () => {
  const f = await fixture(),
    s = f.store;
  try {
    await s.db.prepare("INSERT INTO projects VALUES(?,?)").run("p", "One");
    await s.db.prepare("INSERT INTO projects VALUES(?,?)").run("P", "Other");
    await s.put("p", "record", "a", { revision: 1 });
    const results = await Promise.allSettled(
      [1, 2].map((value) =>
        s.transaction(async () => {
          const row = await s.get<{ revision: number }>("p", "record", "a");
          await new Promise((r) => setTimeout(r, 10));
          await s.put(
            "p",
            "record",
            "a",
            { revision: row.revision + 1, value },
            1,
          );
        }),
      ),
    );
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(
      (await s.get<{ revision: number }>("p", "record", "a")).revision,
      2,
    );
    await assert.rejects(s.get("P", "record", "a"), /not_found/);
  } finally {
    await f.close();
  }
});
test("parallel first-use bootstrap is atomic and restart does not reset identity, membership, or grants", async () => {
  const f = await fixture(),
    s = f.store;
  try {
    await Promise.all([
      seedQa(s, { username: "private-qa", password: "original" }),
      seedQa(s, { username: "private-qa", password: "original" }),
    ]);
    const users = await s.db.prepare("SELECT * FROM users").all();
    assert.equal(users.length, 1);
    await s.db
      .prepare("UPDATE memberships SET role=? WHERE user_id=?")
      .run("analyst", users[0]!.id);
    await seedQa(s, { username: "replacement", password: "replacement" });
    assert.equal((await s.db.prepare("SELECT * FROM users").all()).length, 1);
    assert.equal(
      (await s.authorize({ userId: String(users[0]!.id) }, "qa-alpha")).role,
      "analyst",
    );
    assert.ok(await s.login("private-qa", "original", "first"));
    await assert.rejects(
      bootstrapFixture(s, {
        APP_ENV: "production",
        MARKETING_MODE: "fixture",
        MARKETING_BOOTSTRAP: "staging-fixture",
      }),
      /staging_fixture_bootstrap_only/,
    );
  } finally {
    await f.close();
  }
});
test(
  "MariaDB connection lock excludes a second executor and fences lost holder; replacement acquires after loss",
  { skip: !process.env.MARKETING_TEST_MARIADB_SOCKET },
  async () => {
    const f = await fixture(),
      a = f.store;
    let b: Store | undefined;
    const control = await mysql.createConnection({
      socketPath: process.env.MARKETING_TEST_MARIADB_SOCKET,
      user: "root",
    });
    try {
      b = await testStore(f.path);
      let lost = false;
      await a.db.acquireExecutor(() => {
        lost = true;
      });
      await assert.rejects(b.db.acquireExecutor(), /executor_unavailable/);
      const row = await a.db
        .prepare(
          'SELECT IS_USED_LOCK(CONCAT(DATABASE(), ":marketing-executor")) AS owner',
        )
        .get();
      const owner = Number(row!.owner);
      assert.ok(Number.isSafeInteger(owner) && owner > 0);
      await control.query(`KILL CONNECTION ${owner}`);
      await assert.rejects(a.db.assertExecutor(), /executor_lock_lost/);
      assert.equal(lost, true);
      await b.db.acquireExecutor();
      await assert.rejects(
        a.db
          .prepare("INSERT INTO projects VALUES(?,?)")
          .run("stale", "must not write"),
        /executor_lock_lost/,
      );
      assert.equal(
        (await b.db.prepare("SELECT * FROM projects").all()).length,
        0,
      );
    } finally {
      await control.end();
      await b?.close();
      await f.close();
    }
  },
);
