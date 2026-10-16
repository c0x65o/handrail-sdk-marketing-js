import type { Campaign } from '../core/index.js';
import { dailyExposureMinor, materialCurrency, materialEndTime } from '../core/index.js';
import type { AdvertisingBudgetPolicy, AdvertisingBudgetReservation, ObservedAdvertisingSpend } from './budgets.js';
import { localDate } from './reporting.js';
import { advertisingBudget } from './validation.js';
import { requireThat } from './store.js';

/** The host's existing UTC weekly/monthly policy is recurring authority, not an
 * invented lifetime cap or permission inferred from imported campaign data. */
export function advertisingBudgetPeriod(policy: AdvertisingBudgetPolicy, at: number) {
  if (!policy.recurrence) return {from: policy.from, until: policy.until};
  requireThat(policy.timezone === 'UTC' && ['weekly','monthly'].includes(policy.recurrence.unit) &&
    typeof policy.recurrence.authorityRef === 'string' && policy.recurrence.authorityRef.trim().length > 0,
  'recurring_budget_authority_required');
  const date = new Date(at);
  requireThat(Number.isFinite(date.getTime()), 'invalid_budget_instant');
  let from: Date, until: Date;
  if (policy.recurrence.unit === 'monthly') {
    from = new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),1));
    until = new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,1));
  } else {
    from = new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()));
    from.setUTCDate(from.getUTCDate()-(from.getUTCDay()+6)%7);
    until = new Date(from);until.setUTCDate(until.getUTCDate()+7);
  }
  return {from:from.toISOString(),until:until.toISOString()};
}

export interface RecurringBudgetExposure {
  startsAt: string;
  endsAt: string | null;
  providerTimezone: string;
  providerDailyMinor: number;
  lifetimeMinor: number | null;
  pausedAt: string | null;
  pauseOperationId: string | null;
  pauseReceiptDigest: string | null;
}

/** Count every provider day touched by the accounting window, including partial
 * boundary days. These are conservative spending bounds, never report totals. */
export function recurringExposureBound(exposure: RecurringBudgetExposure, from: string, until: string) {
  const start=Math.max(Date.parse(from),Date.parse(exposure.startsAt));
  const end=Math.min(Date.parse(until),exposure.endsAt===null?Infinity:Date.parse(exposure.endsAt),
    exposure.pausedAt===null?Infinity:Date.parse(exposure.pausedAt));
  requireThat(Number.isFinite(start)&&Number.isFinite(end)&&Number.isSafeInteger(exposure.providerDailyMinor)&&exposure.providerDailyMinor>0,
    'budget_reservation_basis_unavailable');
  if(end<=start)return 0;
  const days=(Date.parse(localDate(end-1,exposure.providerTimezone))-Date.parse(localDate(start,exposure.providerTimezone)))/86400000+1;
  const bound=Math.min(exposure.lifetimeMinor??Infinity,days*exposure.providerDailyMinor);
  requireThat(Number.isSafeInteger(bound)&&bound>=0,'budget_reservation_basis_unavailable');
  return bound;
}

export function recurringCampaignExposure(policy: AdvertisingBudgetPolicy,campaign: Campaign,at:number,evidence:'provider'|'fixture'):RecurringBudgetExposure {
  requireThat(policy.recurrence,'recurring_budget_authority_required');
  const material=campaign.material,daily=material.advertisingBudget?.daily,lifetime=material.advertisingBudget?.lifetime;
  requireThat(daily&&daily.currency===policy.currency&&materialCurrency(material)===policy.currency,'explicit_daily_budget_required');
  advertisingBudget(material.advertisingBudget!);
  requireThat(Boolean(material.budget)===Boolean(lifetime)&&(!lifetime||material.budget!.currency===lifetime.currency&&material.budget!.minor===lifetime.minor),
    'legacy_lifetime_budget_mismatch');
  const starts=Date.parse(material.startAt),ends=materialEndTime(material);
  requireThat(Number.isFinite(starts)&&ends>Math.max(starts,at),'campaign_delivery_window_ended');
  if(evidence==='provider'){
    requireThat(material.settings?.provider===material.audience.provider,'budget_provider_context_unverified');
    requireThat(material.audience.provider!=='linkedin'||material.timezone==='UTC','linkedin_utc_required');
  }
  // Validate the provider timezone independently of the host's UTC accounting.
  localDate(at,material.timezone);
  const exposure=dailyExposureMinor(material);
  requireThat(exposure!==null&&Number.isSafeInteger(exposure)&&exposure>0,'daily_exposure_unverified');
  requireThat(!material.advertisingBudget?.campaignDailyCeiling||exposure<=material.advertisingBudget.campaignDailyCeiling.minor,
    'campaign_daily_exposure_exceeded');
  requireThat(exposure<=policy.campaignDailyCeilingMinor&&(!lifetime||lifetime.minor<=policy.campaignLifetimeCeilingMinor),
    'campaign_budget_ceiling_exceeded');
  return {startsAt:new Date(Math.max(at,starts)).toISOString(),endsAt:Number.isFinite(ends)?new Date(ends).toISOString():null,
    providerTimezone:material.timezone,providerDailyMinor:exposure,lifetimeMinor:lifetime?.minor??null,
    pausedAt:null,pauseOperationId:null,pauseReceiptDigest:null};
}

export function checkRecurringBudget(policy: AdvertisingBudgetPolicy,campaign: Campaign,at:number,evidence:'provider'|'fixture',
  spend:ObservedAdvertisingSpend,rows:AdvertisingBudgetReservation[],own?:AdvertisingBudgetReservation){
  const period=advertisingBudgetPeriod(policy,at),current=recurringCampaignExposure(policy,campaign,at,evidence);
  requireThat(at>=Date.parse(policy.from),'budget_period_not_current');
  requireThat(spend.from===period.from&&spend.until===period.until&&spend.currency===policy.currency&&spend.timezone===policy.timezone&&
    spend.day===localDate(at,policy.timezone)&&Date.parse(spend.observedAt)<=at&&at-Date.parse(spend.oldestSourceCollectedAt??spend.observedAt)<=policy.maxObservationAgeMs&&
    spend.todayMinor!==null&&spend.periodMinor!==null&&(evidence==='fixture'||spend.source==='provider'),'current_observed_spend_required');
  const today=`${localDate(at,'UTC')}T00:00:00.000Z`,tomorrow=new Date(Date.parse(today)+86400000).toISOString();
  const selected=own?.recurringExposure??current;
  if(own)requireThat(own.recurringExposure&&current.providerTimezone===selected.providerTimezone&&
    current.providerDailyMinor<=selected.providerDailyMinor&&
    (current.lifetimeMinor??Infinity)<=(selected.lifetimeMinor??Infinity)&&current.endsAt===selected.endsAt,
    'budget_reservation_basis_changed');
  const active=rows.filter(row=>row.policyId===policy.id&&row.state!=='released'&&row.id!==own?.id);
  let daily=recurringExposureBound(selected,today,tomorrow),total=recurringExposureBound(selected,period.from,period.until);
  for(const row of active){
    requireThat(row.recurringExposure,'budget_reservation_basis_unavailable');
    daily+=recurringExposureBound(row.recurringExposure,today,tomorrow);
    total+=recurringExposureBound(row.recurringExposure,period.from,period.until);
  }
  // A recurring approval also commits future periods. Reserving only today's
  // remainder would overbook next month (or admit a future scheduled campaign
  // for zero). Preserve an upper bound for every unpaused commitment. A UTC
  // window can touch boundary days in another provider calendar; the extra two
  // days also cover calendar-date jumps, rather than assuming 24-hour days.
  let standingDaily=0,standingPeriod=0;
  for(const basis of [selected,...active.map(row=>row.recurringExposure!)]){
    if(basis.pausedAt!==null||basis.endsAt!==null&&Date.parse(basis.endsAt)<=at)continue;
    const boundaryDays=basis.providerTimezone==='UTC'?0:2;
    standingDaily+=Math.min(basis.lifetimeMinor??Infinity,basis.providerDailyMinor*(1+boundaryDays));
    standingPeriod+=Math.min(basis.lifetimeMinor??Infinity,basis.providerDailyMinor*((policy.recurrence!.unit==='weekly'?7:31)+boundaryDays));
  }
  requireThat(Number.isSafeInteger(standingDaily)&&Number.isSafeInteger(standingPeriod)&&
    standingDaily<=policy.dailyCeilingMinor&&standingPeriod<=policy.periodCeilingMinor,'advertising_budget_exceeded');
  requireThat(Number.isSafeInteger(daily)&&Number.isSafeInteger(total)&&spend.todayMinor+daily<=policy.dailyCeilingMinor&&
    spend.periodMinor+total<=policy.periodCeilingMinor,'advertising_budget_exceeded');
  return {dailyMinor:recurringExposureBound(selected,today,tomorrow),periodMinor:recurringExposureBound(selected,period.from,period.until),
    observedSpendReceipt:spend.receipt,recurringExposure:selected};
}
