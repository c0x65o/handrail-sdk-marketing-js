import { testStore } from "./datastore.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NativeProvider } from "../server/providers.js";
import { byteDigest } from "../server/store.js";
import type { Asset, Campaign, Grant } from "../core/index.js";
test("native Meta HTTP write/readback, external drift guard and lost acknowledgment reconciliation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marketing-native-write-"));
  const store = await testStore(join(dir, "db.sqlite"));
  await store.db.prepare("INSERT INTO projects VALUES(?,?)").run("p", "test");
  const bytes = readFileSync(
    new URL(
      "../../marketing-sdk/tests/fixtures/test-pattern.png",
      import.meta.url,
    ),
  );
  const hash = byteDigest(bytes);
  await store.db
    .prepare("INSERT INTO blobs VALUES(?,?,?)")
    .run("p", hash, bytes);
  const grant: Grant = {
    id: "g",
    projectId: "p",
    provider: "meta",
    revision: 1,
    accountId: "act_123",
    label: "Fixture transport",
    currency: "USD",
    timezone: "America/Chicago",
    permissions: ["prepare", "activate", "pause", "report", "setup"],
    expiresAt: "2099-01-01T00:00:00Z",
    revokedAt: null,
    secretRef: "test",
    pageId: "42",
  };
  const asset: Asset = {
    id: "a",
    projectId: "p",
    campaignId: "c",
    version: 1,
    kind: "image",
    digest: hash,
    mime: "image/png",
    width: 320,
    height: 180,
    seconds: null,
    source: "uploaded",
    jobId: null,
    rightsReceipt: "test",
    parentAssetIds: [],
  };
  await store.put("p", "asset", "a", asset);
  const campaign: Campaign = {
    id: "c",
    projectId: "p",
    revision: 1,
    grantId: "g",
    creativeSetId: "cs",
    state: "draft",
    receipt: null,
    material: {
      name: "Test",
      headline: "Test headline",
      body: "Test body",
      destination: "https://example.com/kit",
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
  const objects = new Map<string, any>();
  let writes = 0,
    nextId = 100,
    loseAdRead = true;
  let retained: Record<string, string> = {};
  let checks = 0;
  const fetcher: typeof fetch = async (raw, init) => {
    const url = new URL(String(raw)),
      last = url.pathname.split("/").at(-1)!;
    if (init?.method === "POST") {
      writes++;
      if (last === "adimages")
        return Response.json({
          images: {
            "file.png": {
              hash: "provider-image-hash",
            },
          },
        });
      const body =
        typeof init.body === "string"
          ? JSON.parse(init.body)
          : Object.fromEntries(
              [...url.searchParams].map(([key, value]) => {
                try {
                  return [key, JSON.parse(value)];
                } catch {
                  return [key, value];
                }
              }),
            );
      if (objects.has(last)) {
        objects.set(last, {
          ...(await objects.get(last)),
          ...body,
        });
        return Response.json({
          success: true,
        });
      }
      const key = String(nextId++);
      if (body.creative)
        body.creative = {
          id: String(body.creative.creative_id),
        };
      if (body.campaign_id) body.campaign_id = String(body.campaign_id);
      if (body.adset_id) body.adset_id = String(body.adset_id);
      objects.set(key, {
        ...body,
        id: key,
      });
      return Response.json({
        id: key,
      });
    }
    if (last === "103" && loseAdRead) {
      loseAdRead = false;
      throw new Error("fixture_lost_ad_read_response");
    }
    assert.ok(objects.has(last), `Unknown fixture endpoint ${last}`);
    return Response.json(await objects.get(last));
  };
  const provider = new NativeProvider(
    "meta",
    {
      use: async (_g, fn) =>
        fn({
          accessToken: "private-test-token",
        }),
    },
    store,
    fetcher,
  );
  try {
    await assert.rejects(
      async () =>
        await provider.prepare(
          campaign,
          grant,
          [asset],
          "key",
          (ids) => {
            retained = {
              ...ids,
            };
          },
          () => {
            checks++;
          },
        ),
      /fixture_lost_ad_read_response|Meta is unavailable/,
    );
    assert.equal(writes, 5);
    assert.equal(checks, 5);
    assert.equal(retained.ad, "103");
    assert.equal(retained.readbackDigest, undefined);
    const partial = {
      ids: retained,
      payloadDigest: (await import("../server/store.js")).digest(
        provider.plan(campaign, grant, [asset]),
      ),
      intent: "paused" as const,
      delivery: "unverified" as const,
      providerRequestId: null,
      observedAt: new Date().toISOString(),
      evidence: "provider" as const,
    };
    const reconciled = await provider.reconcile(campaign, grant, {
      kind: "prepare",
      payloadDigest: partial.payloadDigest,
      receipt: partial,
    });
    assert.ok(reconciled);
    assert.equal(writes, 5);
    assert.ok(reconciled.ids.readbackDigest);
    const paused = {
      ...campaign,
      state: "paused" as const,
      receipt: reconciled,
    };
    const original = structuredClone(await objects.get(retained.adset!));
    (await objects.get(retained.adset!)).targeting.age_min = 35;
    await assert.rejects(
      async () => await provider.activate(paused, grant, () => {}),
      /external_material_changed/,
    );
    assert.equal(writes, 5);
    objects.set(retained.adset!, original);
    const enabled = await provider.activate(paused, grant, () => {
      checks++;
    });
    assert.equal(enabled.intent, "enabled");
    assert.equal(enabled.delivery, "unverified");
    assert.equal(writes, 8);
    assert.equal(checks, 8);
  } finally {
    await store.close();
    rmSync(dir, {
      recursive: true,
      force: true,
    });
  }
});
