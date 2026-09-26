/* global process, console, Buffer, setTimeout */
// Disposable local MariaDB only. No Docker, managed resource mutation, or ambient DB credentials.
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import mysql from "mysql2/promise";
for (const binary of ["mariadbd", "mariadb-install-db"]) {
  try {
    execFileSync("sh", ["-c", `command -v ${binary}`], { stdio: "ignore" });
  } catch {
    console.error(
      `UNVERIFIED: disposable MariaDB requires local ${binary}; no shared database fallback.`,
    );
    process.exit(2);
  }
}
const root = await mkdtemp(join(tmpdir(), "mdb-"));
const socket = join(root, "mysql.sock");
if (Buffer.byteLength(socket) > 107) {
  await rm(root, { recursive: true, force: true });
  throw new Error(
    "Set TMPDIR to a writable short private path for the MariaDB socket.",
  );
}
const basedir = process.env.MARKETING_TEST_MARIADB_BASEDIR;
const baseArgs = basedir ? [`--basedir=${basedir}`] : [];
let server;
let child;
const stop = () => {
  child?.kill("SIGTERM");
  server?.kill("SIGTERM");
};
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
try {
  execFileSync(
    "mariadb-install-db",
    [
      "--no-defaults",
      ...baseArgs,
      `--datadir=${join(root, "data")}`,
      "--auth-root-authentication-method=normal",
      "--skip-test-db",
    ],
    { stdio: "ignore" },
  );
  server = spawn(
    "mariadbd",
    [
      "--no-defaults",
      ...baseArgs,
      `--datadir=${join(root, "data")}`,
      `--socket=${socket}`,
      `--pid-file=${join(root, "pid")}`,
      "--skip-networking",
      "--innodb-buffer-pool-size=64M",
      "--max-allowed-packet=134217728",
      `--log-error=${join(root, "error.log")}`,
    ],
    { stdio: "ignore" },
  );
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null)
      throw new Error("Disposable MariaDB exited before readiness");
    try {
      const c = await mysql.createConnection({
        socketPath: socket,
        user: "root",
      });
      await c.end();
      ready = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  if (!ready) throw new Error("Disposable MariaDB readiness timeout");
  const args = process.argv.includes("--browser")
    ? ["marketing-sdk/tests/browser.mjs"]
    : [
        "--test",
        "--test-concurrency=1",
        ...["native-writes", "providers", "service", "store", "sessions"].map(
          (s) => `.marketing-build/tests/${s}.test.js`,
        ),
      ];
  child = spawn(process.execPath, args, {
    cwd: resolve("."),
    stdio: "inherit",
    env: {
      ...process.env,
      MARKETING_TEST_MARIADB_ROOT: root,
      MARKETING_TEST_MARIADB_SOCKET: socket,
    },
  });
  process.exitCode = Number((await once(child, "exit"))[0] ?? 1);
} finally {
  process.off("SIGTERM", stop);
  process.off("SIGINT", stop);
  if (server && server.exitCode === null) {
    const stopped = once(server, "exit");
    server.kill("SIGTERM");
    await stopped;
  }
  await rm(root, { recursive: true, force: true });
}
