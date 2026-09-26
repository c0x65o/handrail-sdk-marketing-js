import { openDatastore } from "./datastore.js";
/** Trusted deployment/bootstrap command. No public HTTP grant creation route.
 * Input is an environment/project scoped Vault credential-file resource.
 * Existing records are never overwritten by this first-use provisioning path.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Store, requireThat } from "../server/store.js";
import type { GenerationGrant, Grant, Role } from "../core/index.js";
interface Provision {
  projects: {
    id: string;
    name: string;
  }[];
  users: {
    username: string;
    password: string;
    memberships: {
      projectId: string;
      role: Role;
    }[];
  }[];
  accountGrants: Grant[];
  generationGrants: GenerationGrant[];
}
export async function provision(store: Store, input: Provision) {
  requireThat(
    input.projects.length > 0 && input.users.length > 0,
    "provisioning_identity_required",
  );
  await store.transaction(async () => {
    requireThat(
      !(await store.db.prepare("SELECT id FROM users LIMIT 1").get()) &&
        !(await store.db.prepare("SELECT id FROM projects LIMIT 1").get()),
      "already_provisioned",
    );
    for (const p of input.projects)
      await store.db
        .prepare("INSERT INTO projects VALUES(?,?)")
        .run(p.id, p.name);
    for (const u of input.users) {
      const uid = await store.createUser(u.username, u.password);
      for (const m of u.memberships)
        await store.db
          .prepare("INSERT INTO memberships VALUES(?,?,?)")
          .run(uid, m.projectId, m.role);
    }
    for (const g of input.accountGrants) {
      requireThat(
        g.revision === 1 &&
          g.secretRef &&
          !g.revokedAt &&
          Date.parse(g.expiresAt) > Date.now(),
        "invalid_account_grant",
      );
      await store.put(g.projectId, "grant", g.id, g);
    }
    for (const g of input.generationGrants) {
      requireThat(
        g.provider !== "fixture" &&
          g.usedJobs === 0 &&
          g.maxJobs > 0 &&
          g.ceiling.minor > 0 &&
          g.billingCapabilityRef,
        "existing_generation_authority_required",
      );
      await store.put(g.projectId, "generationGrant", g.id, g);
    }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  requireThat(
    process.env.MARKETING_MODE === "live" &&
      process.env.MARKETING_PROVISION_PATH,
    "explicit_live_provision_file_required",
  );
  const store = await openDatastore();
  await provision(
    store,
    JSON.parse(readFileSync(process.env.MARKETING_PROVISION_PATH, "utf8")),
  );
  await store.close();
  console.log(
    "Reference-host identities and supplied grants provisioned. No provider calls made.",
  );
}
