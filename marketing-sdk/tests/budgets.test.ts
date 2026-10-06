import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AdvertisingBudgets, type AdvertisingBudgetPolicy, type AdvertisingBudgetReservation } from "../server/budgets.js";
import { providerDayWindow, remainingCalendarDays } from "../server/reporting.js";
import { testStore } from "./datastore.js";
import type { Campaign, Operation } from "../core/index.js";
const now = Date.parse("2026-11-01T18:00:00Z");
const policy = (projectId: string, id = "project"): AdvertisingBudgetPolicy => ({
  id, projectId, scope: "project", projectIds: [projectId], currency: "USD", timezone: "America/Chicago",
  from: "2026-11-01T05:00:00Z", until: "2026-11-03T06:00:00Z", dailyCeilingMinor: 1000,
  periodCeilingMinor: 2000, campaignDailyCeilingMinor: 800, campaignLifetimeCeilingMinor: 5000, maxObservationAgeMs: 60000,
});
const campaign = (projectId: string, id = "c"): Campaign => ({ id, projectId, revision: 1, grantId: "g", creativeSetId: "cs", state: "paused", receipt: null,
  material: { name: "budget fixture", headline: "fixture", body: "fixture", destination: "https://example.com", destinationDigest: "a".repeat(64), assetIds: [],
    audience: { provider: "linkedin", locations: ["urn:li:geo:1"], expansion: false }, budget: { minor: 5000, currency: "USD" },
    advertisingBudget: { lifetime: { minor: 5000, currency: "USD" }, daily: { minor: 600, currency: "USD" } },
    startAt: "2026-11-01T05:00:00Z", endAt: "2026-11-03T06:00:00Z", timezone: "America/Chicago" } });
const operation = (c: Campaign, id = "op"): Operation => ({ id, projectId: c.projectId, campaignId: c.id, kind: "activate", packetId: "packet", payloadDigest: "a", campaignRevision: 1,
  grantRevision: 1, accountId: "123", state: "queued", reason: null, receipt: null, createdAt: new Date(now).toISOString() });

test("PostgreSQL budget reservations serialize cross-project portfolio races on independent Store connections; unknown holds do not expire", { skip: !process.env.MARKETING_TEST_POSTGRES_SOCKET }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "budgets-")), path = join(dir, "db");
  const a = await testStore(path), b = await testStore(path);
  let clock = now;
  const first = new AdvertisingBudgets(a, () => clock, "fixture"), second = new AdvertisingBudgets(b, () => clock, "fixture");
  try {
    for (const p of ["a", "b"]) await a.db.prepare("INSERT INTO projects VALUES(?,?)").run(p, p);
    const policies = [policy("a"), policy("b"), { ...policy("a", "portfolio"), scope: "portfolio" as const, projectIds: ["a", "b"] }];
    for (const p of policies) {
      await first.configure(p);
      await first.observe(p.projectId, { policyId: p.id, from: p.from, until: p.until, day: "2026-11-01", currency: p.currency, timezone: p.timezone,
        observedAt: new Date(clock).toISOString(), todayMinor: 100, periodMinor: 200, source: "fixture", receipt: "observed-aggregate" });
    }
    const ca = campaign("a"), cb = campaign("b");
    const results = await Promise.allSettled([first.reserve(ca, operation(ca)), second.reserve(cb, operation(cb))]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    assert.match(String((results.find(r => r.status === "rejected") as PromiseRejectedResult).reason), /advertising_budget_exceeded/);
    const winner = results[0]!.status === "fulfilled" ? ca : cb;
    const loser = winner === ca ? cb : ca;
    const held = (await a.list<AdvertisingBudgetReservation>("a", "advertisingBudgetReservation")).find(r => r.policyId === "portfolio")!;
    assert.equal(held.periodMinor, 1200); // Two civil days despite the DST transition.
    assert.equal(held.observedSpendReceipt, "observed-aggregate");
    // A lost acknowledgment/restart never makes money available to another campaign.
    clock += 3600000;
    await assert.rejects(first.reserve(loser, operation(loser, "retry")), /current_observed_spend_required/);
    assert.equal((await a.get<AdvertisingBudgetReservation>("a", "advertisingBudgetReservation", held.id)).state, "held");
    await assert.rejects(first.configure({ ...policies[2]!, dailyCeilingMinor: 9000 }), /unsettled_reservations/);
    // Reconciliation records enabled intent, retaining capacity; observed pause releases it.
    await first.settle(winner, operation(winner), "enabled");
    assert.equal((await a.get<AdvertisingBudgetReservation>("a", "advertisingBudgetReservation", held.id)).state, "active");
    await first.settle(winner, { ...operation(winner, "pause"), kind: "pause" }, "paused");
    assert.equal((await a.get<AdvertisingBudgetReservation>("a", "advertisingBudgetReservation", held.id)).state, "released");
    for (const p of policies) await first.observe(p.projectId, { policyId: p.id, from: p.from, until: p.until, day: "2026-11-01", currency: p.currency, timezone: p.timezone,
      observedAt: new Date(clock).toISOString(), todayMinor: 100, periodMinor: 200, source: "fixture", receipt: "new-observation" });
    await second.reserve(loser, operation(loser, "after-pause"));
    // Failed portfolio reservation rolled the losing project's reservation back too.
    assert.equal((await a.list<AdvertisingBudgetReservation>(loser.projectId, "advertisingBudgetReservation")).filter(r => r.state === "held").length, loser.projectId === "a" ? 2 : 1);
  } finally { await a.close(); await b.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("budget pacing uses current observed spend, null is unknown, and legacy lifetime never becomes daily", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pacing-")), s = await testStore(join(dir, "db"));
  const budget = new AdvertisingBudgets(s, () => now, "fixture"), p = policy("p"), c = campaign("p");
  try {
    await s.db.prepare("INSERT INTO projects VALUES(?,?)").run("p", "p");
    await budget.configure(p);
    const observation = { policyId: p.id, from: p.from, until: p.until, day: "2026-11-01", currency: p.currency, timezone: p.timezone,
      observedAt: new Date(now - 1000).toISOString(), todayMinor: 0, periodMinor: null, source: "fixture" as const, receipt: "missing-period" };
    await budget.observe("p", observation);
    await assert.rejects(budget.reserve(c, operation(c)), /current_observed_spend_required/);
    await assert.rejects(budget.reserve({ ...c, material: { ...c.material, advertisingBudget: { lifetime: c.material.budget, daily: { currency: "USD", minor: -1 } } } }, operation(c)), /unsupported_money/);
    await budget.observe("p", { ...observation, observedAt: new Date(now).toISOString(), todayMinor: 500, periodMinor: 1000, receipt: "current" });
    await assert.rejects(budget.reserve(c, operation(c)), /advertising_budget_exceeded/);
    await assert.rejects(budget.reserve({ ...c, material: { ...c.material, advertisingBudget: undefined } }, operation(c)), /explicit_daily_budget_required/);
    await assert.rejects(budget.observe("p", observation), /stale_spend_observation/);
    await assert.rejects(budget.reserve({ ...c, material: { ...c.material, advertisingBudget: { lifetime: c.material.budget, daily: { currency: "USD", minor: 900 } } } }, operation(c)), /campaign_budget_ceiling/);
    assert.deepEqual(await s.list("p", "advertisingBudgetReservation"), []);
    await budget.configure({ ...p, dailyCeilingMinor: 2000 });
    // Daily capacity now fits, but observed period spend plus 2 days does not.
    await assert.rejects(budget.reserve(c, operation(c)), /advertising_budget_exceeded/);
    await assert.rejects(new AdvertisingBudgets(s, () => now, "provider").reserve(c, operation(c)), /current_observed_spend_required/);
    await assert.rejects(budget.reserve({ ...c, material: { ...c.material, endAt: "2026-11-04T06:00:00Z" } }, operation(c)), /campaign_outside_budget_period/);
  } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("completed provider days respect timezone, 23/25-hour DST, exact boundaries and completed windows", () => {
  for (const [from, until, hours] of [["2026-03-08T06:00:00Z", "2026-03-09T05:00:00Z", 23],
    ["2026-11-01T05:00:00Z", "2026-11-02T06:00:00Z", 25]] as const) {
    const result = providerDayWindow(from, until, "America/Chicago", Date.parse(until));
    assert.equal(result.completeThrough, until);
    assert.equal((Date.parse(until) - Date.parse(from)) / 3600000, hours);
    assert.equal(remainingCalendarDays(Date.parse(from), until, "America/Chicago"), 1);
    assert.throws(() => providerDayWindow(from, until, "UTC", Date.parse(until)), /local_midnights/);
    assert.throws(() => providerDayWindow(from, until, "America/Chicago", Date.parse(until) - 1), /completed_days/);
  }
  assert.throws(() => providerDayWindow("2026-11-01T05:00:00.001Z", "2026-11-02T06:00:00Z", "America/Chicago", now + 86400000), /local_midnights/);
});


test("budget observations cannot cross project, currency, timezone or interval boundaries; failed reservations roll back", async () => {
  const dir = mkdtempSync(join(tmpdir(), "budget-scope-")), s = await testStore(join(dir, "db"));
  let clock = now;
  const budget = new AdvertisingBudgets(s, () => clock, "fixture");
  try {
    for (const project of ["a", "b", "outside"]) await s.db.prepare("INSERT INTO projects VALUES(?,?)").run(project, project);
    const a = policy("a"), b = policy("b");
    await budget.configure(a); await budget.configure(b);
    const obs = { policyId: a.id, from: a.from, until: a.until, day: "2026-11-01", currency: a.currency, timezone: a.timezone,
      observedAt: new Date(now).toISOString(), todayMinor: 0, periodMinor: 0, source: "fixture" as const, receipt: "only-project-a" };
    for (const change of [{ currency: "EUR" }, { timezone: "UTC" }, { from: "2026-10-31T05:00:00Z" },
      { until: "2026-11-04T06:00:00Z" }, { day: "2026-10-31" }, { observedAt: new Date(now + 1).toISOString() }])
      await assert.rejects(budget.observe("a", { ...obs, ...change }), /spend_basis_mismatch/);
    await budget.observe("a", obs);
    await assert.rejects(budget.reserve(campaign("b"), operation(campaign("b"))), /not_found/);
    await assert.rejects(budget.reserve(campaign("outside"), operation(campaign("outside"))), /advertising_budget_policy_required/);
    for (const change of [{ timezone: "UTC" }, { budget: { currency: "EUR", minor: 5000 } }]) {
      const c = { ...campaign("a"), material: { ...campaign("a").material, ...change } };
      await assert.rejects(budget.reserve(c, operation(c)), /explicit_daily_budget_required/);
    }
    const c = campaign("a"), op = operation(c);
    await assert.rejects(s.transaction(async () => { await budget.reserve(c, op); throw new Error("outer-command-rollback"); }), /outer-command-rollback/);
    assert.deepEqual(await s.list("a", "advertisingBudgetReservation"), []);
    clock = now + a.maxObservationAgeMs + 1;
    await assert.rejects(budget.reserve(c, op), /current_observed_spend_required/);
    assert.deepEqual(await s.list("a", "advertisingBudgetReservation"), []);
  } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
});
