import { testStore } from "./datastore.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digest } from "../server/store.js";
import { MarketingServer } from "../server/service.js";
import {
  FixtureAgent,
  FixtureGeneration,
  FixtureProvider,
} from "../server/fixtures.js";
import { seedQa } from "../reference/seed.js";
import type {
  Campaign,
  GenerationGrant,
  Grant,
  Material,
  Operation,
  Setup,
} from "../core/index.js";
import { inspectMedia } from "../server/generation.js";
import { createHost } from "../reference/host.js";
import { createMarketingClient } from "../core/index.js";
import { agentTools } from "../agent/index.js";
import { spawn } from "node:child_process";
import { once } from "node:events";
const time = Date.now();
test("generation byte validation fences MIME mismatch and malformed output without resubmission", async () => {
  for (const malformed of [false, true]) {
    const t = await setupTest();
    try {
      const c = await t.service.saveCampaign(t.admin, "qa-alpha", { grantId: "meta-qa", material: sampleMaterial() });
      const input = { campaignId: c.id, grantId: "fixture-image", prompt: "Fixture", rightsReceipt: "test", parentAssetIds: [], requestKey: "media" };
      let calls = 0;
      // A narrow generation boundary fake, with the real Store and service below it.
      t.generation.submit = async (_job, _grant, retain) => {
        calls++;
        await retain("retained-test-request");
        return { state: "retained", requestId: "retained-test-request",
          bytes: malformed ? Buffer.from("private provider diagnostic") : readFileSync(new URL("../../marketing-sdk/tests/fixtures/test-pattern.png", import.meta.url)),
          mime: malformed ? "image/png" : "image/jpeg", width: 1, height: 1 };
      };
      const job = await t.service.generate(t.admin, "qa-alpha", input);
      const result = await t.service.dispatchGeneration("qa-alpha", job.id);
      assert.equal(result.state, "unknown");
      assert.equal(result.providerRequestId, "retained-test-request");
      assert.equal(result.assetId, null);
      assert.equal((await t.store.list("qa-alpha", "asset")).length, 0);
      assert.ok(!JSON.stringify(result).includes("private provider"));
      assert.equal((await t.service.generate(t.admin, "qa-alpha", input)).id, job.id);
      await assert.rejects(t.service.generate(t.admin, "qa-alpha", { ...input, requestKey: "new" }), /generation_pending/);
      await t.service.dispatchGeneration("qa-alpha", job.id);
      assert.equal(calls, 1);
    } finally { await t.close(); }
  }
});

test("generation reconciliation rechecks current grant and project authority before contacting the provider", async () => {
  const t = await setupTest();
  try {
    const c = await t.service.saveCampaign(t.admin, "qa-alpha", { grantId: "meta-qa", material: sampleMaterial() });
    t.generation.fault = "processing";
    const job = await t.service.generate(t.admin, "qa-alpha", { campaignId: c.id, grantId: "fixture-image", prompt: "Fixture", rightsReceipt: "test", parentAssetIds: [], requestKey: "reconcile" });
    await t.service.dispatchGeneration("qa-alpha", job.id);
    const grant = await t.store.get<GenerationGrant>("qa-alpha", "generationGrant", job.grantId);
    let calls = 0;
    const reconcile = t.generation.reconcile.bind(t.generation);
    t.generation.reconcile = async (...args) => { calls++; return reconcile(...args); };
    await assert.rejects(t.service.reconcileGeneration(t.analyst, "qa-alpha", { jobId: job.id }), /forbidden/);
    await assert.rejects(t.service.reconcileGeneration(t.admin, "qa-beta", { jobId: job.id }), /forbidden/);
    for (const unavailable of [{ ...grant, revokedAt: new Date().toISOString() }, { ...grant, expiresAt: "2000-01-01T00:00:00Z" }]) {
      await t.store.put("qa-alpha", "generationGrant", grant.id, unavailable);
      await assert.rejects(t.service.reconcileGeneration(t.admin, "qa-alpha", { jobId: job.id }), /generation_grant_unavailable/);
    }
    assert.equal(calls, 0);
    await t.store.put("qa-alpha", "generationGrant", grant.id, grant);
    assert.equal((await t.service.reconcileGeneration(t.admin, "qa-alpha", { jobId: job.id })).state, "retained");
    assert.equal(calls, 1);
  } finally { await t.close(); }
});
export async function setupTest() {
  const dir = mkdtempSync(join(tmpdir(), "marketing-sdk-test-")),
    path = join(dir, "test.sqlite");
  let store = await testStore(path);
  await store.db.acquireExecutor();
  await seedQa(store, {
    username: "qa",
    password: "test-only-randomized-in-browser",
    analystPassword: "a",
  });
  const admin = {
    userId: String(
      (await store.db.prepare("SELECT id FROM users WHERE login=?").get("qa"))!
        .id,
    ),
  };
  const analyst = {
    userId: String(
      (await store.db
        .prepare("SELECT id FROM users WHERE login=?")
        .get("qa.analyst"))!.id,
    ),
  };
  const agent = {
    userId: await store.createUser("agent", "unused", "agent"),
  };
  await store.db
    .prepare("INSERT INTO memberships VALUES(?,?,?)")
    .run(agent.userId, "qa-alpha", "admin");
  let provider = new FixtureProvider(store),
    generation = new FixtureGeneration();
  let clock = time;
  let service = new MarketingServer(
    store,
    {
      meta: provider,
      google: provider,
      linkedin: provider,
    },
    generation,
    new FixtureAgent(store),
    "fixture",
    () => clock,
  );
  const reset = async () => {
    await store.close();
    store = await testStore(path);
    await store.db.acquireExecutor();
    provider = new FixtureProvider(store);
    generation = new FixtureGeneration();
    service = new MarketingServer(
      store,
      {
        meta: provider,
        google: provider,
        linkedin: provider,
      },
      generation,
      new FixtureAgent(store),
      "fixture",
      () => clock,
    );
    await service.recover();
  };
  return {
    get store() {
      return store;
    },
    get service() {
      return service;
    },
    get provider() {
      return provider;
    },
    get generation() {
      return generation;
    },
    admin,
    analyst,
    agent,
    dir,
    path,
    reset,
    advance: (ms: number) => {
      clock += ms;
    },
    close: async () => {
      await store.close();
      rmSync(dir, {
        recursive: true,
        force: true,
      });
    },
  };
}
export function sampleMaterial(): Material {
  return {
    name: "Desk kit",
    headline: "Room to think",
    body: "Explore the desk kit.",
    destination: "https://fieldwork.example/kit",
    destinationDigest: digest("fixture destination"),
    assetIds: [],
    audience: {
      provider: "meta",
      locations: ["US"],
      ageMin: 25,
      ageMax: 54,
      expansion: false,
    },
    budget: {
      currency: "USD",
      minor: 4200,
    },
    startAt: new Date(time + 3600000).toISOString(),
    endAt: new Date(time + 7 * 86400000).toISOString(),
    timezone: "America/Chicago",
  };
}
async function ready(
  t: Awaited<ReturnType<typeof setupTest>>,
  provider = "meta",
) {
  const s = await t.service.setup(t.admin, "qa-alpha", {
    grantId: `${provider}-qa`,
    requestKey: `setup-${provider}`,
  });
  assert.equal(s.state, "waiting_human");
  await t.store.put("qa-alpha", "fixtureTakeover", s.id, {
    setupId: s.id,
  });
  const verified = await t.service.resumeSetup(t.admin, "qa-alpha", {
    setupId: s.id,
    expectedRevision: s.revision,
  });
  assert.equal(verified.state, "ready");
  return verified;
}
async function campaign(
  t: Awaited<ReturnType<typeof setupTest>>,
): Promise<Campaign> {
  let c = await t.service.saveCampaign(t.admin, "qa-alpha", {
    grantId: "meta-qa",
    material: sampleMaterial(),
  });
  const job = await t.service.generate(t.admin, "qa-alpha", {
    campaignId: c.id,
    grantId: "fixture-image",
    prompt: "Fixture",
    rightsReceipt: "test rights",
    parentAssetIds: [],
    requestKey: "image",
  });
  const complete = await t.service.dispatchGeneration("qa-alpha", job.id);
  assert.equal(complete.state, "retained");
  c = await t.service.saveCampaign(t.admin, "qa-alpha", {
    id: c.id,
    expectedRevision: c.revision,
    grantId: c.grantId,
    material: {
      ...c.material,
      assetIds: [complete.assetId!],
    },
  });
  return c;
}
async function prepared(t: Awaited<ReturnType<typeof setupTest>>) {
  await ready(t);
  const c = await campaign(t);
  const o = await t.service.prepare(t.admin, "qa-alpha", {
    campaignId: c.id,
    requestKey: "prepare",
  });
  const result = await t.service.dispatch("qa-alpha", o.id);
  assert.equal(result.state, "succeeded");
  return await t.store.get<Campaign>("qa-alpha", "campaign", c.id);
}
test("durable SQLite workflow: setup takeover, restart, image, paused preparation, one human gate and replay", async () => {
  const t = await setupTest();
  try {
    const s = await t.service.setup(t.admin, "qa-alpha", {
      grantId: "meta-qa",
      requestKey: "setup-meta",
    });
    await t.reset();
    assert.equal(
      (await t.store.get<Setup>("qa-alpha", "setup", s.id)).state,
      "waiting_human",
    );
    await t.store.put("qa-alpha", "fixtureTakeover", s.id, {
      setupId: s.id,
    });
    await t.service.resumeSetup(t.admin, "qa-alpha", {
      setupId: s.id,
      expectedRevision: s.revision,
    });
    const c = await campaign(t);
    const o = await t.service.prepare(t.admin, "qa-alpha", {
      campaignId: c.id,
      requestKey: "prepare",
    });
    await t.reset();
    assert.equal(
      (await t.service.dispatch("qa-alpha", o.id)).state,
      "succeeded",
    );
    const packet = await t.service.packet(t.admin, "qa-alpha", {
      campaignId: c.id,
    });
    await assert.rejects(
      async () =>
        await t.service.execute(t.admin, "qa-alpha", {
          packetId: packet.id,
          digest: packet.digest,
          requestKey: "launch",
        }),
      /human_authorization/,
    );
    await assert.rejects(
      async () =>
        await t.service.decide(t.agent, "qa-alpha", {
          packetId: packet.id,
          digest: packet.digest,
          decision: "approved",
        }),
      /forbidden/,
    );
    await t.service.decide(t.admin, "qa-alpha", {
      packetId: packet.id,
      digest: packet.digest,
      decision: "approved",
    });
    const launch = await t.service.execute(t.admin, "qa-alpha", {
      packetId: packet.id,
      digest: packet.digest,
      requestKey: "launch",
    });
    await t.reset();
    assert.equal(
      (await t.service.dispatch("qa-alpha", launch.id)).receipt?.intent,
      "enabled",
    );
    const replay = await t.service.execute(t.admin, "qa-alpha", {
      packetId: packet.id,
      digest: packet.digest,
      requestKey: "launch",
    });
    assert.equal(replay.id, launch.id);
    assert.equal(replay.state, "succeeded");
    assert.equal((await t.store.list("qa-alpha", "fixtureEffect")).length, 1);
    assert.equal(
      (await t.store.list<Campaign>("qa-alpha", "campaign"))[0]!.creativeSetId,
      c.creativeSetId,
    );
  } finally {
    await t.close();
  }
});
test("project isolation, role denial, secret references omitted, forged roles rejected, transcript permission enforced", async () => {
  const t = await setupTest();
  try {
    await assert.rejects(
      async () => await t.service.workspace(t.admin, "qa-beta"),
      /forbidden/,
    );
    await assert.rejects(
      async () =>
        await t.service.saveCampaign(t.analyst, "qa-alpha", {
          grantId: "meta-qa",
          material: sampleMaterial(),
        }),
      /forbidden/,
    );
    await assert.rejects(
      async () =>
        await t.service.conversations(t.analyst, "qa-alpha", {
          campaignId: "guess",
        }),
      /forbidden/,
    );
    const output = JSON.stringify(
      await t.service.workspace(t.admin, "qa-alpha"),
    );
    assert.ok(!output.includes("secretRef"));
    assert.ok(!output.includes("billingCapabilityRef"));
    await assert.rejects(
      async () =>
        await t.service.call(t.admin, "qa-alpha", "workspace", {
          role: "admin",
        } as never),
      /unexpected_fields/,
    );
    await assert.rejects(
      async () =>
        await t.service.call(
          t.admin,
          "qa-alpha",
          "dispatch" as never,
          {} as never,
        ),
      /unknown_command/,
    );
  } finally {
    await t.close();
  }
});
for (const change of [
  "budget",
  "targeting",
  "copy",
  "expired",
  "revoked",
  "grantRevision",
  "grantExpiry",
  "actorRole",
] as const)
  test(`execution boundary rejects ${change}`, async () => {
    const t = await setupTest();
    try {
      const c = await prepared(t),
        packet = await t.service.packet(t.admin, "qa-alpha", {
          campaignId: c.id,
        });
      const decision = await t.service.decide(t.admin, "qa-alpha", {
        packetId: packet.id,
        digest: packet.digest,
        decision: "approved",
      });
      const operation = await t.service.execute(t.admin, "qa-alpha", {
        packetId: packet.id,
        digest: packet.digest,
        requestKey: "execute",
      });
      if (change === "expired") t.advance(16 * 60000);
      else if (change === "revoked")
        await t.service.revoke(t.admin, "qa-alpha", {
          decisionId: decision.id,
        });
      else if (change === "actorRole")
        await t.store.db
          .prepare(
            "UPDATE memberships SET role=? WHERE user_id=? AND project_id=?",
          )
          .run("analyst", t.admin.userId, "qa-alpha");
      else if (change.startsWith("grant")) {
        const g = await t.store.get<Grant>("qa-alpha", "grant", c.grantId);
        await t.store.put("qa-alpha", "grant", g.id, {
          ...g,
          ...(change === "grantRevision"
            ? {
                revision: g.revision + 1,
              }
            : {
                expiresAt: new Date(time - 1).toISOString(),
              }),
        });
      } else {
        const m = structuredClone(c.material);
        if (change === "budget") m.budget.minor++;
        if (change === "targeting") m.audience.ageMin = 30;
        if (change === "copy") m.headline = "Changed";
        await t.store.put("qa-alpha", "campaign", c.id, {
          ...c,
          material: m,
        });
      }
      const result = await t.service.dispatch("qa-alpha", operation.id);
      assert.equal(result.state, "blocked");
      assert.equal(
        (await t.store.get<any>("qa-alpha", "fixtureEffect", c.id)).intent,
        "paused",
      );
    } finally {
      await t.close();
    }
  });
test("unknown writes retain a lease, no new-key replay, read-only reconciliation survives restart", async () => {
  const t = await setupTest();
  try {
    await ready(t);
    const c = await campaign(t);
    t.provider.loseNextResponse = true;
    const o = await t.service.prepare(t.admin, "qa-alpha", {
      campaignId: c.id,
      requestKey: "prepare",
    });
    assert.equal((await t.service.dispatch("qa-alpha", o.id)).state, "unknown");
    assert.equal(
      (
        await t.service.prepare(t.admin, "qa-alpha", {
          campaignId: c.id,
          requestKey: "prepare",
        })
      ).id,
      o.id,
    );
    await assert.rejects(
      async () =>
        await t.service.prepare(t.admin, "qa-alpha", {
          campaignId: c.id,
          requestKey: "different",
        }),
      /existing_operation/,
    );
    await t.reset();
    assert.equal(
      (
        await t.service.reconcile(t.admin, "qa-alpha", {
          operationId: o.id,
        })
      ).state,
      "succeeded",
    );
    assert.equal(
      Number((await t.store.db.prepare("SELECT COUNT(*) AS n FROM leases").get())!.n),
      0,
    );
  } finally {
    await t.close();
  }
});
test("running execution becomes unknown on host recovery, never replayed", async () => {
  const t = await setupTest();
  try {
    await ready(t);
    const c = await campaign(t);
    const o = await t.service.prepare(t.admin, "qa-alpha", {
      campaignId: c.id,
      requestKey: "p",
    });
    await t.store.put("qa-alpha", "operation", o.id, {
      ...o,
      state: "running",
    });
    await t.reset();
    assert.equal((await t.service.dispatch("qa-alpha", o.id)).state, "unknown");
    assert.equal((await t.store.list("qa-alpha", "fixtureEffect")).length, 0);
  } finally {
    await t.close();
  }
});
test("campaign optimistic versions and changed-payload idempotency conflict", async () => {
  const t = await setupTest();
  try {
    const c = await campaign(t);
    await assert.rejects(
      async () =>
        await t.service.saveCampaign(t.admin, "qa-alpha", {
          id: c.id,
          expectedRevision: 1,
          grantId: c.grantId,
          material: c.material,
        }),
      /revision_conflict/,
    );
    await assert.rejects(
      async () =>
        await t.service.generate(t.admin, "qa-alpha", {
          campaignId: c.id,
          grantId: "fixture-image",
          prompt: "changed",
          rightsReceipt: "test rights",
          parentAssetIds: [],
          requestKey: "image",
        }),
      /request_key_payload_conflict/,
    );
  } finally {
    await t.close();
  }
});
test("video lifecycle stores playable bytes; storyboard rejected for launch; failure and uncertain resubmission fenced", async () => {
  const t = await setupTest();
  try {
    let c = await t.service.saveCampaign(t.admin, "qa-alpha", {
      grantId: "meta-qa",
      material: sampleMaterial(),
    });
    const story = await t.service.storyboard(t.admin, "qa-alpha", {
      campaignId: c.id,
      text: "Shot 1. A calm desk.",
    });
    await assert.rejects(
      async () =>
        await t.service.saveCampaign(t.admin, "qa-alpha", {
          id: c.id,
          expectedRevision: c.revision,
          grantId: c.grantId,
          material: {
            ...c.material,
            assetIds: [story.id],
          },
        }),
      /material_not_ready/,
    );
    t.generation.fault = "processing";
    const job = await t.service.generate(t.admin, "qa-alpha", {
      campaignId: c.id,
      grantId: "fixture-video",
      prompt: "Fixture video",
      rightsReceipt: "test rights",
      parentAssetIds: [],
      requestKey: "video",
    });
    assert.equal(
      (await t.service.dispatchGeneration("qa-alpha", job.id)).state,
      "processing",
    );
    await t.reset();
    const retained = await t.service.reconcileGeneration(t.admin, "qa-alpha", {
      jobId: job.id,
    });
    assert.equal(retained.state, "retained");
    const asset = await t.store.get<any>(
      "qa-alpha",
      "asset",
      retained.assetId!,
    );
    const blob = (await t.store.db
      .prepare("SELECT bytes FROM blobs WHERE project_id=? AND digest=?")
      .get("qa-alpha", asset.digest))!;
    const decoded = await inspectMedia(blob.bytes as Uint8Array, "video");
    assert.equal(decoded.mime, "video/mp4");
    assert.ok(decoded.seconds! > 0);
    t.generation.fault = "unknown";
    const uncertain = await t.service.generate(t.admin, "qa-alpha", {
      campaignId: c.id,
      grantId: "fixture-image",
      prompt: "unknown image",
      rightsReceipt: "test rights",
      parentAssetIds: [],
      requestKey: "unknown",
    });
    assert.equal(
      (await t.service.dispatchGeneration("qa-alpha", uncertain.id)).state,
      "unknown",
    );
    await assert.rejects(
      async () =>
        await t.service.generate(t.admin, "qa-alpha", {
          campaignId: c.id,
          grantId: "fixture-image",
          prompt: "unknown image",
          rightsReceipt: "test rights",
          parentAssetIds: [],
          requestKey: "new-key",
        }),
      /generation_pending/,
    );
    assert.equal(
      (
        await t.service.reconcileGeneration(t.admin, "qa-alpha", {
          jobId: uncertain.id,
        })
      ).state,
      "unknown",
    );
  } finally {
    await t.close();
  }
});
test("reporting: completed form counts once without qualification, dedupe, distinct customers, null/freshness/currency", async () => {
  const t = await setupTest();
  try {
    const c = await prepared(t);
    const occurredAt = new Date(time - 5000).toISOString(),
      from = new Date(time - 86400000).toISOString(),
      until = new Date(time + 86400000).toISOString();
    const event = async (
      kind: "click" | "form_completed" | "purchase",
      eventId: string,
      personId = "person",
      clickId: string | null = "click",
    ) =>
      await t.service.event(t.admin, "qa-alpha", {
        id: eventId,
        kind,
        personId,
        campaignId: c.id,
        clickId,
        consentReceipt: "consent",
        sourceReceipt: `fixture-source-${eventId}`,
        occurredAt,
        revenue:
          kind === "purchase"
            ? {
                currency: "USD",
                minor: 6000,
              }
            : null,
      });
    await event("click", "click", "person", null);
    const lead = await event("form_completed", "form");
    await event("form_completed", "form");
    await event("form_completed", "another-form");
    await event("purchase", "paid");
    await t.service.conversation(t.admin, "qa-alpha", {
      id: "thread",
      campaignId: c.id,
      leadEventId: lead.id,
      consentReceipt: "consent",
      messages: [
        {
          speaker: "Customer",
          text: "Will it fit?",
          at: occurredAt,
        },
      ],
    });
    assert.equal(
      (
        await t.service.conversations(t.admin, "qa-alpha", {
          campaignId: c.id,
        })
      ).length,
      1,
    );
    await assert.rejects(
      async () =>
        await t.service.conversations(t.analyst, "qa-alpha", {
          campaignId: c.id,
        }),
      /forbidden/,
    );
    const input = {
      campaignId: c.id,
      from,
      until,
    };
    const before = await t.service.results(t.admin, "qa-alpha", input);
    assert.equal(before.spendMinor.value, null);
    assert.equal(before.leads.value, 1);
    assert.equal(before.qualified.value, 0);
    await t.service.syncMetrics(t.admin, "qa-alpha", input);
    const report = await t.service.results(t.analyst, "qa-alpha", input);
    assert.equal(report.customers.value, 1);
    assert.equal(report.ctr.value, 0.04);
    assert.equal(report.mediaCacMinor.value, 1200);
    assert.equal(report.mediaRoas.value, 5);
    assert.equal(report.currency, "USD");
    t.advance(7200000);
    assert.equal(
      (await t.service.results(t.admin, "qa-alpha", input)).stale,
      true,
    );
    await assert.rejects(
      async () =>
        await t.service.event(t.admin, "qa-alpha", {
          ...lead,
          personId: "different",
          projectId: undefined,
        } as never),
      /attribution_identity_mismatch/,
    );
    assert.ok(!("car" in report));
  } finally {
    await t.close();
  }
});
test("HTTP/headless parity: session identity, CSRF, asset range, analyst denial and agent tool allowlist", async () => {
  const t = await setupTest();
  const host = await createHost({
    store: t.store,
    service: t.service,
    origin: "http://127.0.0.1",
    staticDir: t.dir,
    version: "test",
  });
  await new Promise<void>((r) => host.server.listen(0, "127.0.0.1", r));
  const address = host.server.address() as {
    port: number;
  };
  const root = `http://127.0.0.1:${address.port}`;
  try {
    let response = await fetch(`${root}/api/projects/qa-alpha/workspace`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: "{}",
    });
    assert.equal(response.status, 401);
    response = await fetch(`${root}/api/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        username: "qa",
        password: "test-only-randomized-in-browser",
      }),
    });
    assert.equal(response.status, 200);
    const cookie = (await response.headers.get("set-cookie"))!.split(";")[0]!;
    const fetcher: typeof fetch = (url, init) =>
      fetch(url, {
        ...init,
        headers: {
          ...init?.headers,
          cookie,
        },
      });
    assert.equal((await fetch(`${root}/api/healthz`)).status, 401);
    const authenticatedHealth = await fetcher(`${root}/api/healthz`);
    assert.equal(authenticatedHealth.status, 200);
    assert.equal(
      (await authenticatedHealth.json()).datastore,
      t.store.db.dialect,
    );
    const client = createMarketingClient(root, "qa-alpha", fetcher);
    assert.equal((await client.call("workspace", {})).project.id, "qa-alpha");
    await assert.rejects(
      async () =>
        await createMarketingClient(root, "qa-beta", fetcher).call(
          "workspace",
          {},
        ),
      /forbidden/,
    );
    response = await fetcher(`${root}/api/projects/qa-alpha/workspace`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example",
      },
      body: "{}",
    });
    assert.equal(response.status, 403);
    await assert.rejects(
      () => agentTools(client)("marketing_decide", {}),
      /agent_tool_not_allowed/,
    );
    const c = await campaign(t);
    const a = (await t.service.workspace(t.admin, "qa-alpha")).assets.find(
      (a) => c.material.assetIds.includes(a.id),
    )!;
    response = await fetcher(client.assetUrl(a.id), {
      headers: {
        range: "bytes=0-7",
      },
    });
    assert.equal(response.status, 206);
    assert.equal((await response.arrayBuffer()).byteLength, 8);
  } finally {
    await host.idle();
    await new Promise<void>(async (r) => await host.server.close(() => r()));
    await t.close();
  }
});
test("authentication policy: any password complexity, 10 requests/60 seconds, failures retained across restart", async () => {
  const t = await setupTest();
  try {
    const u = await t.store.createUser("empty", "");
    assert.ok(u);
    assert.ok(await t.store.login("empty", "", "ip-a", time));
    for (let i = 0; i < 10; i++)
      assert.equal(
        await t.store.login("missing", "invalid", "ip-b", time),
        null,
      );
    await t.reset();
    await assert.rejects(
      async () =>
        await t.store.login(
          "qa",
          "test-only-randomized-in-browser",
          "ip-b",
          time,
        ),
      /rate_limited/,
    );
    assert.ok(
      await t.store.login(
        "qa",
        "test-only-randomized-in-browser",
        "ip-b",
        time + 60001,
      ),
    );
  } finally {
    await t.close();
  }
});
test("actual process death after external effect: same operation reconciles without another write", async () => {
  const t = await setupTest();
  try {
    await ready(t);
    const c = await campaign(t);
    const operation = await t.service.prepare(t.admin, "qa-alpha", {
      campaignId: c.id,
      requestKey: "process-crash",
    });
    await t.store.close();
    const child = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import { testStore } from './.marketing-build/tests/datastore.js';
      import { MarketingServer } from './.marketing-build/server/service.js';
      import { FixtureProvider,FixtureGeneration,FixtureAgent } from './.marketing-build/server/fixtures.js';
      const store=await testStore(process.argv[1]);await store.db.acquireExecutor();const provider=new FixtureProvider(store);
      const prepare=provider.prepare.bind(provider);
      provider.prepare=async(...args)=>{await prepare(...args);process.stdout.write('effect-retained\\n');await new Promise(()=>{});};
      const service=new MarketingServer(store,{meta:provider,google:provider,linkedin:provider},new FixtureGeneration(),new FixtureAgent(store),'fixture');
      setInterval(()=>{},1000);await service.dispatch('qa-alpha',process.argv[2]);
    `,
        t.path,
        operation.id,
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("child effect timeout"));
      }, 10000);
      child.stdout.on("data", (chunk) => {
        output += chunk;
        if (output.includes("effect-retained")) {
          clearTimeout(timeout);
          resolve();
        }
      });
      child.on("error", reject);
    });
    child.kill("SIGKILL");
    await once(child, "exit");
    await t.reset();
    assert.equal(
      (await t.store.get<Operation>("qa-alpha", "operation", operation.id))
        .state,
      "unknown",
    );
    assert.equal(
      (
        await t.service.reconcile(t.admin, "qa-alpha", {
          operationId: operation.id,
        })
      ).state,
      "succeeded",
    );
    assert.equal((await t.store.list("qa-alpha", "fixtureEffect")).length, 1);
  } finally {
    await t.close();
  }
});
for (const provider of ["google", "linkedin"] as const)
  test(`${provider} complete fixture workflow uses its own targeting and launch contract`, async () => {
    const t = await setupTest();
    try {
      await ready(t, provider);
      const m: Material = {
        ...sampleMaterial(),
        audience:
          provider === "google"
            ? {
                provider,
                locations: ["geoTargetConstants/2840"],
                keywords: ["desk kit"],
                expansion: false,
              }
            : {
                provider,
                locations: ["urn:li:geo:103644278"],
                expansion: false,
              },
        ...(provider === "google"
          ? {
              searchHeadlines: [
                "Desk kit",
                "Calm workspace",
                "Explore the kit",
              ],
              searchDescriptions: ["See the kit.", "Make room for your work."],
            }
          : {}),
      };
      let c = await t.service.saveCampaign(t.admin, "qa-alpha", {
        grantId: `${provider}-qa`,
        material: m,
      });
      if (provider === "linkedin") {
        const job = await t.service.generate(t.admin, "qa-alpha", {
          campaignId: c.id,
          grantId: "fixture-image",
          prompt: "test",
          rightsReceipt: "fixture rights",
          parentAssetIds: [],
          requestKey: "image",
        });
        const complete = await t.service.dispatchGeneration("qa-alpha", job.id);
        c = await t.service.saveCampaign(t.admin, "qa-alpha", {
          id: c.id,
          expectedRevision: c.revision,
          grantId: c.grantId,
          material: {
            ...m,
            assetIds: [complete.assetId!],
          },
        });
      }
      const operation = await t.service.prepare(t.admin, "qa-alpha", {
        campaignId: c.id,
        requestKey: "prepare",
      });
      assert.equal(
        (await t.service.dispatch("qa-alpha", operation.id)).state,
        "succeeded",
      );
      const packet = await t.service.packet(t.admin, "qa-alpha", {
        campaignId: c.id,
      });
      await t.service.decide(t.admin, "qa-alpha", {
        packetId: packet.id,
        digest: packet.digest,
        decision: "approved",
      });
      const launch = await t.service.execute(t.admin, "qa-alpha", {
        packetId: packet.id,
        digest: packet.digest,
        requestKey: "launch",
      });
      assert.equal(
        (await t.service.dispatch("qa-alpha", launch.id)).receipt?.intent,
        "enabled",
      );
    } finally {
      await t.close();
    }
  });

test("concurrent duplicate requests and claims commit one operation and one provider effect", async () => {
  const t = await setupTest();
  try {
    await ready(t);
    const c = await campaign(t);
    const input = { campaignId: c.id, requestKey: "concurrent-prepare" };
    const [a, b] = await Promise.all([
      t.service.prepare(t.admin, "qa-alpha", input),
      t.service.prepare(t.admin, "qa-alpha", input),
    ]);
    assert.equal(a!.id, b!.id);
    let effects = 0;
    const prepare = t.provider.prepare.bind(t.provider);
    t.provider.prepare = async (...args) => {
      effects++;
      return prepare(...args);
    };
    await Promise.all([
      t.service.dispatch("qa-alpha", a!.id),
      t.service.dispatch("qa-alpha", b!.id),
    ]);
    assert.equal(effects, 1);
    assert.equal(
      (await t.store.get<Operation>("qa-alpha", "operation", a!.id)).state,
      "succeeded",
    );
  } finally {
    await t.close();
  }
});
