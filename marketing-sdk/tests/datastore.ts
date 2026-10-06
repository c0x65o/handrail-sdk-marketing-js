import mysql from "mysql2/promise";
import pg from "pg";
import { resolve } from "node:path";
import { Store, byteDigest, requireThat } from "../server/store.js";
/** The MariaDB runner owns a fresh socket-only server. Never consume MYSQL_* or DATABASE_URL in tests. */
export async function testStore(path: string) {
  const postgres = await postgresOptions(path);
  if (postgres) return Store.postgres(postgres);
  const socket = process.env.MARKETING_TEST_MARIADB_SOCKET;
  if (!socket) return new Store(path);
  const root = process.env.MARKETING_TEST_MARIADB_ROOT;
  requireThat(
    root && resolve(socket) === resolve(root, "mysql.sock"),
    "private_test_socket_required",
  );
  // Exercise the mysql2 compressed protocol affected by GHSA-rgwj-5xj2-c3m3.
  const options = { socketPath: socket, user: "root", charset: "utf8mb4_bin", compress: true };
  const connection = await mysql.createConnection(options);
  const database = `marketing_test_${byteDigest(Buffer.from(path)).slice(0, 24)}`;
  try {
    const [rows] = await connection.query<any[]>(
      "SELECT @@datadir AS datadir, @@skip_networking AS isolated",
    );
    requireThat(
      Number(rows[0].isolated) === 1 &&
        resolve(rows[0].datadir) === resolve(root, "data"),
      "private_test_database_identity_mismatch",
    );
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`,
    );
  } finally {
    await connection.end();
  }
  return Store.maria({ ...options, database });
}
/** Verify the disposable server identity before creating a private schema. */
export async function postgresOptions(path: string) {
  const socket = process.env.MARKETING_TEST_POSTGRES_SOCKET;
  if (!socket) return null;
  const root = process.env.MARKETING_TEST_POSTGRES_ROOT;
  requireThat(root && resolve(root) === resolve(socket), "private_test_socket_required");
  const options = { host: socket, user: "marketing_test", database: "postgres", port: 5432, ssl: false, password: () => "",
    schema: `marketing_test_${byteDigest(Buffer.from(path)).slice(0, 24)}` };
  const c = new pg.Client(options);
  await c.connect();
  try {
    const { rows } = await c.query("SELECT current_setting('data_directory') AS dir, current_setting('listen_addresses') AS listen");
    requireThat(resolve(rows[0].dir) === resolve(root, "data") && rows[0].listen === "", "private_test_database_identity_mismatch");
  } finally { await c.end(); }
  return options;
}
