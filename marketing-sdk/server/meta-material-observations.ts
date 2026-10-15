import {digest,requireThat} from './store.js';
import {exactTargeting} from './capabilities.js';
import type {Material} from '../core/index.js';

export const META_OBSERVATION_KEYS=['campaign.objective','campaign.specialAdCategories','campaign.budgetSharing','campaign.spendCap',
  'adset.dailyBudgetMinor','adset.lifetimeBudgetMinor','adset.startAt','adset.endAt','adset.billingEvent','adset.optimizationGoal',
  'adset.bidStrategy','adset.destinationType','adset.promotedObject','adset.attribution','adset.expansion','adset.targetingSummary',
  'adset.rawTargeting','creative.summary','creative.features'] as const;
export type MetaObservationKey=typeof META_OBSERVATION_KEYS[number];
export interface RetainedMetaObservation {key:MetaObservationKey;value:unknown;provenance:'legacy_observation'|'legacy_intent';historyRecordId:string}
export interface MetaMaterialReconciliation {
  id:string;method:'current_provider_state_with_retained_observations';materialDigest:string;observedTermsDigest:string;
  observedTerms:{campaign:Record<string,unknown>;adset:Record<string,unknown>;creative:Record<string,unknown>};
  observedAt:string;historyRecordIds:string[];originalMaterialFullyKnown:false;materialApproved:false;spendingAuthorityGranted:false;
  comparisons:{key:MetaObservationKey;retained:RetainedMetaObservation|null;current:unknown;currentPresent:boolean;
    status:'equal'|'different'|'unknown_retained'|'current_not_returned';missingReason:string|null}[];
}
const expansion=(v:any)=>Array.isArray(v)?Object.fromEntries(v.map(x=>[x.key,x.value])):v;
const optionalMoney=(v:unknown)=>v===undefined?undefined:typeof v==='string'&&/^\d+$/.test(v)?Number(v):v;
export function metaMaterialObservations(observed:{campaign:any;adset:any;creative:any}):Record<MetaObservationKey,unknown>{
  const {campaign:c,adset:a,creative:r}=observed,t=a.targeting,link=r.object_story_spec?.link_data,story=r.object_story_spec;
  return {'campaign.objective':c.objective,'campaign.specialAdCategories':c.special_ad_categories,'campaign.budgetSharing':c.is_adset_budget_sharing_enabled,'campaign.spendCap':optionalMoney(c.spend_cap),
    'adset.dailyBudgetMinor':optionalMoney(a.daily_budget),'adset.lifetimeBudgetMinor':optionalMoney(a.lifetime_budget),
    'adset.startAt':a.start_time==null?a.start_time:new Date(a.start_time).toISOString(),'adset.endAt':a.end_time==null?a.end_time:new Date(a.end_time).toISOString(),
    'adset.billingEvent':a.billing_event,'adset.optimizationGoal':a.optimization_goal,'adset.bidStrategy':a.bid_strategy,'adset.destinationType':a.destination_type,
    'adset.promotedObject':a.promoted_object,'adset.attribution':a.attribution_spec,'adset.expansion':expansion(a.targeting_optimization_types),
    'adset.targetingSummary':t?{age_max:t.age_max,age_min:t.age_min,locales:t.locales??[],countries:t.geo_locations?.countries??[],
      interest_ids:(t.flexible_spec??[]).flatMap((g:any)=>(g.interests??[]).map((x:any)=>x.id)),advantage_audience:t.targeting_automation?.advantage_audience,
      facebook_positions:t.facebook_positions??[],instagram_positions:t.instagram_positions??[],publisher_platforms:t.publisher_platforms??[],
      excluded_custom_audience_ids:(t.excluded_custom_audiences??[]).map((x:any)=>x.id)}:undefined,
    'adset.rawTargeting':t,'creative.summary':link?{page_id:story.page_id,headline:link.name,url_tags:r.url_tags??'',description:link.description??'',
      image_hashes:link.image_hash?[link.image_hash]:[],primary_text:link.message,call_to_action:link.call_to_action?.type,destination_url:link.link,
      call_to_action_url:link.call_to_action?.value?.link,instagram_actor_id:story.instagram_user_id??''}:undefined,
    'creative.features':r.degrees_of_freedom_spec};
}
export function reconcileMetaObservations(retained:RetainedMetaObservation[],observed:{campaign:any;adset:any;creative:any},
  observedTerms:MetaMaterialReconciliation['observedTerms'],material:Material):MetaMaterialReconciliation {
  requireThat(Array.isArray(retained)&&retained.length>0&&new Set(retained.map(x=>x.key)).size===retained.length&&retained.every(x=>
    META_OBSERVATION_KEYS.includes(x.key)&&x.value!==undefined&&x.value!==null&&['legacy_observation','legacy_intent'].includes(x.provenance)&&/^[a-f0-9]{64}$/.test(x.historyRecordId)),
    'existing_material_observations_invalid');
  const current=metaMaterialObservations(observed);
  const comparisons:MetaMaterialReconciliation['comparisons']=META_OBSERVATION_KEYS.map(key=>{
    const original=retained.find(x=>x.key===key)??null,value=current[key],present=value!==undefined;
    const comparable=key==='adset.expansion'?expansion(original?.value):original?.value;
    return {key,retained:original?structuredClone(original):null,current:present?structuredClone(value):null,currentPresent:present,
      status:!original?'unknown_retained':!present?'current_not_returned':exactTargeting(comparable,value)?'equal':'different',
      missingReason:!original?'historical_field_not_retained':!present?'provider_field_not_returned':null};
  });
  const body={method:'current_provider_state_with_retained_observations' as const,materialDigest:digest(material),observedTermsDigest:digest(observedTerms),
    observedTerms:structuredClone(observedTerms),observedAt:new Date().toISOString(),historyRecordIds:[...new Set(retained.map(x=>x.historyRecordId))].sort(),
    originalMaterialFullyKnown:false as const,materialApproved:false as const,spendingAuthorityGranted:false as const,comparisons};
  return {id:`material_${digest(body)}`,...body};
}
