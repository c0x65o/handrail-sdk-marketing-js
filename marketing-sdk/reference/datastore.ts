import { Store, requireThat } from "../server/store.js";
/** Only Handrail-generated app MYSQL_* bindings. No DATABASE_URL/control-plane fallback. */
export async function openDatastore(env: NodeJS.ProcessEnv = process.env) {
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
