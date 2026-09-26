import { testStore } from "./datastore.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type {
  Asset,
  Campaign,
  GenerationGrant,
  GenerationJob,
  Grant,
} from "../core/index.js";
import {
  providerPlan,
  NativeProvider,
  summarizeMetrics,
} from "../server/providers.js";
import { publicAddress } from "../server/destination.js";
import { GoogleAdsClient } from "../server/google.js";
import { NativeGeneration } from "../server/generation.js";
import { digest } from "../server/store.js";
import { BoundGenerationBilling } from "../server/billing.js";
import { createCredentialCipher } from "../support/vault-crypto.js";
import { HostAgent } from "../server/agent.js";
test("native image transport retains request and byte identities without retrying an unknown submission", async () => {
  const bytes = readFileSync(
    new URL(
      "../../marketing-sdk/tests/fixtures/test-pattern.png",
      import.meta.url,
    ),
  );
  const grant: GenerationGrant = {
    id: "image-grant",
    projectId: "p",
    provider: "openai",
    model: "gpt-image-2.5-flare",
    kind: "image",
    maxJobs: 2,
    usedJobs: 0,
    maxSeconds: 0,
    size: "1024x1024",
    expiresAt: "2099-01-01T00:00:00Z",
    revokedAt: null,
    ceiling: {
      currency: "USD",
      minor: 100,
    },
    billingCapabilityRef: "test-only-binding",
  };
  const job: GenerationJob = {
    id: "image-job",
    projectId: "p",
    campaignId: "c",
    grantId: grant.id,
    kind: "image",
    prompt: "Explicit HTTP fixture",
    promptDigest: "fixture",
    parentAssetIds: [],
    rightsReceipt: "fixture-rights",
    state: "running",
    providerRequestId: null,
    assetId: null,
    reason: null,
    createdAt: new Date().toISOString(),
  };
  let calls = 0,
    retained = "";
  const adapter = new NativeGeneration(
    async (_provider, _project, id) => {
      assert.equal(id, grant.id);
      return "fixture-secret";
    },
    {
      authorize: async () => {},
    },
    async (url, init) => {
      calls++;
      assert.equal(String(url), "https://api.openai.com/v1/images/generations");
      assert.equal(JSON.parse(String(init?.body)).model, grant.model);
      return Response.json(
        {
          data: [
            {
              b64_json: bytes.toString("base64"),
            },
          ],
        },
        {
          headers: {
            "x-request-id": "fixture-image-request",
          },
        },
      );
    },
  );
  const output = await adapter.submit(job, grant, (id) => {
    retained = id;
  });
  assert.equal(retained, "fixture-image-request");
  assert.equal(output.state, "retained");
  assert.deepEqual(Buffer.from(output.bytes!), bytes);
  assert.equal(calls, 1);
  const failing = new NativeGeneration(
    async () => "fixture-secret",
    {
      authorize: async () => {},
    },
    async () => {
      calls++;
      throw new Error("lost response after provider may have accepted");
    },
  );
  await assert.rejects(async () => await failing.submit(job, grant, () => {}));
  assert.equal(calls, 2);
  assert.equal(
    (
      await failing.reconcile(
        {
          ...job,
          providerRequestId: retained,
        },
        grant,
      )
    ).state,
    "unknown",
  );
  assert.equal(calls, 2);
});
const g: Grant = {
  id: "g",
  projectId: "p",
  revision: 1,
  provider: "meta",
  accountId: "act_123",
  label: "Test",
  currency: "USD",
  timezone: "America/Chicago",
  permissions: ["setup", "prepare", "activate", "pause", "report"],
  expiresAt: "2099-01-01T00:00:00Z",
  revokedAt: null,
  secretRef: "secret-ref",
  pageId: "42",
  organizationId: "43",
};
const c: Campaign = {
  id: "c",
  projectId: "p",
  revision: 1,
  grantId: "g",
  creativeSetId: "cs",
  state: "draft",
  receipt: null,
  material: {
    name: "Desk",
    headline: "Calm desk",
    body: "Explore a calm desk.",
    destination: "https://example.com/desk",
    destinationDigest: "a".repeat(64),
    assetIds: ["a"],
    audience: {
      provider: "meta",
      locations: ["US"],
      ageMin: 25,
      ageMax: 54,
      expansion: false,
    },
    budget: {
      currency: "USD",
      minor: 42000,
    },
    startAt: "2026-10-08T05:00:00Z",
    endAt: "2026-10-15T05:00:00Z",
    timezone: "America/Chicago",
  },
};
const asset: Asset = {
  id: "a",
  projectId: "p",
  campaignId: "c",
  version: 1,
  kind: "image",
  digest: "b".repeat(64),
  mime: "image/png",
  width: 1080,
  height: 1350,
  seconds: null,
  jobId: null,
  source: "uploaded",
  rightsReceipt: "rights",
  parentAssetIds: [],
};
function googleCampaign() {
  return {
    ...structuredClone(c),
    material: {
      ...structuredClone(c.material),
      assetIds: [],
      searchHeadlines: [
        "Calm desk",
        "Explore a new desk",
        "Make room for work",
      ],
      searchDescriptions: ["Explore the kit.", "See what fits your workspace."],
      audience: {
        provider: "google" as const,
        locations: ["geoTargetConstants/2840"],
        keywords: ["desk kit"],
        expansion: false as const,
      },
    },
  };
}
test("provider-specific mappings: no silent targeting translation; hard total budgets and paused objects", () => {
  const meta: any = providerPlan(c, g, [asset]);
  assert.equal(meta.adset.lifetime_budget, "42000");
  assert.equal(meta.campaign.status, "PAUSED");
  assert.deepEqual(meta.adset.targeting.facebook_positions, ["feed"]);
  assert.equal(meta.adset.targeting.targeting_automation.advantage_audience, 0);
  const google: any = providerPlan(
    googleCampaign(),
    {
      ...g,
      provider: "google",
      accountId: "123",
    },
    [],
  );
  assert.equal(
    google.operations[0].campaignBudgetOperation.create.period,
    "CUSTOM_PERIOD",
  );
  assert.equal(
    google.operations[0].campaignBudgetOperation.create.totalAmountMicros,
    "420000000",
  );
  assert.equal(google.operations[1].campaignOperation.create.status, "PAUSED");
  assert.equal(
    google.operations[1].campaignOperation.create.startDateTime,
    "2026-10-08 00:00:00",
  );
  assert.equal(
    google.operations[1].campaignOperation.create.networkSettings
      .targetSearchNetwork,
    false,
  );
  const li: any = providerPlan(
    {
      ...c,
      material: {
        ...c.material,
        audience: {
          provider: "linkedin",
          locations: ["urn:li:geo:103644278"],
          jobTitles: ["urn:li:title:1"],
          expansion: false,
        },
      },
    },
    {
      ...g,
      provider: "linkedin",
      accountId: "123",
    },
    [asset],
  );
  assert.equal(li.group.totalBudgetCents, 42000);
  assert.equal(li.campaign.audienceExpansionEnabled, false);
  assert.deepEqual(
    li.campaign.targetingCriteria.include.and[0].or[
      "urn:li:adTargetingFacet:locations"
    ],
    ["urn:li:geo:103644278"],
  );
  assert.throws(
    () =>
      providerPlan(
        c,
        {
          ...g,
          provider: "google",
        },
        [asset],
      ),
    /search_headlines_required|unsupported_targeting/,
  );
  assert.throws(
    () =>
      providerPlan(
        {
          ...c,
          material: {
            ...c.material,
            audience: {
              ...c.material.audience,
              expansion: true,
            } as never,
          },
        },
        g,
        [asset],
      ),
    /unsupported_targeting/,
  );
  assert.throws(
    () =>
      providerPlan(c, g, [
        {
          ...asset,
          kind: "video",
        },
      ]),
    /single_image_required/,
  );
});
test("Google actual REST transport: OAuth, optional manager, v25, validate-only, no token echo, no retries", async () => {
  const requests: {
    url: string;
    init: RequestInit;
  }[] = [];
  const client = new GoogleAdsClient(
    async () => "sensitive-token",
    "987",
    async (url, init) => {
      requests.push({
        url: String(url),
        init: init!,
      });
      return new Response(
        JSON.stringify([
          {
            results: [
              {
                customer: {
                  id: "123",
                  status: "ENABLED",
                  manager: false,
                  currencyCode: "USD",
                  timeZone: "America/Chicago",
                },
              },
            ],
          },
        ]),
        {
          status: 200,
        },
      );
    },
  );
  const account = await client.verify("123");
  assert.equal(account.id, "123");
  assert.match(
    requests[0]!.url,
    /v25\/customers\/123\/googleAds:searchStream$/,
  );
  assert.equal((requests[0]!.init.headers as any)["login-customer-id"], "987");
  assert.equal(
    (requests[0]!.init.headers as any)["developer-token"],
    undefined,
  );
  await client.mutate(
    "123",
    [
      {
        campaignOperation: {
          create: {
            status: "PAUSED",
          },
        },
      },
    ],
    true,
  );
  assert.equal(JSON.parse(requests[1]!.init.body as string).validateOnly, true);
  let calls = 0;
  const denied = new GoogleAdsClient(
    async () => "secret",
    undefined,
    async () => {
      calls++;
      return new Response("secret-provider-body", {
        status: 403,
      });
    },
  );
  await assert.rejects(
    async () => await denied.verify("123"),
    (e) =>
      String(e).includes("google_authorization_required") &&
      !String(e).includes("secret"),
  );
  assert.equal(calls, 1);
  await assert.rejects(
    async () => await client.request("https://evil.example/steal"),
    /invalid_google_path/,
  );
});
test("native Meta and LinkedIn verification reuse existing clients and filter effective capabilities", async () => {
  const directory = mkdtempSync(join(tmpdir(), "marketing-provider-"));
  const store = await testStore(join(directory, "db.sqlite"));
  await store.db.prepare("INSERT INTO projects VALUES(?,?)").run("p", "test");
  try {
    const vault = {
      use: async (_grant: Grant, fn: any) =>
        fn({
          accessToken: "never-export-token",
          clientId: "client",
          clientSecret: "never-export-secret",
        }),
    };
    const meta = new NativeProvider("meta", vault, store, async (url) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/me/permissions"))
        return Response.json({
          data: [
            {
              permission: "ads_management",
              status: "granted",
            },
          ],
        });
      if (path.endsWith("/42"))
        return Response.json({
          id: "42",
          name: "Page",
        });
      return Response.json({
        id: "act_123",
        currency: "USD",
        timezone_name: "America/Chicago",
        funding_source_details: {
          id: "f",
        },
      });
    });
    const verified = await meta.verify(g);
    assert.ok(verified.permissions.includes("activate"));
    assert.ok(!JSON.stringify(verified).includes("never-export"));
    const li = new NativeProvider("linkedin", vault, store, async (url) => {
      if (String(url).includes("introspectToken"))
        return Response.json({
          active: true,
          scope:
            "rw_ads r_ads_reporting w_organization_social r_organization_social",
          expires_at: 9999999999,
        });
      return Response.json({
        id: "123",
        currency: "USD",
        timeZone: "America/Chicago",
        reference: "urn:li:organization:43",
        servingStatuses: ["RUNNABLE"],
        status: "ACTIVE",
      });
    });
    const linked = await li.verify({
      ...g,
      provider: "linkedin",
      accountId: "123",
    });
    assert.ok(linked.permissions.includes("activate"));
  } finally {
    await store.close();
    rmSync(directory, {
      recursive: true,
      force: true,
    });
  }
});
test("native video adapter: durable request ID callback before polling, bounded download, playable byte retention", async () => {
  const grant: GenerationGrant = {
    id: "gg",
    projectId: "p",
    provider: "xai",
    model: "grok-imagine-video-1.5",
    kind: "video",
    maxJobs: 1,
    usedJobs: 1,
    maxSeconds: 1,
    size: "1280x720",
    expiresAt: "2099-01-01T00:00:00Z",
    revokedAt: null,
    ceiling: {
      currency: "USD",
      minor: 100,
    },
    billingCapabilityRef: "test-existing-authority",
  };
  const job: GenerationJob = {
    id: "j",
    projectId: "p",
    campaignId: "c",
    grantId: "gg",
    kind: "video",
    prompt: "Test",
    promptDigest: digest("Test"),
    parentAssetIds: [],
    rightsReceipt: "test",
    state: "queued",
    providerRequestId: null,
    assetId: null,
    reason: null,
    createdAt: new Date().toISOString(),
  };
  const requests: string[] = [];
  let retained: string | null = null;
  let authorized = 0;
  const bytes = readFileSync(
    new URL(
      "../../marketing-sdk/tests/fixtures/test-pattern.mp4",
      import.meta.url,
    ),
  );
  const adapter = new NativeGeneration(
    async () => "sensitive",
    {
      authorize: async () => {
        authorized++;
      },
    },
    async (url, init) => {
      requests.push(String(url));
      if (String(url).endsWith("/generations"))
        return Response.json({
          request_id: "request-1",
        });
      if (String(url).includes("/videos/request-1"))
        return Response.json({
          status: "done",
          video: {
            url: "https://vidgen.x.ai/output.mp4",
          },
        });
      assert.equal(init?.headers, undefined);
      return new Response(bytes, {
        status: 200,
      });
    },
  );
  const output = await adapter.submit(job, grant, (id) => {
    retained = id;
  });
  assert.equal(retained, "request-1");
  assert.equal(output.state, "processing");
  assert.equal(authorized, 1);
  const result = await adapter.reconcile(
    {
      ...job,
      providerRequestId: retained,
    },
    grant,
  );
  assert.equal(result.state, "retained");
  assert.equal(result.mime, "video/mp4");
  assert.equal(result.seconds, 1);
  assert.equal(requests.length, 3);
  const bad = new NativeGeneration(
    async () => "sensitive",
    {
      authorize: async () => {},
    },
    async () =>
      Response.json({
        status: "done",
        video: {
          url: "https://169.254.169.254/credentials",
        },
      }),
  );
  await assert.rejects(
    async () =>
      await bad.reconcile(
        {
          ...job,
          providerRequestId: "request-1",
        },
        grant,
      ),
    /untrusted_media_download/,
  );
  assert.throws(
    () =>
      adapter.validate({
        ...grant,
        provider: "openai",
        model: "sora-2",
      }),
    /generation_provider_unavailable/,
  );
});
test("billing authority separate from advertising, atomic ceiling reservation and no replay refund", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marketing-billing-"));
  const store = await testStore(join(dir, "db.sqlite"));
  await store.db.prepare("INSERT INTO projects VALUES(?,?)").run("p", "test");
  const grant: GenerationGrant = {
    id: "g",
    projectId: "p",
    provider: "openai",
    model: "gpt-image-2",
    kind: "image",
    maxJobs: 3,
    usedJobs: 0,
    maxSeconds: 0,
    size: "1024x1024",
    expiresAt: "2099-01-01T00:00:00Z",
    revokedAt: null,
    ceiling: {
      currency: "USD",
      minor: 10,
    },
    billingCapabilityRef: "existing-grant-ref",
  };
  await store.put("p", "generationGrant", "g", grant);
  const path = join(dir, "private.json");
  writeFileSync(
    path,
    JSON.stringify([
      {
        projectId: "p",
        grantId: "g",
        provider: "openai",
        model: grant.model,
        capabilityRef: grant.billingCapabilityRef,
        apiKey: "test-secret",
        expiresAt: grant.expiresAt,
        currency: "USD",
        maxUnitMinor: 6,
        quoteReceipt: "fixture-not-a-real-price",
      },
    ]),
    {
      mode: 0o600,
    },
  );
  try {
    const billing = new BoundGenerationBilling(store, path);
    await billing.authorize(grant, {
      id: "j",
    } as GenerationJob);
    await assert.rejects(
      async () =>
        await billing.authorize(grant, {
          id: "j",
        } as GenerationJob),
      /already_reserved/,
    );
    await assert.rejects(
      async () =>
        await billing.authorize(grant, {
          id: "j2",
        } as GenerationJob),
      /ceiling_exceeded/,
    );
    await assert.rejects(
      async () =>
        await billing.authorize(
          {
            ...grant,
            billingCapabilityRef: "ad-authority",
          },
          {
            id: "j3",
          } as GenerationJob,
        ),
      /binding_mismatch/,
    );
  } finally {
    await store.close();
    rmSync(dir, {
      recursive: true,
      force: true,
    });
  }
});
test("provider-hosted human takeover: actor-bound state, encrypted credentials and replay denial", async () => {
  const key = randomBytes(32);
  const dir = mkdtempSync(join(tmpdir(), "marketing-oauth-"));
  const store = await testStore(join(dir, "db.sqlite"));
  await store.db.prepare("INSERT INTO projects VALUES(?,?)").run("p", "test");
  const actor = {
    userId: await store.createUser("human", ""),
  };
  await store.db
    .prepare("INSERT INTO memberships VALUES(?,?,?)")
    .run(actor.userId, "p", "admin");
  await store.put("p", "grant", "g", {
    ...g,
    provider: "google",
    accountId: "123",
  });
  try {
    const host = new HostAgent(
      store,
      "https://marketing.example",
      {
        google: {
          clientId: "client",
          clientSecret: "application-secret",
        },
      },
      createCredentialCipher("test", () => key),
      async () =>
        Response.json({
          access_token: "provider-secret",
          expires_in: 3600,
          refresh_token: "refresh-secret",
        }),
    );
    const url = new URL(await host.begin(actor, "p", "g"));
    assert.equal(url.origin, "https://accounts.google.com");
    assert.equal(await url.searchParams.get("code_challenge_method"), "S256");
    const state = (await url.searchParams.get("state"))!;
    await host.complete(actor, "p", "google", state, "private-code");
    assert.ok(
      !JSON.stringify(await store.list("p", "vault")).includes(
        "provider-secret",
      ),
    );
    await assert.rejects(
      async () =>
        await host.complete(actor, "p", "google", state, "private-code"),
      /oauth_state_invalid/,
    );
    const result = await host.use(
      {
        ...g,
        provider: "google",
        accountId: "123",
      },
      async (credentials) => credentials.accessToken === "provider-secret",
    );
    assert.equal(result, true);
  } finally {
    await store.close();
    rmSync(dir, {
      recursive: true,
      force: true,
    });
  }
});
test("missing provider fields remain null and snapshot fetch rejects private or reserved addresses", () => {
  assert.deepEqual(
    summarizeMetrics(
      [],
      {
        impressions: "i",
        clicks: "c",
        spend: "s",
      },
      100,
    ),
    {
      impressions: null,
      clicks: null,
      spendMinor: null,
      providerConversions: null,
    },
  );
  assert.deepEqual(
    summarizeMetrics(
      [
        {
          i: 0,
          c: 0,
          s: 0,
        },
      ],
      {
        impressions: "i",
        clicks: "c",
        spend: "s",
      },
      100,
    ),
    {
      impressions: 0,
      clicks: 0,
      spendMinor: 0,
      providerConversions: null,
    },
  );
  for (const a of [
    "127.0.0.1",
    "169.254.169.254",
    "10.0.0.1",
    "172.16.0.2",
    "192.168.1.1",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "::ffff:127.0.0.1",
    "fd00::1",
    "fe80::1",
  ])
    assert.equal(publicAddress(a), false, a);
  assert.equal(publicAddress("8.8.8.8"), true);
});
