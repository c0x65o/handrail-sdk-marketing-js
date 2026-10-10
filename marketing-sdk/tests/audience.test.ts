import test from "node:test";
import assert from "node:assert/strict";
import type { AudienceContext, Grant, Campaign } from "../core/index.js";
import { nativePreflightFixture } from "./preflight-fixture.js";
import { digest } from "../server/store.js";
import { testStore } from "./datastore.js";
import { MetaMarketingClient } from "../support/owner-marketing/meta-client.js";
import { revokeIndependently } from "./independent-revocation.js";

async function fixture() {
  const f = await nativePreflightFixture(true);
  const context: AudienceContext = { grantId: f.c.grantId, expectedGrantRevision: f.check.expectedGrantRevision,
    material: f.c.material, facet: "country", locale: "en_US" };
  return { ...f, context };
}
test("public country search, choices, status, same-campaign preflight and exact native paused countries", async () => {
  const f = await fixture();
  try {
    const grant = digest(await f.store.get("p", "grant", f.c.grantId));
    const choices = [];
    for (const query of ["United States", "Canada"]) {
      const r = await f.call("searchAudience", { ...f.context, query });
      assert.equal(r.state, "available"); assert.equal(r.choices.length, 1);
      const count = f.http.trace.length;
      assert.deepEqual(await f.call("searchAudience", { ...f.context, query }), r);
      assert.equal(f.http.trace.length, count, "bounded display reuse avoids redundant provider reads");
      choices.push(r.choices[0]!.choiceRef);
      assert.ok(!JSON.stringify(r).includes("graph.facebook"));
    }
    const selected = await f.call("resolveAudience", { ...f.context, choiceRefs: choices, selected: [] });
    assert.deepEqual(selected.selections.map(x => x.code), ["US", "CA"]);
    const status = await f.call("audienceStatus", { ...f.context, selected: ["US", "CA"] });
    assert.deepEqual(status.selections.map(x => x.label), ["United States", "Canada"]);
    const c = await f.call("saveCampaign", { id: f.c.id, expectedRevision: f.c.revision, grantId: f.c.grantId,
      material: { ...f.c.material, audience: { ...f.c.material.audience, locations: ["US", "CA"] } }, requestKey: "countries" });
    // Editing invalidates tracking's material binding; use its existing public repair.
    await f.call("bindTracking", { owner: { kind: "campaign", id: c.id }, expectedRevision: c.revision,
      expectedBindingRevision: 1, sourceId: "site", sourceRevision: "1", destinationId: "tour", outcome: "inquiry", refundTreatment: null, requestKey: "rebind" });
    const proof = await f.call("checkCampaign", { ...f.check, expectedRevision: c.revision, requestKey: "countries-check" });
    assert.equal(proof.state, "ready", JSON.stringify(proof));
    assert.deepEqual(f.http.trace.filter(t => t.path === "/v26.0/search").slice(-2).map(t => t.query.q), ["US", "CA"]);
    await f.store.db.acquireExecutor();
    const prep = await f.call("prepare", { campaignId: c.id, requestKey: "prepare-countries" });
    assert.equal((await f.server.dispatch("p", prep.id)).state, "succeeded");
    const adset = f.http.trace.find(t => t.method === "POST" && t.path.endsWith("/adsets"))!.body as any;
    assert.deepEqual(adset.targeting.geo_locations.countries, ["US", "CA"]);
    const paused = await f.store.get<Campaign>("p", "campaign", c.id);
    assert.deepEqual(f.http.objects.get(paused.receipt!.ids.adset!).targeting.geo_locations.countries, ["US", "CA"]);
    assert.equal(digest(await f.store.get("p", "grant", f.c.grantId)), grant);
    const packet = await f.call("packet", { campaignId: c.id });
    await f.call("decide", { packetId: packet.id, digest: packet.digest, decision: "approved" });
    await f.call("saveCampaign", { id: c.id, expectedRevision: c.revision, grantId: c.grantId,
      material: { ...c.material, audience: { ...c.material.audience, locations: ["CA"] } }, requestKey: "after-approval" });
    await assert.rejects(f.call("execute", { packetId: packet.id, digest: packet.digest, requestKey: "old-approval" }), /changed|revision|paused|stale/);
  } finally { await f.close(); }
});

test("country choices bind account, project, facet, material restrictions, session, configuration and custody", async () => {
  const f = await fixture();
  try {
    const r = await f.call("searchAudience", { ...f.context, query: "Canada" });
    const input = { ...f.context, choiceRefs: [r.choices[0]!.choiceRef], selected: [] };
    await assert.rejects(f.call("resolveAudience", { ...input, choiceRefs: ["forged"] }), /not_found/);
    await assert.rejects(f.server.call(f.principal, "other", "resolveAudience", input));
    await assert.rejects(f.call("resolveAudience", { ...input, facet: "city" as any }), /unsupported/);
    await assert.rejects(f.call("resolveAudience", { ...input, material: { ...input.material, audience: { ...f.c.material.audience, ageMin: 26 } } }), /stale/);
    const g = await f.store.get<Grant>("p", "grant", f.c.grantId);
    await f.custody.useReadOnly(g, async () => {}, c => f.custody.retainConnectionCredentials("p", g.secretRef, { ...c, accessToken: "SYNTHETIC_REPLACEMENT" }));
    await assert.rejects(f.call("resolveAudience", input), /stale/);
    await assert.rejects(f.call("resolveAudience", { ...input, choiceRefs: [], selected: ["ZZ"] }), /invalid_country/);
    await f.host!.changeRole("analyst");
    await assert.rejects(f.call("searchAudience", { ...f.context, query: "Canada" }), /forbidden|authority/);
  } finally { await f.close(); }
});

for (const malformed of [
  { data: [{ key: "US", name: "A city", type: "city" }] },
  { data: [{ key: "ZZ", name: "Unknown", type: "country" }] },
  { data: [{ key: "us", name: "Wrong key", type: "country" }] },
  { data: [{ key: "US", name: "First", type: "country" }, { key: "US", name: "Conflict", type: "country" }] },
  { data: [], paging: { next: "https://untrusted.example/", cursors: { after: "https://untrusted.example/" } } },
]) test(`malformed catalogue is unavailable: ${JSON.stringify(malformed)}`, async () => {
  const f = await fixture();
  try {
    f.http.override = u => u.pathname.endsWith("/search") ? Response.json(malformed) : undefined;
    assert.equal((await f.call("searchAudience", { ...f.context, query: "Country" })).state, "unavailable");
    assert.equal((await f.store.list("p", "audienceChoice")).length, 0);
  } finally { await f.close(); }
});

test("partial and empty continuations are bounded, repeated cursors and conflicting identities fail closed", async () => {
  const f = await fixture();
  try {
    let conflict = false;
    f.http.override = u => u.pathname.endsWith("/search") ? Response.json({
      data: !u.searchParams.has("after") ? [{ key: "US", name: "United States", type: "country" }] : conflict ? [{ key: "US", name: "Conflict", type: "country" }] : [],
      paging: { next: "https://evil.example/never-follow", cursors: { after: "repeat" } },
    }) : undefined;
    const first = await f.call("searchAudience", { ...f.context, query: "United" });
    assert.equal(first.state, "partial"); assert.ok(first.continuation);
    assert.equal((await f.call("searchAudience", { ...f.context, query: "United", continuation: first.continuation! })).state, "unavailable");
    await assert.rejects(f.call("searchAudience", { ...f.context, query: "Other", continuation: first.continuation! }), /cursor_stale/);
    await assert.rejects(f.call("searchAudience", { ...f.context, query: "United", continuation: "https://evil.example" }), /not_found/);
    conflict = true;
    assert.equal((await f.call("searchAudience", { ...f.context, query: "United", continuation: first.continuation! })).state, "unavailable");
    assert.ok(f.http.trace.every(t => t.path === "/v26.0/search"));
    const status = await f.call("resolveAudience", { ...f.context, choiceRefs: [], selected: ["CA"] });
    assert.equal(status.selections[0]!.state, "unresolved"); assert.equal(status.selections[0]!.code, "CA");
  } finally { await f.close(); }
});

test("country transport bounds response bytes, 429 and deadline including body reads", async () => {
  for (const fetcher of [async () => new Response("x".repeat(65537)), async () => new Response("", { status: 429 }),
    async () => new Response(new ReadableStream({ start() {} }))]) {
    const client = new MetaMarketingClient({ accessToken: "SYNTHETIC", fetchImpl: fetcher as typeof fetch, timeoutMs: 20 });
    await assert.rejects(client.searchCountries("Canada"));
  }
});

test("delayed catalogue allows independent SQL and revocation, and cannot publish stale choices", async () => {
  const f = await fixture(), other = await testStore(f.path), host = await testStore(f.hostPath);
  let release = () => {};
  try {
    let enter = () => {}; const entered = new Promise<void>(r => { enter = r; }), held = new Promise<void>(r => { release = r; });
    f.http.boundary = async u => { if (u.pathname.endsWith("/search")) { enter(); await held; } };
    const pending = f.call("searchAudience", { ...f.context, query: "Canada" }).catch(e => e); await entered;
    const local = other.put("p", "probe", "catalogue", { id: "catalogue" }).then(() => true);
    assert.equal(await Promise.race([local, new Promise(r => setTimeout(() => r(false), 500))]), true);
    await revokeIndependently(f.hostPath, f.principal.externalSessionRef!);
    release(); await pending;
    assert.equal((await f.store.list("p", "audienceChoice")).length, 0);
  } finally { release(); await host.close(); await other.close(); await f.close(); }
});

for (const countries of [[], ["US", "CA"]]) test(`native readback cannot remove or widen selected countries: ${countries}`, async () => {
  const f = await fixture();
  try {
    assert.equal((await f.call("checkCampaign", f.check)).state, "ready");
    await f.store.db.acquireExecutor();
    f.http.override = url => {
      const row = f.http.objects.get(url.pathname.split("/").at(-1)!);
      return row?.targeting ? Response.json({ ...row, targeting: { ...row.targeting, geo_locations: { countries } } }) : undefined;
    };
    const operation = await f.call("prepare", { campaignId: f.c.id, requestKey: "bad-readback" });
    const result = await f.server.dispatch("p", operation.id);
    assert.equal(result.state, "unknown"); assert.ok(result.receipt?.ids.adset);
    assert.notEqual((await f.store.get<Campaign>("p", "campaign", f.c.id)).state, "paused");
  } finally { await f.close(); }
});

test("empty continuation can advance, bounded pages stay partial, and a valid ISO code absent from provider stays unresolved", async () => {
  const f = await fixture();
  try {
    let page = 0;
    f.http.override = u => u.pathname.endsWith("/search") ? Response.json({ data: [], paging: { next: "https://evil.example/ignored", cursors: { after: `page_${++page}` } } }) : undefined;
    let continuation: string | undefined;
    for (let n = 0; n < 4; n++) {
      const r = await f.call("searchAudience", { ...f.context, query: "Antarctica", ...(continuation ? { continuation } : {}) });
      assert.equal(r.state, "partial"); assert.equal(r.choices.length, 0);
      if (n < 3) assert.ok(r.continuation); else assert.equal(r.continuation, null);
      continuation = r.continuation ?? undefined;
    }
    const r = await f.call("resolveAudience", { ...f.context, selected: ["AQ"], choiceRefs: [] });
    assert.equal(r.selections[0]!.code, "AQ"); assert.equal(r.selections[0]!.state, "unresolved");
    await assert.rejects(f.call("searchAudience", { ...f.context, query: "a".repeat(81) }));
    await assert.rejects(f.call("resolveAudience", { ...f.context, selected: Array(21).fill("US"), choiceRefs: [] }));
  } finally { await f.close(); }
});
