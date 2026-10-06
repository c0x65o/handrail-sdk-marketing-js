/* global process, console, Buffer */
// Fresh socket-only PostgreSQL, never ambient DATABASE_URL/PG* credentials.
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
const bin = process.env.MARKETING_TEST_POSTGRES_BIN || execFileSync("pg_config", ["--bindir"], { encoding: "utf8" }).trim();
const root = await mkdtemp(join(tmpdir(), "pg-"));
const testEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("PG") && key !== "DATABASE_URL"));
let started = false;
try {
  if (Buffer.byteLength(join(root, ".s.PGSQL.5432")) > 107)
    throw new Error("Set TMPDIR to a shorter private writable path for the PostgreSQL socket");
  execFileSync(join(bin, "initdb"), ["-D", join(root, "data"), "-U", "marketing_test", "--auth=trust", "--no-locale", "--encoding=UTF8"], { stdio: "ignore" });
  execFileSync(join(bin, "pg_ctl"), ["-D", join(root, "data"), "-l", join(root, "server.log"), "-o",
    `-k ${root} -h '' -c unix_socket_permissions=0700 -c shared_buffers=32MB -c max_connections=30`, "-w", "start"], { stdio: "ignore" });
  started = true;
  const child = spawn(process.execPath, ["--test", "--test-concurrency=1",
    ...(await readdir(".marketing-build/tests")).filter(s => s.endsWith(".test.js")).sort().map(s => `.marketing-build/tests/${s}`)], {
    stdio: "inherit", env: { ...testEnv, MARKETING_TEST_MARIADB_SOCKET: "",
      MARKETING_TEST_POSTGRES_ROOT: root, MARKETING_TEST_POSTGRES_SOCKET: root },
  });
  const stop = () => child.kill("SIGTERM");
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
  process.exitCode = Number((await once(child, "exit"))[0] ?? 1);
  process.off("SIGTERM", stop); process.off("SIGINT", stop);
} catch (error) {
  console.error(error.message);
  console.error(await readFile(join(root, "server.log"), "utf8").catch(() => ""));
  process.exitCode = 1;
} finally {
  if (started) execFileSync(join(bin, "pg_ctl"), ["-D", join(root, "data"), "-m", "immediate", "-w", "stop"], { stdio: "ignore" });
  await rm(root, { recursive: true, force: true });
}
