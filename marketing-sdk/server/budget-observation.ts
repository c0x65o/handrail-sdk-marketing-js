import type {MeasurementValue,MeasurementWindow} from '../core/measurement.js';
import {readObservedMeasurementSpend,measured,unknownMeasurement,type MeasurementWindowScope} from './measurement.js';
import {requireThat,type Store} from './store.js';
import {instant} from './validation.js';

export interface BudgetAccountingWindow {
  projectId:string;
  from:string;
  until:string;
  timezone:'UTC';
  currency:string;
  minorUnitsPerMajor:number;
}
export interface BudgetSpendObservation {
  basis:'observed_provider_calendar_upper_bound';
  accountingWindow:BudgetAccountingWindow;
  observedSpendUpperBoundMinor:MeasurementValue;
  evidenceIds:string[];
  components:{nativeCampaignId:string;provider:string;accountId:string;campaignIds:string[];
    providerWindow:MeasurementWindow;evidenceIds:string[];observedSpendMinor:MeasurementValue}[];
  observationComplete:boolean;
  oldestCollectedAt:string|null;
  newestCollectedAt:string|null;
  asOf:string;
  reasons:string[];
  reportingLagUnbounded:true;
}

/** Read a conservative bound on observed spend for budget admission. Each
 * provider window must contain the accounting interval through asOf. Wider
 * boundary days are intentionally included, never prorated or relabelled as
 * comparable performance. Provider reporting lag remains explicitly unbounded.
 * Scope inventory and spending authority belong to the trusted host. */
export async function readBudgetSpendObservation(store:Pick<Store,'list'>,
  scopes:(MeasurementWindowScope&{window:MeasurementWindow;campaignIds:string[]})[],
  accountingWindow:BudgetAccountingWindow,options:{asOf:string;maxAgeMs:number}):Promise<BudgetSpendObservation>{
  instant(accountingWindow.from);instant(accountingWindow.until);instant(options.asOf);
  const from=Date.parse(accountingWindow.from),until=Date.parse(accountingWindow.until),asOf=Date.parse(options.asOf);
  requireThat(accountingWindow.timezone==='UTC'&&from<until&&asOf>=from&&asOf<until&&
    /^[A-Z]{3}$/.test(accountingWindow.currency)&&Number.isSafeInteger(accountingWindow.minorUnitsPerMajor)&&accountingWindow.minorUnitsPerMajor>0&&
    Number.isSafeInteger(options.maxAgeMs)&&options.maxAgeMs>=0,'invalid_budget_observation_window');
  requireThat(scopes.every(scope=>scope.projectId===accountingWindow.projectId),'budget_observation_project_mismatch',403);
  const nativeIds=new Set<string>();
  const reasons:string[]=[],ids=new Set<string>(),evidenceIds=new Set<string>(),collected:string[]=[],components:BudgetSpendObservation['components']=[];
  if(!scopes.length)reasons.push('no_measurement_scope');
  let total=0;
  for(const scope of scopes){
    if(nativeIds.has(scope.nativeCampaignId))reasons.push('overlapping_native_campaign_scope');
    nativeIds.add(scope.nativeCampaignId);
    if(scope.window.currency!==accountingWindow.currency||scope.window.minorUnitsPerMajor!==accountingWindow.minorUnitsPerMajor)
      reasons.push('budget_observation_currency_mismatch');
    if(!(Date.parse(scope.window.from)<=from&&Date.parse(scope.window.until)>asOf))reasons.push('provider_window_does_not_cover_accounting_interval');
    for(const id of scope.campaignIds){
      const account=scope.accountId.replace(/^act_|^urn:li:sponsoredAccount:/,'');
      const identity=JSON.stringify([scope.provider,account,id.replace(/^urn:li:sponsoredCampaign:/,'')]);
      if(ids.has(identity))reasons.push('overlapping_campaign_evidence');ids.add(identity);
    }
    const observed=await readObservedMeasurementSpend(store,[scope],options);
    for(const id of observed.evidenceIds)evidenceIds.add(id);
    reasons.push(...observed.reasons);
    if(observed.oldestCollectedAt)collected.push(observed.oldestCollectedAt);
    if(observed.newestCollectedAt)collected.push(observed.newestCollectedAt);
    components.push({nativeCampaignId:scope.nativeCampaignId,provider:scope.provider,accountId:scope.accountId,
      campaignIds:[...scope.campaignIds],providerWindow:{...scope.window},evidenceIds:observed.evidenceIds,observedSpendMinor:observed.spendMinor});
    if(!observed.observationComplete||observed.spendMinor.value===null)reasons.push('incomplete_campaign_spend_observation');
    else total+=observed.spendMinor.value;
  }
  if(!Number.isSafeInteger(total))reasons.push('measurement_sum_overflow');
  collected.sort((a,b)=>Date.parse(a)-Date.parse(b));
  const unique=[...new Set(reasons)];
  return {basis:'observed_provider_calendar_upper_bound',accountingWindow:{...accountingWindow},
    observedSpendUpperBoundMinor:unique.length?unknownMeasurement(unique.join(';')):measured(total),
    evidenceIds:[...evidenceIds],components,observationComplete:unique.length===0,
    oldestCollectedAt:collected[0]??null,newestCollectedAt:collected.at(-1)??null,asOf:options.asOf,reasons:unique,reportingLagUnbounded:true};
}
