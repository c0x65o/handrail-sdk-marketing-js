import { CAPABILITY_VERSION, type Grant, type Material, type MetaSettings, type TargetingOption } from "../core/index.js";
import { exactTargeting, metaExpansionMatches, metaTargeting } from "./capabilities.js";
import { digest, requireThat, DomainError } from "./store.js";
import { material as validateMaterial } from "./validation.js";
import {reconcileMetaObservations,type RetainedMetaObservation} from './meta-material-observations.js';

/** Original native facts bound by the host to immutable history. This is not an
 * approval or provider-read receipt. Missing material must be reconciled first. */
export interface ExistingMetaMaterialSource {
  name: string; headline: string; body: string; destination: string; destinationDigest: string;
  assetId: string; purpose: Material["purpose"]; campaignDailyCeiling: number;
  policy: { nondiscriminationAccepted: boolean|null; receiptRefs: string[]; missingReason?:string };
  conversion: NonNullable<MetaSettings["conversion"]>;
  retainedProviderTerms: { campaign: Record<string, unknown>; adset: Record<string, unknown>; creative: Record<string, unknown> };
}
export interface ReconciledMetaMaterialSource extends Omit<ExistingMetaMaterialSource,'retainedProviderTerms'> {
  retainedObservations:RetainedMetaObservation[];
}
export function reconcileExistingMetaMaterial(source:ReconciledMetaMaterialSource,grant:Grant,
  ids:{campaign:string;adset:string;creative:string;image:string},observed:{campaign:any;adset:any;creative:any}) {
  const result=materialFromObservation(source,grant,ids,observed);
  return {...result,materialReconciliation:reconcileMetaObservations(source.retainedObservations,observed,existingMetaTerms(observed),result.material)};
}
export const META_EXISTING_FIELDS = {
  campaign: "id,account_id,objective,special_ad_categories,special_ad_category_country,is_adset_budget_sharing_enabled,spend_cap,status,effective_status",
  adset: "id,account_id,campaign_id,billing_event,optimization_goal,bid_strategy,daily_budget,lifetime_budget,start_time,end_time,targeting,destination_type,promoted_object,targeting_optimization_types,attribution_spec,status,effective_status",
  creative: "id,account_id,object_story_spec,url_tags,degrees_of_freedom_spec",
} as const;

/** Preserve complete requested material, including absence, rather than silently
 * replacing provider defaults. Identity/status are independently validated. */
export function existingMetaTerms(observed: {campaign: any; adset: any; creative: any}) {
  const strip = (row: any, keys: string[]) => Object.fromEntries(Object.entries(row).filter(([k]) => !keys.includes(k)));
  return {campaign:strip(observed.campaign,["id","account_id","status","effective_status"]),
    adset:strip(observed.adset,["id","account_id","campaign_id","status","effective_status"]),
    creative:strip(observed.creative,["id","account_id"])};
}

export function existingMetaMaterial(source: ExistingMetaMaterialSource, grant: Grant,
  ids: {campaign:string; adset:string; creative:string; image:string}, observed: {campaign:any; adset:any; creative:any}) {
  requireThat(digest(existingMetaTerms(observed))===digest(source.retainedProviderTerms), "existing_material_retained_terms_changed");
  return materialFromObservation(source,grant,ids,observed);
}

/** Current representation is separate from comparison with original evidence. */
function materialFromObservation(source: Omit<ExistingMetaMaterialSource,'retainedProviderTerms'>, grant:Grant,
  ids:{campaign:string;adset:string;creative:string;image:string},observed:{campaign:any;adset:any;creative:any}) {
  const {campaign,adset,creative}=observed;
  requireThat(grant.provider==="meta" && /^act_\d+$/.test(grant.accountId) && grant.pageId, "existing_material_account_invalid");
  requireThat(source.purpose==="acquisition" && [true,false,null].includes(source.policy.nondiscriminationAccepted) &&
    (source.policy.nondiscriminationAccepted!==null || typeof source.policy.missingReason==="string"&&source.policy.missingReason.length>0) &&
    source.policy.receiptRefs.length>0 && source.policy.receiptRefs.every(x=>typeof x==="string"&&x.length>0), "existing_material_policy_unverified");
  const account=grant.accountId.slice(4);
  requireThat([campaign,adset,creative].every(row=>String(row.account_id)===account) &&
    campaign.id===ids.campaign && adset.id===ids.adset && creative.id===ids.creative && adset.campaign_id===ids.campaign, "existing_material_account_mismatch");
  requireThat(campaign.status==="PAUSED" && campaign.effective_status==="PAUSED" && adset.status==="PAUSED" &&
    ["PAUSED","CAMPAIGN_PAUSED"].includes(adset.effective_status), "existing_campaign_not_paused");
  requireThat(campaign.objective==="OUTCOME_LEADS" && exactTargeting(campaign.special_ad_categories,[]) &&
    (campaign.special_ad_category_country===undefined || exactTargeting(campaign.special_ad_category_country,[])) &&
    campaign.is_adset_budget_sharing_enabled===false && adset.billing_event==="IMPRESSIONS" &&
    adset.optimization_goal==="OFFSITE_CONVERSIONS" && adset.bid_strategy==="LOWEST_COST_WITHOUT_CAP" && adset.destination_type==="WEBSITE",
    "existing_material_delivery_unsupported");
  const hasSmartPse=Object.hasOwn(adset.promoted_object??{},'smart_pse_enabled');
  requireThat(!hasSmartPse||typeof adset.promoted_object.smart_pse_enabled==='boolean','existing_material_smart_pse_invalid');
  if(source.conversion.event!=="Lead" || !exactTargeting(adset.promoted_object,{pixel_id:source.conversion.pixelId,custom_event_type:"LEAD",
    ...(hasSmartPse?{smart_pse_enabled:adset.promoted_object.smart_pse_enabled}:{})})) {
    const promoted=adset.promoted_object,object=promoted&&typeof promoted==='object'&&!Array.isArray(promoted);
    const keys=object?Object.keys(promoted):[];
    // Bounded schema diagnostics only: never copy unknown provider values,
    // tokens, URLs, identifiers or nested payloads into an error response.
    const fields=keys.slice(0,30).map(key=>({field:/^[a-z_]{1,64}$/.test(key)?key:'[unrecognized]',
      type:promoted[key]===null?'null':Array.isArray(promoted[key])?'array':typeof promoted[key]}));
    throw Object.assign(new DomainError('existing_material_conversion_mismatch'),{materialDiagnostic:{phase:'provider_conversion',
      expectedEvent:'LEAD',sourceEventSupported:source.conversion.event==='Lead',promotedObjectPresent:promoted!==undefined&&promoted!==null,
      promotedObjectIsObject:Boolean(object),pixelIdentityMatches:object&&promoted.pixel_id===source.conversion.pixelId,
      eventMatches:object&&promoted.custom_event_type==='LEAD',fieldCount:keys.length,fields,fieldsTruncated:keys.length>30}});
  }
  const money=(raw:unknown,required=false)=>{
    requireThat(raw===undefined&&!required || typeof raw==="string"&&/^\d+$/.test(raw), "existing_material_money_unknown");
    if(raw===undefined)return null;
    const minor=Number(raw);requireThat(Number.isSafeInteger(minor)&&minor>=0&&minor<=1e9, "existing_material_money_invalid");
    return minor===0?null:{currency:grant.currency,minor};
  };
  const daily=money(adset.daily_budget,true), lifetime=money(campaign.spend_cap);
  requireThat(daily && !money(adset.lifetime_budget), "existing_material_budget_mode_unsupported");
  const t=adset.targeting;
  requireThat(t && t.targeting_automation?.advantage_audience===1 && Array.isArray(t.flexible_spec) && t.flexible_spec.length>0,
    "existing_material_targeting_unsupported");
  const options:TargetingOption[]=[];
  const option=(kind:TargetingOption["kind"],id:unknown,label:unknown=id)=>{
    requireThat(typeof id==="string"&&/^\d+$/.test(id)&&typeof label==="string"&&label.length>0,"existing_material_targeting_unsupported");
    const row={id:id as string,label:label as string};
    if(!options.some(x=>x.kind===kind&&x.id===id))options.push({kind,...row});return row;
  };
  requireThat(t.locales===undefined || Array.isArray(t.locales)&&t.locales.every((x:unknown)=>Number.isSafeInteger(x)&&Number(x)>0),"existing_material_targeting_unsupported");
  const languages=(t.locales??[]).map((id:number)=>option("languages",String(id)));
  const interestGroups=t.flexible_spec.map((group:any)=>{
    requireThat(group&&Object.keys(group).length===1&&Array.isArray(group.interests),"existing_material_targeting_unsupported");
    return group.interests.map((x:any)=>{requireThat(x&&Object.keys(x).every(k=>["id","name"].includes(k)),"existing_material_targeting_unsupported");return option("interests",x.id,x.name);});
  });
  const excluded=(t.excluded_custom_audiences??[]).map((x:any)=>option("customAudiences",x.id,x.name));
  const expansionEntries=Array.isArray(adset.targeting_optimization_types)?adset.targeting_optimization_types:
    Object.entries(adset.targeting_optimization_types??{}).map(([key,value])=>({key,value}));
  const bits=Object.fromEntries(expansionEntries.map((x:any)=>[x.key,x.value]));
  requireThat([bits.detailed_targeting,bits.lookalike].every(x=>x===0||x===1) && metaExpansionMatches(adset.targeting_optimization_types,bits as any),"existing_material_expansion_unknown");
  const story=creative.object_story_spec, link=story?.link_data;
  requireThat(story?.page_id===grant.pageId && link?.image_hash===ids.image && link?.name===source.headline && link?.message===source.body &&
    link?.link===source.destination && exactTargeting(link?.call_to_action,{type:"LEARN_MORE",value:{link:source.destination}}),"existing_material_original_creative_mismatch");
  const features=creative.degrees_of_freedom_spec?.creative_features_spec;
  requireThat(creative.degrees_of_freedom_spec===undefined || Object.keys(creative.degrees_of_freedom_spec).length===1&&features&&
    Object.values(features).every((v:any)=>v&&Object.keys(v).length===1&&["OPT_IN","OPT_OUT"].includes(v.enroll_status)),"existing_material_creative_features_unknown");
  requireThat(Array.isArray(adset.attribution_spec)&&adset.attribution_spec.every((x:any)=>x&&Object.keys(x).length===2),"existing_material_attribution_unknown");
  const settings:MetaSettings={version:CAPABILITY_VERSION,provider:"meta",apiVersion:"v26.0",accountId:grant.accountId,format:"single_image",
    objective:"OUTCOME_LEADS",optimization:"OFFSITE_CONVERSIONS",delivery:"advantage_plus_interests",nondiscriminationAccepted:source.policy.nondiscriminationAccepted,
    placements:[],identity:{pageId:grant.pageId!},conversion:{pixelId:source.conversion.pixelId,event:"Lead",...(hasSmartPse?{smartPseEnabled:adset.promoted_object.smart_pse_enabled}:{})},
    attribution:adset.attribution_spec.map((x:any)=>({eventType:x.event_type,windowDays:x.window_days})),
    targeting:{languages,interestGroups,excludedCustomAudiences:excluded,
      ...(t.geo_locations?.location_types ? {locationTypes:structuredClone(t.geo_locations.location_types)}:{}),
      expansion:{detailedTargeting:bits.detailed_targeting,lookalike:bits.lookalike}},
    creative:{...(link.description!==undefined?{description:link.description}:{}),...(creative.url_tags!==undefined?{urlTags:creative.url_tags}:{}),
      ...(features?{features:Object.fromEntries(Object.entries(features).map(([k,v]:[string,any])=>[k,v.enroll_status]))}:{})}};
  requireThat(Array.isArray(t.publisher_platforms),"existing_material_placement_unknown");
  for(const platform of t.publisher_platforms){
    requireThat(["facebook","instagram"].includes(platform),"existing_material_placement_unsupported");
    settings.placements.push(platform==="facebook"?"facebook_feed":"instagram_feed");
  }
  if(settings.placements.includes("instagram_feed"))settings.identity.instagramUserId=grant.instagramUserId;
  const instant=(value:unknown)=>{requireThat(typeof value==="string"&&/T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(value)&&Number.isFinite(Date.parse(value)),"existing_material_schedule_unknown");return new Date(value as string).toISOString();};
  const material:Material={name:source.name,headline:source.headline,body:source.body,destination:source.destination,destinationDigest:source.destinationDigest,
    assetIds:[source.assetId],purpose:source.purpose,settings,
    audience:{provider:"meta",locations:structuredClone(t.geo_locations?.countries),ageMin:t.age_min,ageMax:t.age_max,expansion:true},
    budget:lifetime,advertisingBudget:{daily:daily!,...(lifetime?{lifetime}:{}),campaignDailyCeiling:{currency:grant.currency,minor:source.campaignDailyCeiling}},
    startAt:instant(adset.start_time),endAt:adset.end_time==null?null:instant(adset.end_time),timezone:grant.timezone};
  validateMaterial(material,"meta");
  requireThat(exactTargeting(t,metaTargeting({material} as any,settings)),"existing_material_targeting_unsupported");
  requireThat(exactTargeting(story,{page_id:settings.identity.pageId,...(settings.identity.instagramUserId?{instagram_user_id:settings.identity.instagramUserId}:{}),
    link_data:{image_hash:ids.image,link:source.destination,message:source.body,name:source.headline,
      ...(settings.creative?.description!==undefined?{description:settings.creative.description}:{}),call_to_action:{type:"LEARN_MORE",value:{link:source.destination}}}}),"existing_material_creative_unsupported");
  return {material,targetingOptions:options,policyEvidence:structuredClone(source.policy)};
}
