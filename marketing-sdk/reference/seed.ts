import { openDatastore } from "./datastore.js";
import { Store, requireThat } from "../server/store.js";
import type { Grant, GenerationGrant } from "../core/index.js";
export async function seedQa(
  store: Store,
  credentials: {
    username: string;
    password: string;
    analystPassword?: string;
  },
) {
  requireThat(
    credentials.username && typeof credentials.password === "string",
    "seed_credentials_required",
  );
  await store.transaction(async () => {
    if (
      (await store.db.prepare("SELECT id FROM users LIMIT 1").get()) ||
      (await store.db.prepare("SELECT id FROM projects LIMIT 1").get())
    )
      return;
    const admin = await store.createUser(
      credentials.username,
      credentials.password,
    );
    await store.db
      .prepare("INSERT INTO projects VALUES(?,?)")
      .run("qa-alpha", "Fieldwork · QA Alpha");
    await store.db
      .prepare("INSERT INTO projects VALUES(?,?)")
      .run("qa-beta", "Isolation · QA Beta");
    await store.db
      .prepare("INSERT INTO memberships VALUES(?,?,?)")
      .run(admin, "qa-alpha", "admin");
    if (credentials.analystPassword !== undefined) {
      const analyst = await store.createUser(
        `${credentials.username}.analyst`,
        credentials.analystPassword,
      );
      await store.db
        .prepare("INSERT INTO memberships VALUES(?,?,?)")
        .run(analyst, "qa-alpha", "analyst");
    }
    for (const project of ["qa-alpha", "qa-beta"]) {
      for (const provider of ["meta", "google", "linkedin"] as const) {
        const grant: Grant = {
          id: `${provider}-qa`,
          projectId: project,
          revision: 1,
          provider,
          accountId: provider === "meta" ? "act_123456" : "123456",
          label: `${provider} fixture account`,
          currency: "USD",
          timezone: provider === "linkedin" ? "UTC" : "America/Chicago",
          permissions: ["setup", "prepare", "activate", "pause", "report"],
          expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
          revokedAt: null,
          secretRef: `fixture:${project}:${provider}`,
          pageId: "987654",
          organizationId: "987654",
          ...(provider === "linkedin" ? { targetingOptions: [{ kind: "locations" as const, id: "urn:li:geo:103644278", label: "United States (fixture)" }] } : {}),
        };
        await store.put(project, "grant", grant.id, grant);
      }
      for (const kind of ["image", "video"] as const) {
        const grant: GenerationGrant = {
          id: `fixture-${kind}`,
          projectId: project,
          provider: "fixture",
          model: "deterministic-test-pattern",
          kind,
          maxJobs: 100,
          usedJobs: 0,
          maxSeconds: 1,
          size: "320x180",
          expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
          revokedAt: null,
          ceiling: {
            currency: "USD",
            minor: 0,
          },
          billingCapabilityRef: "fixture-no-paid-authority",
        };
        await store.put(project, "generationGrant", grant.id, grant);
      }
      await store.put(project, "firstPartyCoverage", "fixture-window", {
        from: "2020-01-01T00:00:00Z",
        until: "2100-01-01T00:00:00Z",
        source: "fixture",
      });
    }
  });
}
export async function bootstrapFixture(store: Store, env: NodeJS.ProcessEnv) {
  if (env.MARKETING_BOOTSTRAP !== "staging-fixture") return;
  requireThat(
    env.APP_ENV === "staging" && env.MARKETING_MODE === "fixture",
    "staging_fixture_bootstrap_only",
  );
  requireThat(
    env.HANDRAIL_FIXTURE_QA_USERNAME && env.HANDRAIL_FIXTURE_QA_PASSWORD,
    "protected_qa_environment_required",
  );
  await seedQa(store, {
    username: env.HANDRAIL_FIXTURE_QA_USERNAME,
    password: env.HANDRAIL_FIXTURE_QA_PASSWORD,
  });
}
if (process.argv[1]?.endsWith("/seed.js")) {
  const store = await openDatastore();
  try {
    await bootstrapFixture(store, process.env);
  } finally {
    await store.close();
  }
}
