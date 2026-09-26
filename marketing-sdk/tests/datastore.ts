import mysql from "mysql2/promise";
import { resolve } from "node:path";
import { Store, byteDigest, requireThat } from "../server/store.js";
/** The MariaDB runner owns a fresh socket-only server. Never consume MYSQL_* or DATABASE_URL in tests. */
export async function testStore(path: string) {
  const socket = process.env.MARKETING_TEST_MARIADB_SOCKET;
  if (!socket) return new Store(path);
  const root = process.env.MARKETING_TEST_MARIADB_ROOT;
  requireThat(
    root && resolve(socket) === resolve(root, "mysql.sock"),
    "private_test_socket_required",
  );
  const options = { socketPath: socket, user: "root", charset: "utf8mb4_bin" };
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
