import { fixtureSettings } from "./capability-fixtures.js";
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
import { defaultCampaignSchedule } from "../react/schedule.js";
import { localDate } from "../server/reporting.js";
import type { AdvertisingBudgetPolicy, AdvertisingBudgetReservation } from "../server/budgets.js";
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
    settings: fixtureSettings("meta", "act_123456", "987654"),
    purpose: "acquisition",
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
    assert.equal(before.completedSubmissions?.value, 2);
    assert.equal(before.uniquePeople?.value, 1);
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
      /source_event_payload_conflict/,
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
for (const phase of ["prepare", "activate"] as const)
 test(`actual process death after ${phase}: same effect reconciles without replay and budget holds survive`, async () => {
  const t = await setupTest();
  try {
    let operation: Operation;
    if (phase === "activate") {
      const { input } = await budgeted(t);
      operation = await t.service.execute(t.admin, "qa-alpha", input);
    } else {
      await ready(t);
      const c = await campaign(t);
      operation = await t.service.prepare(t.admin, "qa-alpha", { campaignId: c.id, requestKey: "process-crash" });
    }
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
      const phase=process.argv[3], effect=provider[phase].bind(provider);
      provider[phase]=async(...args)=>{await effect(...args);process.stdout.write('effect-retained\\n');await new Promise(()=>{});};
      const service=new MarketingServer(store,{meta:provider,google:provider,linkedin:provider},new FixtureGeneration(),new FixtureAgent(store),'fixture');
      setInterval(()=>{},1000);await service.dispatch('qa-alpha',process.argv[2]);
    `,
        t.path,
        operation.id,
        phase,
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
    if (phase === "activate") assert.equal((await t.store.list<AdvertisingBudgetReservation>("qa-alpha", "advertisingBudgetReservation"))[0]!.state, "held");
    assert.equal(
      (
        await t.service.reconcile(t.admin, "qa-alpha", {
          operationId: operation.id,
        })
      ).state,
      "succeeded",
    );
    assert.equal((await t.store.list("qa-alpha", "fixtureEffect")).length, 1);
    if (phase === "activate") assert.equal((await t.store.list<AdvertisingBudgetReservation>("qa-alpha", "advertisingBudgetReservation"))[0]!.state, "active");
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
        settings: provider === "google" ? undefined : fixtureSettings("linkedin", "123456", "987654"),
        ...(provider === "linkedin" ? { timezone: "UTC", ...defaultCampaignSchedule("UTC", new Date(time)) } : {}),
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
      if (provider === "linkedin") {
        m.advertisingBudget = { lifetime: m.budget, daily: { currency: "USD", minor: 600 } };
        const year = new Date(time).getUTCFullYear();
        const from = `${year}-01-01T00:00:00Z`, until = `${year + 1}-01-01T00:00:00Z`;
        await t.service.advertisingBudgets.configure({ id: "project-budget", projectId: "qa-alpha", scope: "project", projectIds: ["qa-alpha"],
          currency: "USD", timezone: m.timezone, from, until, dailyCeilingMinor: 10000, periodCeilingMinor: 100000,
          campaignDailyCeilingMinor: 1000, campaignLifetimeCeilingMinor: 10000, maxObservationAgeMs: 60000 });
        await t.service.advertisingBudgets.observe("qa-alpha", { policyId: "project-budget", from, until,
          day: new Intl.DateTimeFormat("sv-SE", { timeZone: m.timezone }).format(time), currency: "USD", timezone: m.timezone,
          observedAt: new Date(time).toISOString(), todayMinor: 0, periodMinor: 0, source: "fixture", receipt: "fixture-spend" });
      }
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
      if (provider === "linkedin") {
        t.provider.loseNextResponse = true;
        assert.equal((await t.service.dispatch("qa-alpha", launch.id)).state, "unknown");
        const rows = () => t.store.list<import("../server/budgets.js").AdvertisingBudgetReservation>("qa-alpha", "advertisingBudgetReservation");
        assert.equal((await rows())[0]?.state, "held");
        await assert.rejects(t.service.pause(t.admin, "qa-alpha", { campaignId: c.id, requestKey: "unknown-pause" }), /requires_reconciliation/);
        const saved = await t.store.get<Campaign>("qa-alpha", "campaign", c.id);
        await t.store.put("qa-alpha", "campaign", c.id, { ...saved, revision: saved.revision + 1 });
        await assert.rejects(t.service.reconcile(t.admin, "qa-alpha", { operationId: launch.id }), /reconciliation_material_changed/);
        assert.equal((await rows())[0]?.state, "held");
        await t.store.put("qa-alpha", "campaign", c.id, saved);
        assert.equal((await t.service.reconcile(t.admin, "qa-alpha", { operationId: launch.id })).state, "succeeded");
        assert.equal((await rows())[0]?.state, "active");
        const pause = await t.service.pause(t.admin, "qa-alpha", { campaignId: c.id, requestKey: "observed-pause" });
        await t.service.dispatch("qa-alpha", pause.id);
        assert.equal((await rows())[0]?.state, "released");
        const nextPacket = await t.service.packet(t.admin, "qa-alpha", { campaignId: c.id });
        await t.service.decide(t.admin, "qa-alpha", { packetId: nextPacket.id, digest: nextPacket.digest, decision: "approved" });
        const next = await t.service.execute(t.admin, "qa-alpha", { packetId: nextPacket.id, digest: nextPacket.digest, requestKey: "reactivate" });
        assert.equal((await t.service.dispatch("qa-alpha", next.id)).state, "succeeded");
        assert.equal((await rows())[0]?.state, "active");
      } else assert.equal((await t.service.dispatch("qa-alpha", launch.id)).receipt?.intent, "enabled");
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

test("activation can repeat after an observed pause without changing material or creative identity", async () => {
  const t = await setupTest();
  try {
    const c = await prepared(t);
    let previous = "";
    for (let cycle = 0; cycle < 3; cycle++) {
      const packet = await t.service.packet(t.admin, "qa-alpha", { campaignId: c.id });
      await t.service.decide(t.admin, "qa-alpha", { packetId: packet.id, digest: packet.digest, decision: "approved" });
      const input = { packetId: packet.id, digest: packet.digest, requestKey: `activate-cycle-${cycle}` };
      const op = await t.service.execute(t.admin, "qa-alpha", input);
      assert.notEqual(op.id, previous); previous = op.id;
      assert.equal((await t.service.dispatch("qa-alpha", op.id)).state, "succeeded");
      assert.equal((await t.service.execute(t.admin, "qa-alpha", input)).id, op.id);
      const pause = await t.service.pause(t.admin, "qa-alpha", { campaignId: c.id, requestKey: `pause-cycle-${cycle}` });
      assert.equal((await t.service.dispatch("qa-alpha", pause.id)).state, "succeeded");
      const current = await t.store.get<Campaign>("qa-alpha", "campaign", c.id);
      assert.equal(current.revision, c.revision);
      assert.equal(current.creativeSetId, c.creativeSetId);
      assert.deepEqual(current.material, c.material);
      await assert.rejects(t.service.execute(t.admin, "qa-alpha", { ...input, requestKey: `replay-${cycle}` }), /stale_material|requires_reconciliation/);
    }
  } finally { await t.close(); }
});

test("lost operation lease fences provider writes and keeps the operation unknown", async () => {
  const t = await setupTest();
  try {
    const { c, input } = await budgeted(t);
    const op = await t.service.execute(t.admin, "qa-alpha", input);
    let writes = 0;
    t.provider.activate = async (_c, _g, beforeWrite) => {
      await t.store.db.prepare("DELETE FROM leases WHERE project_id=?").run("qa-alpha");
      await beforeWrite(); writes++;
      throw new Error("must not reach write");
    };
    assert.equal((await t.service.dispatch("qa-alpha", op.id)).state, "unknown");
    assert.equal(writes, 0);
    assert.equal((await t.store.list<AdvertisingBudgetReservation>("qa-alpha", "advertisingBudgetReservation"))[0]!.state, "held");
    await assert.rejects(t.service.pause(t.admin, "qa-alpha", { campaignId: c.id, requestKey: "escape" }), /requires_reconciliation/);
    assert.equal((await t.service.dispatch("qa-alpha", op.id)).state, "unknown");
  } finally { await t.close(); }
});

test("trusted source retries preserve attribution; submissions, people, QA and applicant outcomes remain separate", async () => {
  const t = await setupTest();
  try {
    const c = await prepared(t);
    const common = { personId: "person", consentReceipt: "receipt", revenue: null, occurredAt: new Date(time - 3000).toISOString(), sourceId: "trusted-website" };
    const click = await t.service.event(t.admin, "qa-alpha", { ...common, id: "original-click", kind: "click", campaignId: c.id, clickId: null, sourceReceipt: "click" });
    const input = { ...common, id: "submission-1", kind: "form_completed" as const, clickId: click.id, sourceReceipt: "submission-1", occurredAt: new Date(time - 1000).toISOString() };
    const submission = await t.service.call(t.admin, "qa-alpha", "event", input);
    await t.service.event(t.admin, "qa-alpha", { ...input, id: "submission-2", sourceReceipt: "submission-2" });
    // A late-arriving click must not silently reattribute an already accepted submission.
    await t.service.event(t.admin, "qa-alpha", { ...common, id: "late-click", kind: "click", campaignId: c.id, clickId: null, sourceReceipt: "late-click", occurredAt: new Date(time - 2000).toISOString() });
    const retries = await Promise.all([t.service.event(t.admin, "qa-alpha", { ...input, id: "retry-1" }), t.service.event(t.admin, "qa-alpha", { ...input, id: "retry-2" })]);
    assert.ok(retries.every(e => e.id === submission.id && e.campaignId === submission.campaignId));
    await assert.rejects(t.service.event(t.admin, "qa-alpha", { ...input, id: "changed-retry", test: true }), /source_event_payload_conflict/);
    await assert.rejects(t.service.event(t.admin, "qa-alpha", { ...input, id: "changed-kind", kind: "purchase" }), /source_event_payload_conflict/);
    await assert.rejects(t.service.event(t.admin, "qa-alpha", { ...input, id: "changed-person", personId: "someone-else" }), /source_event_payload_conflict/);
    await t.service.event(t.admin, "qa-alpha", { ...common, id: "qa-click", kind: "click", campaignId: c.id, clickId: null, sourceReceipt: "qa-click", synthetic: true });
    await t.service.event(t.admin, "qa-alpha", { ...input, id: "qa-form", sourceReceipt: "qa-form", clickId: "qa-click", synthetic: true });
    await t.service.event(t.admin, "qa-alpha", { ...common, id: "app-click", kind: "click", purpose: "recruitment", campaignId: c.id, clickId: null, sourceReceipt: "app-click" });
    for (const kind of ["applicant_request_mou", "application_completed", "applicant_qualified", "hired"] as const) await t.service.event(t.admin, "qa-alpha", {
      ...common, id: kind, kind, purpose: "recruitment", clickId: "app-click", sourceReceipt: kind, occurredAt: new Date(time - 1000).toISOString(),
    });
    const window = { campaignId: c.id, from: new Date(time - 86400000).toISOString(), until: new Date(time + 1000).toISOString() };
    assert.equal((await t.service.results(t.admin, "qa-alpha", window)).applicants?.value, null);
    assert.equal((await t.service.results(t.admin, "qa-alpha", window)).applicantRequests?.value, null);
    await t.store.put("qa-alpha", "firstPartyCoverage", "recruitment", { from: window.from, until: window.until, purpose: "recruitment" });
    const results = await t.service.results(t.admin, "qa-alpha", window);
    assert.equal(results.completedSubmissions?.value, 2);
    assert.equal(results.uniquePeople?.value, 1);
    assert.equal(results.leads.value, 1); // Versioned compatibility field.
    assert.equal(results.applicantRequests?.value, 1);
    assert.equal(results.applicants?.value, 1);
    assert.equal(results.qualifiedApplicants?.value, 1);
    assert.equal(results.hires?.value, 1);
    assert.equal(results.qualified.value, 0);
    assert.equal(results.customers.value, 0);
    assert.equal(results.excludedTestEvents?.value, 2);
    assert.equal(results.spendMinor.value, null);
    // An aggregate LinkedIn conversion number (or jobApplications) cannot become
    // a trusted completed MOU request, even when provider metrics are present.
    const aggregate = (await import("../server/providers.js")).summarizeMetrics([{ externalWebsiteConversions: "99", jobApplications: "500" }],
      { spend: "spend", impressions: "impressions", clicks: "clicks", conversions: "externalWebsiteConversions" }, 100);
    await t.store.put("qa-alpha", "metrics", "aggregate-only", { id: "aggregate-only", projectId: "qa-alpha", campaignId: c.id,
      from: window.from, until: window.until, timezone: c.material.timezone, currency: c.material.budget.currency, observedAt: new Date(time).toISOString(), source: "fixture", ...aggregate });
    assert.equal((await t.service.results(t.admin, "qa-alpha", window)).providerConversions.value, 99);
    assert.equal((await t.service.results(t.admin, "qa-alpha", window)).applicantRequests?.value, 1);
    await t.store.db.prepare("DELETE FROM records WHERE project_id=? AND kind=?").run("qa-alpha", "firstPartyCoverage");
    assert.equal((await t.service.results(t.admin, "qa-alpha", window)).applicantRequests?.value, null);
    assert.equal((await t.service.results(t.admin, "qa-alpha", window)).completedSubmissions?.value, null);
    await assert.rejects(t.service.saveCampaign(t.admin, "qa-alpha", { grantId: "meta-qa", material: { ...sampleMaterial(), settings: undefined, purpose: "recruitment" } }), /recruitment_provider_unsupported/);
  } finally { await t.close(); }
});

test("legacy LinkedIn receipt can still be paused without fabricating daily approval", async () => {
  const t = await setupTest();
  try {
    const base = await campaign(t);
    const c: Campaign = { id: base.id, projectId: "qa-alpha", revision: 1, grantId: "linkedin-qa", creativeSetId: "original-set", state: "enabled",
      material: { ...sampleMaterial(), settings: undefined, timezone: "UTC", assetIds: base.material.assetIds, audience: { provider: "linkedin", locations: ["urn:li:geo:1"], expansion: false } },
      receipt: { ids: { campaign: "legacy-id" }, payloadDigest: "legacy-plan-digest", intent: "enabled", delivery: "unverified",
        observedAt: new Date(time).toISOString(), evidence: "fixture", providerRequestId: "original" } };
    delete c.material.settings;
    await t.store.put("qa-alpha", "campaign", c.id, c);
    await t.store.put("qa-alpha", "fixtureEffect", c.id, c.receipt);
    const operation = await t.service.pause(t.admin, "qa-alpha", { campaignId: c.id, requestKey: "safe-legacy-pause" });
    assert.equal((await t.service.dispatch("qa-alpha", operation.id)).receipt?.intent, "paused");
    const saved = await t.store.get<Campaign>("qa-alpha", "campaign", c.id);
    assert.deepEqual(saved.material, c.material);
    assert.equal(saved.receipt?.ids.campaign, "legacy-id");
    await assert.rejects(t.service.packet(t.admin, "qa-alpha", { campaignId: c.id }), /explicit_daily_budget_required/);
  } finally { await t.close(); }
});


test("imported event IDs and unknown attribution are preserved; legacy source evidence remains immutable", async () => {
  const t = await setupTest();
  try {
    const c = await prepared(t);
    const input = { id: "imported", kind: "form_completed" as const, personId: "person", consentReceipt: "original-consent",
      sourceId: "original-source", sourceReceipt: "event-1", occurredAt: new Date(time - 5000).toISOString(), clickId: null, revenue: null };
    const imported = { ...input, projectId: "qa-alpha", campaignId: null };
    await t.store.put("qa-alpha", "event", input.id, imported);
    await assert.rejects(t.service.event(t.admin, "qa-alpha", { ...input, sourceReceipt: "different" }), /source_event_id_conflict/);
    await assert.rejects(t.service.event(t.admin, "qa-alpha", { ...input, id: "kind-change", kind: "purchase" }), /source_event_payload_conflict/);
    assert.deepEqual(await t.service.event(t.admin, "qa-alpha", input), imported);
    assert.deepEqual(await t.store.get("qa-alpha", "event", input.id), imported);
    // Predecessor's kind-qualified evidence keys continue to freeze original input.
    const original = { ...input, id: "old-evidence", sourceReceipt: "event-2", campaignId: c.id };
    const saved = { ...original, projectId: "qa-alpha", campaignId: null };
    await t.store.put("qa-alpha", "event", original.id, saved);
    const legacyKey = digest([original.sourceId, original.kind, original.sourceReceipt]);
    await t.store.put("qa-alpha", "sourceEventEvidence", legacyKey, { id: legacyKey, eventId: original.id, inputDigest: digest({ ...original, id: undefined }) });
    assert.deepEqual(await t.service.event(t.admin, "qa-alpha", { ...original, id: "retry" }), saved);
    await assert.rejects(t.service.event(t.admin, "qa-alpha", { ...original, id: "kind-retry", kind: "purchase" }), /source_event_payload_conflict/);
  } finally { await t.close(); }
});


async function budgeted(t: Awaited<ReturnType<typeof setupTest>>) {
  await ready(t);
  const base = await campaign(t);
  const c = await t.service.saveCampaign(t.admin, "qa-alpha", { id: base.id, expectedRevision: base.revision, grantId: base.grantId,
    material: { ...base.material, advertisingBudget: { lifetime: base.material.budget, daily: { currency: "USD", minor: 500 } } } });
  const p: AdvertisingBudgetPolicy = { id: "review-policy", projectId: "qa-alpha", projectIds: ["qa-alpha"], scope: "project",
    currency: "USD", timezone: c.material.timezone,
    from: defaultCampaignSchedule(c.material.timezone, new Date(time - 2 * 86400000)).startAt,
    until: defaultCampaignSchedule(c.material.timezone, new Date(time + 8 * 86400000)).endAt,
    dailyCeilingMinor: 1000, periodCeilingMinor: 10000, campaignDailyCeilingMinor: 1000,
    campaignLifetimeCeilingMinor: 5000, maxObservationAgeMs: 60000 };
  await t.service.advertisingBudgets.configure(p);
  const observation = { policyId: p.id, from: p.from, until: p.until, day: localDate(time, p.timezone), currency: p.currency,
    timezone: p.timezone, observedAt: new Date(time).toISOString(), todayMinor: 0, periodMinor: 0, source: "fixture" as const, receipt: "current-complete-aggregate" };
  await t.service.advertisingBudgets.observe("qa-alpha", observation);
  const prepare = await t.service.prepare(t.admin, "qa-alpha", { campaignId: c.id, requestKey: "prepare" });
  assert.equal((await t.service.dispatch("qa-alpha", prepare.id)).state, "succeeded");
  const packet = await t.service.packet(t.admin, "qa-alpha", { campaignId: c.id });
  await t.service.decide(t.admin, "qa-alpha", { packetId: packet.id, digest: packet.digest, decision: "approved" });
  return { c, p, observation, input: { packetId: packet.id, digest: packet.digest, requestKey: "budget-launch" } };
}

test("budget authority changes after approval and spend changes immediately before a write fail closed; public commands cannot attest spend", async () => {
  const t = await setupTest();
  try {
    const { c, p, observation, input } = await budgeted(t);
    for (const command of ["configure", "observe", "advertisingBudgets", "firstPartyCoverage"])
      await assert.rejects(t.service.call(t.admin, "qa-alpha", command as never, {} as never), /unknown_command/);
    await assert.rejects(t.service.call(t.admin, "qa-alpha", "execute", { ...input, observedSpend: observation } as never), /unexpected_fields/);
    await t.service.advertisingBudgets.configure({ ...p, campaignDailyCeilingMinor: 400 });
    await assert.rejects(t.service.execute(t.admin, "qa-alpha", input), /campaign_budget_ceiling_exceeded/);
    assert.deepEqual(await t.store.list("qa-alpha", "advertisingBudgetReservation"), []);
    await t.service.advertisingBudgets.configure(p);
    const op = await t.service.execute(t.admin, "qa-alpha", input);
    await assert.rejects(t.service.advertisingBudgets.configure({ ...p, projectIds: ["qa-beta"] }), /invalid_budget_scope/);
    await assert.rejects(t.service.advertisingBudgets.configure({ ...p, dailyCeilingMinor: 2000 }), /unsettled_reservations/);
    let writes = 0;
    t.provider.activate = async (_c, _g, beforeWrite) => {
      // Change evidence after claim, before the actual provider mutation boundary.
      t.advance(1);
      await t.service.advertisingBudgets.observe("qa-alpha", { ...observation, observedAt: new Date(time + 1).toISOString(),
        todayMinor: 600, periodMinor: 600, receipt: "new-spend" });
      await beforeWrite(); writes++;
      throw new Error("must not reach provider write");
    };
    assert.equal((await t.service.dispatch("qa-alpha", op.id)).state, "unknown");
    assert.equal(writes, 0);
    assert.equal((await t.store.list<AdvertisingBudgetReservation>("qa-alpha", "advertisingBudgetReservation"))[0]!.state, "held");
    await assert.rejects(t.service.pause(t.admin, "qa-alpha", { campaignId: c.id, requestKey: "bypass-unknown" }), /requires_reconciliation/);
  } finally { await t.close(); }
});

test("budget holds survive interrupted activation and restart; only verified pause releases active capacity", async () => {
  const t = await setupTest();
  try {
    const { c, input } = await budgeted(t);
    const op = await t.service.execute(t.admin, "qa-alpha", input);
    t.provider.loseNextResponse = true;
    assert.equal((await t.service.dispatch("qa-alpha", op.id)).state, "unknown");
    const held = async () => (await t.store.list<AdvertisingBudgetReservation>("qa-alpha", "advertisingBudgetReservation"))[0]!.state;
    assert.equal(await held(), "held");
    // Simulate the durable state of a process killed before its unknown update.
    await t.store.put("qa-alpha", "operation", op.id, { ...await t.store.get<Operation>("qa-alpha", "operation", op.id), state: "running" });
    await t.reset();
    assert.equal((await t.store.get<Operation>("qa-alpha", "operation", op.id)).state, "unknown");
    assert.equal(await held(), "held");
    assert.equal((await t.service.execute(t.admin, "qa-alpha", input)).id, op.id);
    assert.equal((await t.service.reconcile(t.admin, "qa-alpha", { operationId: op.id })).state, "succeeded");
    assert.equal(await held(), "active");
    const pause = await t.service.pause(t.admin, "qa-alpha", { campaignId: c.id, requestKey: "verified-pause" });
    t.provider.loseNextResponse = true;
    assert.equal((await t.service.dispatch("qa-alpha", pause.id)).state, "unknown");
    assert.equal(await held(), "active");
    assert.equal((await t.service.reconcile(t.admin, "qa-alpha", { operationId: pause.id })).state, "succeeded");
    assert.equal(await held(), "released");
    const packet = await t.service.packet(t.admin, "qa-alpha", { campaignId: c.id });
    await t.service.decide(t.admin, "qa-alpha", { packetId: packet.id, digest: packet.digest, decision: "approved" });
    const next = await t.service.execute(t.admin, "qa-alpha", { packetId: packet.id, digest: packet.digest, requestKey: "next-cycle" });
    assert.equal(await held(), "held");
    t.advance(60001); // Proved pre-dispatch block releases this reservation atomically.
    assert.equal((await t.service.dispatch("qa-alpha", next.id)).state, "blocked");
    assert.equal(await held(), "released");
  } finally { await t.close(); }
});

test("typed material edits invalidate packet authority and the agent uses the same account/settings validator", async () => {
  const t = await setupTest();
  try {
    const { CAPABILITY_VERSION } = await import("../core/index.js");
    const c = await prepared(t);
    const packet = await t.service.packet(t.admin, "qa-alpha", { campaignId: c.id });
    await t.service.decide(t.admin, "qa-alpha", { packetId: packet.id, digest: packet.digest, decision: "approved" });
    const settings: import("../core/index.js").MetaSettings = { version: CAPABILITY_VERSION, provider: "meta", accountId: "act_123456", apiVersion: "v26.0",
      format: "single_image", objective: "OUTCOME_TRAFFIC", optimization: "LINK_CLICKS", delivery: "ordinary", placements: ["facebook_feed"],
      identity: { pageId: "987654" }, targeting: { languages: [], interestGroups: [], excludedCustomAudiences: [] }, nondiscriminationAccepted: true };
    const updated = await t.service.saveCampaign(t.admin, "qa-alpha", { id: c.id, expectedRevision: c.revision, grantId: c.grantId,
      material: { ...c.material, settings, purpose: "acquisition" } });
    assert.equal(updated.creativeSetId, c.creativeSetId); assert.equal(updated.receipt, null);
    await assert.rejects(t.service.execute(t.admin, "qa-alpha", { packetId: packet.id, digest: packet.digest, requestKey: "stale-capability" }), /changed|revision|paused|stale_material/);
    const call = agentTools({ call: (command, input) => t.service.call(t.agent, "qa-alpha", command, input), assetUrl: () => "" });
    await assert.rejects(call("marketing_saveCampaign", { grantId: c.grantId, material: { ...updated.material, settings: { ...settings, accountId: "act_999" } } }), /account_context_mismatch/);
    await assert.rejects(call("marketing_saveCampaign", { grantId: c.grantId, material: { ...updated.material, settings: { ...settings, objective: "OUTCOME_AWARENESS", optimization: "LINK_CLICKS" } } }), /unsupported_objective/);
    assert.equal((await t.store.list("qa-alpha", "campaign")).length, 1);
  } finally { await t.close(); }
});

test("review: campaign save retry returns immutable SQL receipt without duplicate drafts or revisions", async () => {
  const t = await setupTest();
  try {
    const input = { grantId: "meta-qa", requestKey: "review-save-retry", material: sampleMaterial() };
    const [a, b] = await Promise.all([t.service.saveCampaign(t.admin, "qa-alpha", input), t.service.saveCampaign(t.admin, "qa-alpha", input)]);
    assert.deepEqual(a, b);
    assert.equal((await t.store.list("qa-alpha", "campaign")).length, 1);
    const edited = await t.service.saveCampaign(t.admin, "qa-alpha", { ...input, id: a.id, expectedRevision: a.revision,
      requestKey: "review-save-edit", material: { ...a.material, name: "Edited" } });
    assert.equal(edited.revision, 2);
    assert.deepEqual(await t.service.saveCampaign(t.admin, "qa-alpha", input), a);
    await assert.rejects(t.service.saveCampaign(t.admin, "qa-alpha", { ...input, material: { ...input.material, name: "Conflicting retry" } }), /idempotency|request/);
    assert.equal((await t.store.get<Campaign>("qa-alpha", "campaign", a.id)).revision, 2);
    for (const settings of [{ ...input.material.settings, accountVerified: true }, { ...input.material.settings, format: "document" }, { ...input.material.settings, leadGenForm: "123" }]) {
      await assert.rejects(t.service.saveCampaign(t.admin, "qa-alpha", { ...input, requestKey: "forged-settings", material: { ...input.material, settings: settings as any } }));
    }
  } finally { await t.close(); }
});
