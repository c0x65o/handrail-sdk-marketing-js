import { AsyncLocalStorage } from "node:async_hooks";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import mysql, {
  type Pool,
  type PoolConnection,
  type PoolOptions,
  type RowDataPacket,
  type ResultSetHeader,
} from "mysql2/promise";
type Row = Record<string, unknown>;
type Context = {
  connection?: PoolConnection;
  active: boolean;
  failed?: boolean;
};
/** Real SQL adapters; all application transactions and implicit writes share a
 * database guard row. Async context pins every statement to its transaction. */
export class Database {
  private local?: DatabaseSync;
  private pool?: Pool;
  private context = new AsyncLocalStorage<Context>();
  private tail: Promise<unknown> = Promise.resolve();
  private executor?: PoolConnection;
  private executorId?: number;
  private executorName?: string;
  private lost = false;
  private heartbeat?: ReturnType<typeof setInterval>;
  private onLost?: () => void;
  readonly dialect: "sqlite" | "mariadb";
  constructor(path: string) {
    this.dialect = "sqlite";
    if (path === ":memory:") throw new Error("durable_database_required");
    mkdirSync(dirname(path), {
      recursive: true,
      mode: 0o700,
    });
    this.local = new DatabaseSync(path);
    this.local.exec(
      "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;",
    );
    this.local.exec(
      readFileSync(
        new URL("../../marketing-sdk/server/schema.sql", import.meta.url),
        "utf8",
      ),
    );
    this.local.exec("BEGIN IMMEDIATE");
    try {
      if (!this.local.prepare("SELECT version FROM migrations WHERE version=2").get())
        this.local.exec(readFileSync(new URL("../../marketing-sdk/server/migrations/002-sessions.sqlite.sql", import.meta.url), "utf8"));
      this.local.exec("COMMIT");
    } catch (error) {
      this.local.exec("ROLLBACK");
      this.local.close();
      throw error;
    }
  }
  static async maria(options: PoolOptions): Promise<Database> {
    const db = Object.create(Database.prototype) as Database;
    Object.assign(db, {
      dialect: "mariadb",
      context: new AsyncLocalStorage<Context>(),
      tail: Promise.resolve(),
      lost: false,
    });
    db.pool = mysql.createPool({
      ...options,
      timezone: "Z",
      connectionLimit: 6,
      multipleStatements: false,
      supportBigNumbers: true,
    });
    const connection = await db.pool.getConnection();
    try {
      const [rows] = await connection.query<RowDataPacket[]>(
        'SELECT GET_LOCK(CONCAT(DATABASE(), ":marketing-schema"),30) AS acquired',
      );
      if (Number(rows[0]?.acquired) !== 1)
        throw new Error("schema_lock_unavailable");
      const sql = readFileSync(
        new URL(
          "../../marketing-sdk/server/schema.mariadb.sql",
          import.meta.url,
        ),
        "utf8",
      );
      for (const statement of sql
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean))
        await connection.query(statement);
      const [versions] = await connection.query<RowDataPacket[]>("SELECT version FROM migrations WHERE version=2");
      if (!versions.length) {
        // MariaDB DDL commits implicitly. Every step is restart-safe; mark last.
        const migration = readFileSync(new URL("../../marketing-sdk/server/migrations/002-sessions.mariadb.sql", import.meta.url), "utf8");
        for (const statement of migration.split(";").map(s => s.trim()).filter(Boolean))
          await connection.query(statement);
      }
    } catch (error) {
      connection.destroy();
      await db.pool.end();
      throw error;
    } finally {
      await connection
        .query('SELECT RELEASE_LOCK(CONCAT(DATABASE(), ":marketing-schema"))')
        .catch(() => {});
      connection.release();
    }
    return db;
  }
  prepare(sql: string) {
    return {
      get: async (...args: unknown[]): Promise<Row | undefined> =>
        (await this.rows(sql, args))[0],
      all: async (...args: unknown[]): Promise<Row[]> => this.rows(sql, args),
      run: async (
        ...args: unknown[]
      ): Promise<{
        changes: number;
      }> =>
        this.transaction(async () => {
          if (this.local)
            return {
              changes: Number(
                this.local.prepare(sql).run(...(args as any[])).changes,
              ),
            };
          const query = sql.replace(
            "INSERT OR IGNORE INTO blobs VALUES(?,?,?)",
            "INSERT INTO blobs VALUES(?,?,?) ON DUPLICATE KEY UPDATE digest=VALUES(digest)",
          );
          const [result] = await this.connection().execute<ResultSetHeader>(
            query,
            args.map((v) =>
              v instanceof Uint8Array ? Buffer.from(v) : v,
            ) as any,
          );
          return {
            changes: result.affectedRows,
          };
        }),
    };
  }
  private connection() {
    const ctx = this.context.getStore();
    if (ctx && !ctx.active) throw new Error("transaction_already_finished");
    return ctx?.connection || this.pool!;
  }
  private async rows(sql: string, args: unknown[]): Promise<Row[]> {
    if (this.local) {
      const ctx = this.context.getStore();
      if (ctx && !ctx.active) throw new Error("transaction_already_finished");
      // Reads outside a transaction must not observe another request's uncommitted data.
      if (!ctx) await this.tail;
      return this.local.prepare(sql).all(...(args as any[])) as Row[];
    }
    const [rows] = await this.connection().execute<RowDataPacket[]>(
      sql,
      args as any,
    );
    return rows;
  }
  async transaction<T>(fn: () => T | Promise<T>): Promise<T> {
    const current = this.context.getStore();
    if (current) {
      if (!current.active) throw new Error("transaction_already_finished");
      try {
        return await fn();
      } catch (error) {
        current.failed = true;
        throw error;
      }
    }
    const execute = async () => {
      await this.assertExecutor();
      const connection = this.pool
        ? await this.pool.getConnection()
        : undefined;
      const ctx: Context = {
        connection,
        active: true,
      };
      try {
        if (connection) {
          await connection.beginTransaction();
          await connection.query(
            "SELECT id FROM transaction_guard WHERE id=1 FOR UPDATE",
          );
        } else this.local!.exec("BEGIN IMMEDIATE");
        const result = await this.context.run(ctx, fn);
        if (ctx.failed) throw new Error("transaction_aborted");
        await this.assertExecutor();
        if (connection) await connection.commit();
        else this.local!.exec("COMMIT");
        return result;
      } catch (error) {
        if (connection) await connection.rollback().catch(() => {});
        else this.local!.exec("ROLLBACK");
        throw error;
      } finally {
        ctx.active = false;
        connection?.release();
      }
    };
    if (this.pool) return execute();
    const pending = this.tail.then(execute);
    this.tail = pending.catch(() => {});
    return pending;
  }
  /** Connection-owned server lock. Never reconnect/reacquire after losing it.
   * A new process must recover running effects as unknown before executing. */
  async acquireExecutor(onLost: () => void = () => {}) {
    if (!this.pool) return; // SQLite is a disposable local regression harness only.
    if (this.lost) throw new Error("executor_lock_lost");
    if (this.executor) {
      this.onLost = onLost;
      await this.assertExecutor();
      return;
    }
    const c = await this.pool.getConnection();
    const [rows] = await c.query<RowDataPacket[]>(
      'SELECT CONNECTION_ID() AS id, CONCAT(DATABASE(), ":marketing-executor") AS name, GET_LOCK(CONCAT(DATABASE(), ":marketing-executor"),0) AS acquired',
    );
    if (Number(rows[0]?.acquired) !== 1) {
      c.release();
      throw new Error("executor_unavailable");
    }
    this.executor = c;
    this.executorId = Number(rows[0]!.id);
    this.executorName = String(rows[0]!.name);
    this.onLost = onLost;
    this.heartbeat = setInterval(() => {
      void this.assertExecutor().catch(() => {});
    }, 1000);
    this.heartbeat.unref();
  }
  async assertExecutionOwner() {
    if (this.pool && !this.executor) throw new Error("executor_lock_required");
    await this.assertExecutor();
  }
  async assertExecutor() {
    if (this.lost) throw new Error("executor_lock_lost");
    if (!this.executor) return;
    try {
      const [rows] = await this.executor.query<RowDataPacket[]>(
        {
          sql: "SELECT IS_USED_LOCK(?) AS owner",
          timeout: 3000,
        },
        [this.executorName],
      );
      if (Number(rows[0]?.owner) !== this.executorId)
        throw new Error("executor_lock_lost");
    } catch {
      this.lost = true;
      clearInterval(this.heartbeat);
      this.executor.destroy();
      this.onLost?.();
      throw new Error("executor_lock_lost");
    }
  }
  async close() {
    clearInterval(this.heartbeat);
    await this.tail;
    this.executor?.destroy();
    this.executor = undefined;
    await this.pool?.end();
    this.pool = undefined;
    this.local?.close();
    this.local = undefined;
  }
}
