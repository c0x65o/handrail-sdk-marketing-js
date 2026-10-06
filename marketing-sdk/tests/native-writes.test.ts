import { fixtureSettings, fixtureEligibility } from "./capability-fixtures.js";
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
      settings: fixtureSettings("meta", "act_123", "42"),
      purpose: "acquisition",
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
  fixtureEligibility(campaign, grant);
  const objects = new Map<string, any>();
  let writes = 0,
    nextId = 100,
    loseAdRead = true;
  let retained: Record<string, string> = {};
  let checks = 0;
  const fetcher: typeof fetch = async (raw, init) => {
    const url = new URL(String(raw)),
      last = url.pathname.split("/").at(-1)!;
    if (init?.method !== "POST" && last === "act_123") return Response.json({ id: "act_123", currency: "USD", timezone_name: "America/Chicago" });
    if (init?.method !== "POST" && last === "42") return Response.json({ id: "42" });
    if (init?.method !== "POST" && last === "adimages") return Response.json({ data: [{ hash: "provider-image-hash", status: "ACTIVE" }] });
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
        account_id: "123",
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
    assert.equal((provider.plan(campaign, grant, [asset]) as any).campaign.is_adset_budget_sharing_enabled, false);
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
      /provider_request_failed/,
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

test("LinkedIn fixture transport verifies initial daily budget, bid, objective/type, organization and account; lost acknowledgment is read-only reconciled", async () => {
  const dir = mkdtempSync(join(tmpdir(), "linkedin-parity-")), store = await testStore(join(dir, "db"));
  try {
    await store.db.prepare("INSERT INTO projects VALUES(?,?)").run("p", "fixture");
    const bytes = readFileSync(new URL("../../marketing-sdk/tests/fixtures/test-pattern.png", import.meta.url));
    const hash = byteDigest(bytes);
    await store.db.prepare("INSERT INTO blobs VALUES(?,?,?)").run("p", hash, bytes);
    const asset: Asset = { id: "a", projectId: "p", campaignId: "c", version: 1, kind: "image", digest: hash, mime: "image/png", width: 320, height: 180,
      seconds: null, source: "uploaded", jobId: null, rightsReceipt: "fixture", parentAssetIds: [] };
    await store.put("p", "asset", asset.id, asset);
    const grant: Grant = { id: "g", projectId: "p", provider: "linkedin", revision: 1, accountId: "123", label: "Fixture transport", currency: "USD",
      timezone: "UTC", permissions: ["setup", "prepare", "activate", "pause", "report"], expiresAt: "2099-01-01T00:00:00Z", revokedAt: null,
      secretRef: "fixture", organizationId: "42", targetingOptions: [{ kind: "locations", id: "urn:li:geo:1", label: "United States" }] };
    const c: Campaign = { id: "c", projectId: "p", revision: 1, grantId: "g", creativeSetId: "cs", state: "draft", receipt: null,
      material: { settings: fixtureSettings("linkedin", "123", "42"), purpose: "acquisition", name: "Fixture", headline: "Headline", body: "Body", destination: "https://example.com/kit", destinationDigest: "a".repeat(64), assetIds: ["a"],
        audience: { provider: "linkedin", locations: ["urn:li:geo:1"], expansion: false }, budget: { currency: "USD", minor: 42000 },
        advertisingBudget: { lifetime: { currency: "USD", minor: 42000 }, daily: { currency: "USD", minor: 3000 } },
        startAt: "2026-10-08T00:00:00Z", endAt: "2026-10-15T00:00:00Z", timezone: "UTC" } };
    fixtureEligibility(c, grant);
    let objects = new Map<string, any>(), writes = 0, loseRead = false, drift: ((o: any, collection: string) => void) | null = null;
    const fetcher: typeof fetch = async (raw, init) => {
      const url = new URL(String(raw)), path = decodeURIComponent(url.pathname), last = path.split("/").at(-1)!;
      if (init?.method === "PUT") { writes++; return new Response(null, { status: 201 }); }
      if (init?.method === "POST") {
        writes++;
        const body = JSON.parse(String(init.body));
        if (last === "images") return Response.json({ value: { uploadUrl: "https://fixture.invalid/upload", image: "urn:li:image:fixture" } });
        if (objects.has(last)) {
          Object.assign(objects.get(last), body.patch.$set);
          return new Response(null, { status: 204 });
        }
        const id = last === "adCampaignGroups" ? "101" : last === "adCampaigns" ? "102" : "urn:li:sponsoredCreative:103";
        objects.set(id, { ...(body.creative ?? body), id });
        drift?.(objects.get(id), last);
        return Response.json({}, { status: 201, headers: { "x-restli-id": id } });
      }
      if (path === "/rest/campaignConversions") return Response.json({ elements: [] });
      if (path === "/rest/adAccounts/123") return Response.json({ id: 123, currency: "USD" });
      if (path.includes("/images/")) return Response.json({ id: "urn:li:image:fixture", owner: "urn:li:organization:42", status: "AVAILABLE" });
      if (path.includes("/adTargetingEntities")) return Response.json({ elements: [{ urn: "urn:li:geo:1", name: "United States" }] });
      if (loseRead && last === "urn:li:sponsoredCreative:103") { loseRead = false; throw new Error("lost acknowledgment fixture"); }
      assert.ok(objects.has(last), `Unexpected fixture request ${path}`);
      return Response.json(objects.get(last));
    };
    const provider = new NativeProvider("linkedin", { use: async (_g, fn) => fn({ accessToken: "fixture-only", clientId: "fixture-client", clientSecret: "fixture-secret" }) }, store, fetcher);
    await assert.rejects(provider.prepare({ ...c, material: { ...c.material, advertisingBudget: undefined } }, grant, [asset], "legacy", () => {}, () => {}), /explicit_daily_budget/);
    assert.equal(writes, 0);
    const mutations = [
      (o: any) => { o.dailyBudget.amount = "420.00"; },
      (o: any) => { o.dailyBudget.currencyCode = "EUR"; },
      (o: any) => { o.unitCost.amount = "1.00"; },
      (o: any) => { o.unitCost.currencyCode = "EUR"; },
      (o: any) => { o.objectiveType = "LEAD_GENERATION"; },
      (o: any) => { o.type = "TEXT_AD"; },
      (o: any) => { o.format = "SPONSORED_UPDATE_NATIVE_DOCUMENT"; },
      (o: any) => { o.costType = "CPM"; },
      (o: any) => { o.associatedEntity = "urn:li:organization:999"; },
      (o: any) => { o.account = "urn:li:sponsoredAccount:999"; },
    ];
    for (const mutation of mutations) {
      objects = new Map(); drift = (o, collection) => { if (collection === "adCampaigns") mutation(o); };
      await assert.rejects(provider.prepare(c, grant, [asset], "initial-drift", () => {}, () => {}), /provider_effective_material_mismatch/);
    }
    for (const mutation of [
      (o: any) => { o.account = "urn:li:sponsoredAccount:999"; },
      (o: any) => { o.totalBudget.amount = "999.00"; },
      (o: any) => { o.totalBudget.currencyCode = "EUR"; },
    ]) {
      objects = new Map(); drift = (o, collection) => { if (collection === "adCampaignGroups") mutation(o); };
      await assert.rejects(provider.prepare(c, grant, [asset], "group-drift", () => {}, () => {}), /provider_effective_material_mismatch/);
    }
    objects = new Map(); drift = null; loseRead = true;
    let ids: Record<string, string> = {};
    await assert.rejects(provider.prepare(c, grant, [asset], "lost-ack", value => { ids = { ...value }; }, () => {}));
    assert.ok(ids.campaign && ids.creative);
    const writeCount = writes;
    const { digest } = await import("../server/store.js");
    const payloadDigest = digest(provider.plan(c, grant, [asset]));
    const operation = { kind: "prepare", payloadDigest, receipt: { ids, payloadDigest, intent: "paused" as const, delivery: "unverified" as const,
      observedAt: new Date().toISOString(), evidence: "provider" as const, providerRequestId: null } };
    const receipt = await provider.reconcile(c, grant, operation);
    assert.equal(writes, writeCount);
    assert.ok(receipt?.ids.readbackDigest);
    assert.equal(receipt.delivery, "unverified");
    const paused = { ...c, state: "paused" as const, receipt };
    objects.get("102").dailyBudget.amount = "31.00";
    await assert.rejects(provider.activate(paused, grant, () => {}), /external_material_changed/);
    assert.equal(writes, writeCount);
    objects.get("102").dailyBudget.amount = "30.00";
    const enabled = await provider.activate(paused, grant, () => {});
    assert.equal(enabled.intent, "enabled");
    const againPaused = await provider.pause({ ...paused, state: "enabled", receipt: enabled }, grant, () => {});
    assert.equal((await provider.activate({ ...paused, receipt: againPaused }, grant, () => {})).intent, "enabled");
    // Old receipt digests used the v1 field set. Adding readback fields must not
    // strand a safety pause or rewrite the original campaign material.
    const pick = (o: any, fields: string[]) => Object.fromEntries(fields.map(f => [f, o[f]]));
    const legacyMaterial = {
      group: pick(objects.get("101"), ["totalBudget", "runSchedule"]),
      campaign: pick(objects.get("102"), ["account", "campaignGroup", "associatedEntity", "targetingCriteria", "dailyBudget", "runSchedule",
        "audienceExpansionEnabled", "offsiteDeliveryEnabled", "unitCost", "objectiveType", "type"]),
      creative: pick(objects.get("urn:li:sponsoredCreative:103"), ["campaign", "content"]),
      post: pick(objects.get("urn:li:sponsoredCreative:103").inlineContent.post, ["author", "commentary", "content", "contentLandingPage", "contentCallToActionLabel", "distribution"]),
    };
    const { readbackVersion: _version, ...legacyIds } = receipt.ids;
    const legacy = { ...c, state: "enabled" as const, material: { ...c.material, settings: undefined, advertisingBudget: undefined },
      receipt: { ...receipt, ids: { ...legacyIds, readbackDigest: digest(legacyMaterial) } } };
    assert.equal((await provider.pause(legacy, grant, () => {})).intent, "paused");
    await assert.rejects(provider.activate(legacy, grant, () => {}), /explicit_daily_budget_required/);
  } finally { await store.close(); rmSync(dir, { recursive: true, force: true }); }
});
