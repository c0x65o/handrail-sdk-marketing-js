import { dailyExposureMinor } from "../core/index.js";
import type { Campaign, Operation } from "../core/index.js";
import { Store, digest, requireThat } from "./store.js";
import { advertisingBudget, instant, text } from "./validation.js";
import { localDate, providerDayWindow, remainingCalendarDays } from "./reporting.js";

/** Trusted host configuration. Not a browser command or a grant of provider authority.
 * Portfolio members must share this Store/schema so its SQL guard serializes them.
 */
export interface AdvertisingBudgetPolicy {
  id: string;
  projectId: string;
  scope: "project" | "portfolio";
  projectIds: string[];
  currency: string;
  timezone: string;
  from: string;
  until: string;
  dailyCeilingMinor: number;
  periodCeilingMinor: number;
  campaignDailyCeilingMinor: number;
  campaignLifetimeCeilingMinor: number;
  maxObservationAgeMs: number;
}
export interface ObservedAdvertisingSpend {
  policyId: string;
  from: string;
  until: string;
  day: string;
  currency: string;
  timezone: string;
  observedAt: string;
  todayMinor: number | null;
  periodMinor: number | null;
  source: "provider" | "fixture";
  /** Durable host aggregate receipt, including all members, never a delivery claim. */
  receipt: string;
}
export interface AdvertisingBudgetReservation {
  id: string;
  policyId: string;
  projectId: string;
  campaignId: string;
  operationId: string;
  dailyMinor: number;
  periodMinor: number;
  state: "held" | "active" | "released";
  observedSpendReceipt: string;
}

/** Uses the existing cross-connection SQL transaction guard and durable records.
 * Unknown effects never expire. Only a proved pause releases an active hold.
 */
export class AdvertisingBudgets {
  constructor(readonly store: Store, readonly now = () => Date.now(), readonly evidence: "provider" | "fixture" = "provider") {}
  private async policies(project: string) {
    const rows = await this.store.db.prepare("SELECT body FROM records WHERE kind=?").all("advertisingBudgetPolicy");
    return rows.map(r => JSON.parse(String(r.body)) as AdvertisingBudgetPolicy).filter(p => p.projectIds.includes(project));
  }
  async configure(policy: AdvertisingBudgetPolicy) {
    text(policy.id); text(policy.projectId);
    requireThat(["project", "portfolio"].includes(policy.scope) && Array.isArray(policy.projectIds) &&
      policy.projectIds.length > 0 && new Set(policy.projectIds).size === policy.projectIds.length &&
      (policy.scope !== "project" || (policy.projectIds.length === 1 && policy.projectIds[0] === policy.projectId)), "invalid_budget_scope");
    requireThat(["USD", "EUR", "GBP", "CAD", "AUD"].includes(policy.currency), "unsupported_money");
    for (const n of [policy.dailyCeilingMinor, policy.periodCeilingMinor, policy.campaignDailyCeilingMinor,
      policy.campaignLifetimeCeilingMinor, policy.maxObservationAgeMs]) requireThat(Number.isSafeInteger(n) && n > 0 && n <= 1e12, "invalid_budget_policy");
    // Validate calendar boundaries without requiring a future policy to be completed.
    providerDayWindow(policy.from, policy.until, policy.timezone, Date.parse(policy.until));
    await this.store.transaction(async () => {
      for (const project of [policy.projectId, ...policy.projectIds]) requireThat(
        await this.store.db.prepare("SELECT id FROM projects WHERE id=?").get(project), "budget_project_missing");
      const held = (await this.store.list<AdvertisingBudgetReservation>(policy.projectId, "advertisingBudgetReservation"))
        .some(r => r.policyId === policy.id && r.state !== "released");
      if (held) {
        const old = await this.store.get<AdvertisingBudgetPolicy>(policy.projectId, "advertisingBudgetPolicy", policy.id);
        requireThat(digest(old) === digest(policy), "budget_policy_has_unsettled_reservations");
      }
      await this.store.put(policy.projectId, "advertisingBudgetPolicy", policy.id, policy);
    });
  }
  async observe(project: string, observation: ObservedAdvertisingSpend) {
    instant(observation.observedAt); text(observation.receipt);
    for (const n of [observation.todayMinor, observation.periodMinor]) requireThat(n === null ||
      (Number.isSafeInteger(n) && n >= 0), "invalid_observed_spend");
    requireThat(observation.source === "provider" || observation.source === "fixture", "invalid_spend_source");
    await this.store.transaction(async () => {
      const p = await this.store.get<AdvertisingBudgetPolicy>(project, "advertisingBudgetPolicy", observation.policyId);
      requireThat(observation.from === p.from && observation.until === p.until && observation.currency === p.currency &&
        observation.timezone === p.timezone && observation.day === localDate(observation.observedAt, p.timezone) &&
        Date.parse(observation.observedAt) <= this.now() &&
        (observation.todayMinor === null || observation.periodMinor === null || observation.periodMinor >= observation.todayMinor), "spend_basis_mismatch");
      const old = (await this.store.list<ObservedAdvertisingSpend>(project, "advertisingObservedSpend")).find(o => o.policyId === p.id);
      requireThat(!old || Date.parse(old.observedAt) < Date.parse(observation.observedAt) || digest(old) === digest(observation), "stale_spend_observation");
      await this.store.put(project, "advertisingObservedSpend", p.id, observation);
    });
  }
  private async check(p: AdvertisingBudgetPolicy, c: Campaign, own?: AdvertisingBudgetReservation) {
    const at = this.now(), daily = c.material.advertisingBudget?.daily;
    requireThat(at >= Date.parse(p.from) && at < Date.parse(p.until), "budget_period_not_current");
    requireThat(Date.parse(c.material.startAt) >= Date.parse(p.from) && Date.parse(c.material.endAt) <= Date.parse(p.until), "campaign_outside_budget_period");
    requireThat(daily && daily.currency === p.currency && c.material.budget.currency === p.currency &&
      c.material.timezone === p.timezone, "explicit_daily_budget_required");
    if (this.evidence === "provider") {
      requireThat(c.material.audience.provider !== "meta", "meta_daily_budget_semantics_unverified");
      requireThat(c.material.audience.provider !== "linkedin" || c.material.timezone === "UTC", "linkedin_utc_required");
    }
    advertisingBudget(c.material.advertisingBudget!);
    requireThat(c.material.advertisingBudget!.lifetime.minor === c.material.budget.minor &&
      c.material.advertisingBudget!.lifetime.currency === c.material.budget.currency, "legacy_lifetime_budget_mismatch");
    // Fixtures can exercise SQL arithmetic, never qualify native budget semantics.
    const exposure = dailyExposureMinor(c.material) ?? (this.evidence === "fixture" ? daily.minor : null);
    requireThat(exposure !== null, "daily_exposure_unverified");
    requireThat(exposure <= p.campaignDailyCeilingMinor && c.material.budget.minor <= p.campaignLifetimeCeilingMinor,
      "campaign_budget_ceiling_exceeded");
    const spend = await this.store.get<ObservedAdvertisingSpend>(p.projectId, "advertisingObservedSpend", p.id);
    requireThat(spend.from === p.from && spend.until === p.until && spend.currency === p.currency && spend.timezone === p.timezone &&
      spend.day === localDate(at, p.timezone) && Date.parse(spend.observedAt) <= at && at - Date.parse(spend.observedAt) <= p.maxObservationAgeMs &&
      spend.todayMinor !== null && spend.periodMinor !== null && (this.evidence === "fixture" || spend.source === "provider"), "current_observed_spend_required");
    const rows = (await this.store.list<AdvertisingBudgetReservation>(p.projectId, "advertisingBudgetReservation"))
      .filter(r => r.policyId === p.id && r.state !== "released" && r.id !== own?.id);
    // Conservative remaining headroom: observations plus new commitments. Never
    // subtract observed spend from an uncertain operation's reservation.
    const days = remainingCalendarDays(at, p.until, p.timezone);
    const period = Math.min(c.material.budget.minor, exposure * days);
    const dailyTotal = rows.reduce((n, r) => n + r.dailyMinor, own?.dailyMinor ?? exposure);
    const periodTotal = rows.reduce((n, r) => n + r.periodMinor, own?.periodMinor ?? period);
    requireThat(spend.todayMinor + dailyTotal <= p.dailyCeilingMinor &&
      spend.periodMinor + periodTotal <= p.periodCeilingMinor, "advertising_budget_exceeded");
    return { dailyMinor: own?.dailyMinor ?? exposure, periodMinor: own?.periodMinor ?? period, observedSpendReceipt: spend.receipt };
  }
  async reserve(c: Campaign, operation: Operation) {
    await this.store.transaction(async () => {
      const policies = await this.policies(c.projectId);
      requireThat(!c.material.advertisingBudget || policies.some(p => p.scope === "project"), "advertising_budget_policy_required");
      for (const p of policies) {
        const id = digest([p.id, c.projectId, c.id]);
        const old = (await this.store.list<AdvertisingBudgetReservation>(p.projectId, "advertisingBudgetReservation")).find(r => r.id === id);
        requireThat(!old || old.state === "released" || old.operationId === operation.id, "budget_reservation_requires_reconciliation");
        const amounts = await this.check(p, c, old?.state !== "released" ? old : undefined);
        await this.store.put(p.projectId, "advertisingBudgetReservation", id, {
          id, policyId: p.id, projectId: c.projectId, campaignId: c.id, operationId: operation.id, state: "held", ...amounts,
        } satisfies AdvertisingBudgetReservation);
      }
    });
  }
  async assert(c: Campaign, operation: Operation) {
    const policies = await this.policies(c.projectId);
    requireThat(!c.material.advertisingBudget || policies.some(p => p.scope === "project"), "advertising_budget_policy_required");
    for (const p of policies) {
      const r = await this.store.get<AdvertisingBudgetReservation>(p.projectId, "advertisingBudgetReservation", digest([p.id, c.projectId, c.id]));
      requireThat(r.operationId === operation.id && r.state === "held", "budget_reservation_lost");
      await this.check(p, c, r);
    }
  }
  async settle(c: Campaign, operation: Operation, outcome: "enabled" | "paused" | "not_dispatched") {
    await this.store.transaction(async () => {
      for (const p of await this.policies(c.projectId)) {
        const rows = await this.store.list<AdvertisingBudgetReservation>(p.projectId, "advertisingBudgetReservation");
        for (const r of rows.filter(r => r.policyId === p.id && r.projectId === c.projectId && r.campaignId === c.id &&
          r.state !== "released" && (outcome === "paused" || r.operationId === operation.id))) {
          await this.store.put(p.projectId, "advertisingBudgetReservation", r.id, { ...r, state: outcome === "enabled" || (outcome === "paused" && this.evidence === "provider" && c.material.settings) ? "active" : "released" });
        }
      }
    });
  }
}
