import { Store, requireThat } from "../server/store.js";
/** Explicit backend selection; bind only the application's declared resource. */
export async function openDatastore(env: NodeJS.ProcessEnv = process.env) {
  if (env.MARKETING_DATASTORE === "postgres") {
    requireThat(env.MARKETING_DATABASE_URL, "marketing_postgres_environment_required");
    const url = new URL(env.MARKETING_DATABASE_URL);
    requireThat(["postgres:", "postgresql:"].includes(url.protocol), "invalid_postgres_url");
    return Store.postgres({ connectionString: env.MARKETING_DATABASE_URL,
      schema: env.MARKETING_POSTGRES_SCHEMA || "marketing" });
  }
  requireThat(
    env.MARKETING_DATASTORE === "isolated-mariadb",
    "isolated_marketing_datastore_required",
  );
  requireThat(
    env.MYSQL_HOST &&
      env.MYSQL_DATABASE &&
      env.MYSQL_USER &&
      env.MYSQL_PASSWORD,
    "managed_mysql_environment_required",
  );
  const port = Number(env.MYSQL_PORT || 3306);
  requireThat(
    Number.isInteger(port) && port > 0 && port <= 65535,
    "invalid_mysql_port",
  );
  return Store.maria({
    host: env.MYSQL_HOST,
    port,
    database: env.MYSQL_DATABASE,
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    charset: "utf8mb4_bin",
  });
}
