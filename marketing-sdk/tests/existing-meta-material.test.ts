import test from "node:test";
import {createElement} from "react";
import {createRequire} from "node:module";
const {renderToStaticMarkup} = createRequire(import.meta.url)("react-dom/server") as {renderToStaticMarkup:(element:ReturnType<typeof createElement>)=>string};
import {MaterialReview} from "../react/index.js";
import {GuidedFields} from "../react/guided.js";
import assert from "node:assert/strict";
import { NativeProvider, providerPlan, type VaultPort } from "../server/providers.js";
import { Store } from "../server/store.js";
import { existingMetaTerms, type ExistingMetaMaterialSource, type ReconciledMetaMaterialSource } from "../server/existing-meta-material.js";
import { capabilityStatus, type Grant, type Campaign, type Asset } from "../core/index.js";

function fixture() {
  const grant:Grant={id:"g",projectId:"p",revision:1,provider:"meta",accountId:"act_123",pageId:"42",label:"Fixture",currency:"USD",timezone:"America/Chicago",
    permissions:["pause","report"],expiresAt:"2099-01-01T00:00:00Z",revokedAt:null,secretRef:"opaque"};
  const ids={campaign:"100",adset:"101",creative:"102",image:"a".repeat(32)};
  const source:ExistingMetaMaterialSource={name:"Original",headline:"Headline",body:"Body",destination:"https://example.com/lead",destinationDigest:"a".repeat(64),assetId:"original-asset",purpose:"acquisition",campaignDailyCeiling:1500,
    policy:{nondiscriminationAccepted:true,receiptRefs:["retained-native-policy"]},conversion:{pixelId:"60",event:"Lead"},retainedProviderTerms:null as any};
  const observed:any={campaign:{id:"100",account_id:"123",objective:"OUTCOME_LEADS",special_ad_categories:[],is_adset_budget_sharing_enabled:false,status:"PAUSED",effective_status:"PAUSED"},
    adset:{id:"101",account_id:"123",campaign_id:"100",billing_event:"IMPRESSIONS",optimization_goal:"OFFSITE_CONVERSIONS",bid_strategy:"LOWEST_COST_WITHOUT_CAP",daily_budget:"1500",lifetime_budget:"0",start_time:"2026-10-07T22:36:26-0500",status:"PAUSED",effective_status:"CAMPAIGN_PAUSED",destination_type:"WEBSITE",promoted_object:{pixel_id:"60",custom_event_type:"LEAD"},
      targeting:{geo_locations:{countries:["US"],location_types:["frequently_in","home","recent"]},age_min:18,age_max:65,locales:[6],publisher_platforms:["facebook"],facebook_positions:["feed"],flexible_spec:[{interests:[{id:"10",name:"Wholesale"}]}],targeting_automation:{advantage_audience:1}},
      targeting_optimization_types:[{key:"detailed_targeting",value:1},{key:"lookalike",value:0}],attribution_spec:[{event_type:"CLICK_THROUGH",window_days:7},{event_type:"VIEW_THROUGH",window_days:1}]},
    creative:{id:"102",account_id:"123",object_story_spec:{page_id:"42",link_data:{image_hash:ids.image,link:source.destination,message:source.body,name:source.headline,description:"Original description",call_to_action:{type:"LEARN_MORE",value:{link:source.destination}}}},url_tags:"utm_source={{site_source_name}}&meta_ad_id={{ad.id}}",degrees_of_freedom_spec:{creative_features_spec:{image_touchups:{enroll_status:"OPT_OUT"},text_generation:{enroll_status:"OPT_OUT"}}}}};
  source.retainedProviderTerms=structuredClone(existingMetaTerms(observed));
  const calls:string[]=[];let afterFetch=()=>{};
  const vault:VaultPort={use:async()=>{throw Error("write custody prohibited");},useReadOnly:async(g,guard,fn)=>{assert.equal(g,grant);await guard();return fn({accessToken:"synthetic-private-token",expiresAt:Date.parse(grant.expiresAt ?? ""),scopes:["ads_management"]});}};
  const provider=new NativeProvider("meta",vault,null as unknown as Store,async(input,init)=>{
    const url=new URL(String(input));calls.push(url.pathname);assert.equal(init?.method,"GET");assert.equal(init?.redirect,"error");
    let body:any;
    if(url.pathname==="/v26.0/act_123")body={id:"act_123",currency:"USD",timezone_name:"America/Chicago"};
    else if(url.pathname==='/v26.0/act_123/adimages')body={data:[{hash:ids.image,status:'ACTIVE'}]};
    else if(url.pathname==='/v26.0/100/adsets')body={data:[observed.adset]};
    else if(url.pathname==='/v26.0/100/ads')body={data:[{id:'103',account_id:'123',campaign_id:'100',adset_id:'101',creative:{id:'102'},status:'PAUSED',effective_status:'PAUSED'}]};
    else if(url.pathname==='/v26.0/103')body={id:'103',account_id:'123',campaign_id:'100',adset_id:'101',creative:{id:'102'},status:'PAUSED',effective_status:'PAUSED'};
    else {const key=Object.keys(ids).find(k=>ids[k as keyof typeof ids]===url.pathname.split("/").at(-1));assert.ok(key);body=observed[key];}
    const response=Response.json(body);afterFetch();return response;
  });
  return {source,grant,ids,observed,provider,calls,afterFetch:(fn:()=>void)=>{afterFetch=fn;},capture:(guard=async()=>{})=>provider.captureExistingMetaMaterial(grant,ids,source,guard)};
}
test("Meta native capture preserves original expanded lead material, creative tags/features, timezone and daily ceiling without authority",async()=>{
  const f=fixture(),r=await f.capture(),m=r.material;
  assert.equal(f.calls.length,4);assert.equal(r.executionReady,false);assert.equal(r.providerMaterialDigest.length,64);
  assert.equal(m.startAt,"2026-10-08T03:36:26.000Z");assert.equal(m.endAt,null);assert.equal(m.timezone,"America/Chicago");
  assert.equal(m.budget,null);assert.deepEqual(m.advertisingBudget,{daily:{currency:"USD",minor:1500},campaignDailyCeiling:{currency:"USD",minor:1500}});
  assert.equal(m.audience.expansion,true);assert.equal(m.settings?.provider,"meta");
  if(m.settings?.provider!=="meta")throw Error("Meta required");
  assert.deepEqual(m.settings.conversion,{pixelId:"60",event:"Lead"});
  assert.equal(m.settings.creative?.description,"Original description");assert.equal(m.settings.creative?.urlTags,f.observed.creative.url_tags);
  assert.deepEqual(m.settings.targeting.expansion,{detailedTargeting:1,lookalike:0});
  assert.ok(capabilityStatus(m,f.grant).blockers.includes("campaign_daily_exposure_exceeded"));
  assert.deepEqual(f.grant.permissions,["pause","report"]);assert.equal(f.grant.targetingOptions,undefined);
  const c={id:"c",projectId:"p",grantId:"g",material:m} as Campaign;
  const g={...f.grant,targetingOptions:r.targetingOptions};
  const a={id:"original-asset",projectId:"p",campaignId:"c",kind:"image",digest:"b".repeat(64)} as Asset;
  const plan:any=providerPlan(c,g,[a]);assert.equal(plan.readbackVersion,"5");
  assert.equal(plan.adset.promoted_object.custom_event_type,"LEAD");assert.equal(plan.adset.targeting.targeting_automation.advantage_audience,1);
  assert.equal(plan.creative.description,"Original description");assert.deepEqual(plan.creative.degrees_of_freedom_spec,f.observed.creative.degrees_of_freedom_spec);
});
for(const [label,mutate] of Object.entries({
  expansion:(f:ReturnType<typeof fixture>)=>{f.observed.adset.targeting_optimization_types[1].value=1;},
  budget:(f:ReturnType<typeof fixture>)=>{f.observed.adset.daily_budget="1600";},
  attribution:(f:ReturnType<typeof fixture>)=>{f.observed.adset.attribution_spec[0].window_days=1;},
  description:(f:ReturnType<typeof fixture>)=>{f.observed.creative.object_story_spec.link_data.description="Changed";},
  tracking:(f:ReturnType<typeof fixture>)=>{delete f.observed.creative.url_tags;},
  creativeFeature:(f:ReturnType<typeof fixture>)=>{f.observed.creative.degrees_of_freedom_spec.creative_features_spec.image_touchups.enroll_status="OPT_IN";},
}))test(`Meta capture retains discrepant ${label} as a rejection instead of rewriting history`,async()=>{
  const f=fixture(),original=structuredClone(f.source.retainedProviderTerms);mutate(f);
  await assert.rejects(f.capture(),/existing_material_retained_terms_changed/);assert.deepEqual(f.source.retainedProviderTerms,original);
});
for(const [label,mutate] of Object.entries({
  wrongAccount:(f:ReturnType<typeof fixture>)=>{f.observed.adset.account_id="999";},
  wrongParent:(f:ReturnType<typeof fixture>)=>{f.observed.adset.campaign_id="999";},
  active:(f:ReturnType<typeof fixture>)=>{f.observed.campaign.effective_status="ACTIVE";},
  unknownEffective:(f:ReturnType<typeof fixture>)=>{delete f.observed.adset.effective_status;},
  unknownBudget:(f:ReturnType<typeof fixture>)=>{delete f.observed.adset.daily_budget;},
  unsupportedTarget:(f:ReturnType<typeof fixture>)=>{f.observed.adset.targeting.extra="unmodeled";},
  unknownExpansion:(f:ReturnType<typeof fixture>)=>{f.observed.adset.targeting_optimization_types[1].value=null;},
  duplicateExpansion:(f:ReturnType<typeof fixture>)=>{f.observed.adset.targeting_optimization_types.push(f.observed.adset.targeting_optimization_types[0]);},
  currencyCeiling:(f:ReturnType<typeof fixture>)=>{f.source.campaignDailyCeiling=1000;},
  purpose:(f:ReturnType<typeof fixture>)=>{f.source.purpose="recruitment";},
  conversion:(f:ReturnType<typeof fixture>)=>{f.source.conversion={pixelId:"999",event:"Lead"};},
  pixelMismatch:(f:ReturnType<typeof fixture>)=>{f.observed.adset.promoted_object.custom_event_type="PURCHASE";},
  creativeUnknown:(f:ReturnType<typeof fixture>)=>{f.observed.creative.object_story_spec.link_data.unmodeled=true;},
  featureUnknown:(f:ReturnType<typeof fixture>)=>{f.observed.creative.degrees_of_freedom_spec.creative_features_spec.image_touchups.extra=true;},
  startUnknown:(f:ReturnType<typeof fixture>)=>{f.observed.adset.start_time="2026-10-07T22:36:26";},
}))test(`Meta capture rejects ${label} even when retained observation matches`,async()=>{
  const f=fixture();mutate(f);f.source.retainedProviderTerms=structuredClone(existingMetaTerms(f.observed));await assert.rejects(f.capture());
});
test("Meta capture rechecks custody and exact source during reads",async()=>{
  const f=fixture();let revoked=false;f.afterFetch(()=>{revoked=true;});
  await assert.rejects(f.capture(async()=>{if(revoked)throw Error("fixture-revoked");}),/fixture-revoked/);
  const g=fixture();g.afterFetch(()=>{g.source.body="changed";});await assert.rejects(g.capture(),/existing_campaign_scope_changed/);
});

test("Meta review and editor retain acquisition outcome and expanded-audience disclosure",async()=>{
  const f=fixture(),r=await f.capture(),client:any={assetUrl:()=>"/fixture-image"};
  const review=renderToStaticMarkup(createElement(MaterialReview,{material:r.material,assets:[],client,grant:f.grant}));
  assert.match(review,/expansion on/);assert.match(review,/Standard Lead event/);assert.doesNotMatch(review,/Selected custom conversion/);
  const editor=renderToStaticMarkup(createElement(GuidedFields,{value:r.material,grant:f.grant,onChange:()=>{}}));
  assert.match(editor,/Lead Pixel/);assert.match(editor,/Original description/);assert.match(editor,/Tracking tags/);
  assert.doesNotMatch(editor,/Remove unused conversion fields/);
});


test("paused Meta material preserves unknown or declined policy without granting operational readiness",async()=>{
  for(const accepted of [null,false]) {
    const f=fixture();f.source.policy={nondiscriminationAccepted:accepted,receiptRefs:['original-history-record'],...(accepted===null?{missingReason:'native_acknowledgement_not_recorded'}:{})};
    const result=await f.capture();assert.equal(result.material.settings?.nondiscriminationAccepted,accepted);
    assert.deepEqual(result.policyEvidence,f.source.policy);
    if(accepted===null)assert.match(renderToStaticMarkup(createElement(GuidedFields,{value:result.material,grant:f.grant,onChange:()=>{}})),/Historical nondiscrimination acknowledgement is unknown/);
    assert.ok(capabilityStatus(result.material,f.grant).blockers.includes('nondiscrimination_notice_required'));
    const c={id:'c',projectId:'p',grantId:'g',material:result.material,state:'paused',receipt:null} as Campaign;
    const grant={...f.grant,targetingOptions:result.targetingOptions};
    const asset={id:'original-asset',projectId:'p',campaignId:'c',kind:'image',digest:'b'.repeat(64)} as Asset;
    assert.doesNotThrow(()=>providerPlan(c,grant,[asset]));
    const calls=f.calls.length;
    await assert.rejects(f.provider.prepare(c,grant,[asset],'not-authorized',async()=>{},async()=>{}),/nondiscrimination_notice_required/);
    assert.equal(f.calls.length,calls);assert.deepEqual(grant.permissions,['pause','report']);
  }
  const f=fixture();f.source.policy.nondiscriminationAccepted=null;await assert.rejects(f.capture(),/existing_material_policy_unverified/);
});

test('partial historical Meta observations preserve differences, intent provenance and unknowns without approval',async()=>{
  const f=fixture(),ref='a'.repeat(64),{retainedProviderTerms,...original}=f.source;
  const source={...original,policy:{nondiscriminationAccepted:null,receiptRefs:[ref],missingReason:'not_recorded'},retainedObservations:[
    {key:'campaign.objective' as const,value:'OUTCOME_LEADS',provenance:'legacy_intent' as const,historyRecordId:ref},
    {key:'adset.expansion' as const,value:[{key:'detailed_targeting',value:1},{key:'lookalike',value:1}],provenance:'legacy_observation' as const,historyRecordId:ref},
    {key:'adset.dailyBudgetMinor' as const,value:1500,provenance:'legacy_observation' as const,historyRecordId:ref},
    {key:'campaign.spendCap' as const,value:2000,provenance:'legacy_observation' as const,historyRecordId:ref}]};
  const before=structuredClone(source);
  const result=await f.provider.reconcileExistingMetaMaterial(f.grant,f.ids,source,async()=>{}),r=result.materialReconciliation;
  assert.equal(f.calls.length,4);assert.equal(result.executionReady,false);assert.equal(r.originalMaterialFullyKnown,false);
  assert.equal(r.materialApproved,false);assert.equal(r.spendingAuthorityGranted,false);assert.deepEqual(source,before);
  const item=(key:string)=>r.comparisons.find(x=>x.key===key)!;
  assert.equal(item('adset.expansion').status,'different');assert.equal(item('campaign.objective').retained?.provenance,'legacy_intent');
  assert.equal(item('adset.dailyBudgetMinor').status,'equal');assert.equal(item('campaign.spendCap').status,'current_not_returned');
  assert.equal(item('campaign.spendCap').currentPresent,false);assert.equal(item('adset.lifetimeBudgetMinor').current,0);
  assert.equal(item('adset.lifetimeBudgetMinor').status,'unknown_retained');assert.equal(item('adset.startAt').missingReason,'historical_field_not_retained');
  assert.deepEqual(r.observedTerms,existingMetaTerms(f.observed));
  assert.equal(result.material.settings?.nondiscriminationAccepted,null);
  assert.deepEqual(f.grant.permissions,['pause','report']);
  // Strict full-original capture remains strict; the new operation does not
  // silently reinterpret a full retained snapshot as partial observations.
  f.source.retainedProviderTerms.adset.targeting_optimization_types=[{key:'detailed_targeting',value:1},{key:'lookalike',value:1}];
  await assert.rejects(f.capture(),/existing_material_retained_terms_changed/);
});

test('reconciled Meta material rejects invalid retained references and revocation during provider reads',async()=>{
  const f=fixture(),{retainedProviderTerms,...original}=f.source;
  const retained={key:'campaign.objective' as const,value:'OUTCOME_LEADS',provenance:'legacy_observation' as const,historyRecordId:'a'.repeat(64)};
  for(const rows of [[],[{...retained,historyRecordId:'unbound'}],[retained,retained],[{...retained,value:null}]]) {
    await assert.rejects(f.provider.reconcileExistingMetaMaterial(f.grant,f.ids,{...original,retainedObservations:rows},async()=>{}),/existing_material_observations_invalid/);
  }
  let revoked=false;f.afterFetch(()=>{revoked=true;});
  await assert.rejects(f.provider.reconcileExistingMetaMaterial(f.grant,f.ids,{...original,retainedObservations:[retained]},async()=>{if(revoked)throw Error('revoked');}),/revoked/);
});


test('conversion mismatch exposes bounded schema diagnostics without unknown provider values',async()=>{
  const f=fixture();f.observed.adset.promoted_object.extra_provider_field={secret:'never-print-this',url:'https://private.invalid'};
  const {retainedProviderTerms,...source}=f.source;
  await assert.rejects(f.provider.reconcileExistingMetaMaterial(f.grant,f.ids,{...source,retainedObservations:[{key:'campaign.objective',value:'OUTCOME_LEADS',provenance:'legacy_intent',historyRecordId:'a'.repeat(64)}]},async()=>{}),error=>{
    const e=error as Error&{materialDiagnostic:any};assert.equal(e.message,'existing_material_conversion_mismatch');
    assert.equal(e.materialDiagnostic.pixelIdentityMatches,true);assert.equal(e.materialDiagnostic.eventMatches,true);
    assert.deepEqual(e.materialDiagnostic.fields.find((x:any)=>x.field==='extra_provider_field'),{field:'extra_provider_field',type:'object'});
    assert.doesNotMatch(JSON.stringify(e),/never-print-this|private.invalid/);return true;
  });
});


for(const flag of [undefined,false,true])test(`Meta Smart PSE ${flag} survives current capture, plan, exact readback and historical comparison`,async()=>{
  const f=fixture(),{retainedProviderTerms,...source}=f.source;
  if(flag!==undefined)f.observed.adset.promoted_object.smart_pse_enabled=flag;
  const result=await f.provider.reconcileExistingMetaMaterial(f.grant,f.ids,{...source,retainedObservations:[{key:'adset.promotedObject',value:retainedProviderTerms.adset.promoted_object,provenance:'legacy_observation',historyRecordId:'a'.repeat(64)}]},async()=>{});
  const settings=result.material.settings!;if(settings.provider!=='meta')throw Error('Meta required');
  let edited:any;
  const tree=GuidedFields({value:result.material,grant:f.grant,onChange:m=>{edited=m;}});
  const find=(node:any):any=>Array.isArray(node)?node.map(find).find(Boolean):node?.props?.label==='Lead Pixel'?node:node?.props?find(node.props.children):null;
  find(tree).props.onChange('61');assert.equal(edited.settings.conversion.pixelId,'61');
  assert.equal(edited.settings.conversion.smartPseEnabled,flag);assert.equal(Object.hasOwn(edited.settings.conversion,'smartPseEnabled'),flag!==undefined);

  const review=renderToStaticMarkup(createElement(MaterialReview,{material:result.material,assets:[],client:{assetUrl:()=>'/fixture'} as any,grant:f.grant}));
  if(flag===undefined)assert.doesNotMatch(review,/Meta Smart PSE/);else assert.match(review,new RegExp('Meta Smart PSE</dt><dd>'+ (flag?'Enabled':'Disabled')));
  assert.equal(settings.conversion?.smartPseEnabled,flag);assert.equal(Object.hasOwn(settings.conversion!,'smartPseEnabled'),flag!==undefined);
  assert.equal(result.materialReconciliation.comparisons.find(x=>x.key==='adset.promotedObject')!.status,flag===undefined?'equal':'different');
  f.grant.targetingOptions=result.targetingOptions;
  const c={id:'c',projectId:'p',grantId:'g',material:result.material,state:'paused',receipt:null} as Campaign;
  const assets=[{id:'original-asset',projectId:'p',campaignId:'c',kind:'image',digest:'b'.repeat(64)} as Asset];
  const plan:any=providerPlan(c,f.grant,assets);assert.deepEqual(plan.adset.promoted_object,f.observed.adset.promoted_object);
  assert.equal((await f.provider.inspectExistingCampaign(c,f.grant,assets,{...f.ids,ad:'103'},async()=>{})).candidateReceipt.intent,'paused');
  f.observed.adset.promoted_object.smart_pse_enabled=flag===true?false:true;
  await assert.rejects(f.provider.inspectExistingCampaign(c,f.grant,assets,{...f.ids,ad:'103'},async()=>{}),/promoted_object_mismatch/);
});
for(const value of [null,0,1,'false',{},[]])test(`Meta rejects non-Boolean Smart PSE ${JSON.stringify(value)}`,async()=>{
  const f=fixture();f.observed.adset.promoted_object.smart_pse_enabled=value;
  f.source.retainedProviderTerms=existingMetaTerms(f.observed);await assert.rejects(f.capture(),/existing_material_smart_pse_invalid/);
});

test('Meta broad Advantage+ adoption preserves absent interest suggestions through representation, plan and UI',async()=>{
  const f=fixture();delete f.observed.adset.targeting.flexible_spec;
  f.source.retainedProviderTerms=existingMetaTerms(f.observed);
  const r=await f.capture();assert.equal(r.material.settings?.provider,'meta');
  if(r.material.settings?.provider!=='meta')throw Error('Meta required');
  assert.equal(r.material.settings.delivery,'advantage_plus_broad');assert.deepEqual(r.material.settings.targeting.interestGroups,[]);
  assert.equal(r.material.audience.expansion,true);assert.deepEqual(r.material.settings.targeting.expansion,{detailedTargeting:1,lookalike:0});
  const c={id:'c',projectId:'p',grantId:'g',material:r.material} as Campaign,g={...f.grant,targetingOptions:r.targetingOptions};
  const a={id:'original-asset',projectId:'p',campaignId:'c',kind:'image',digest:'b'.repeat(64)} as Asset;
  const plan:any=providerPlan(c,g,[a]);assert.deepEqual(plan.adset.targeting,f.observed.adset.targeting);
  assert.equal(Object.hasOwn(plan.adset.targeting,'flexible_spec'),false);assert.equal(plan.readbackVersion,'5');
  const review=renderToStaticMarkup(createElement(MaterialReview,{material:r.material,assets:[],client:{assetUrl:()=>'/fixture'} as any,grant:g}));assert.match(review,/advantage_plus_broad/);
  const editor=renderToStaticMarkup(createElement(GuidedFields,{value:r.material,grant:g,onChange:()=>{}}));
  assert.match(editor,/Broad acquisition audience without interest suggestions/);assert.match(editor,/Lead Pixel/);assert.doesNotMatch(editor,/Remove unused conversion fields/);
  assert.ok(capabilityStatus(r.material,g).blockers.includes('campaign_daily_exposure_exceeded'));
  r.material.settings.targeting.interestGroups=[[{id:'10',label:'Invented'}]];
  assert.throws(()=>providerPlan(c,g,[a]),/explicit_expansion_required/);
});
for(const value of [null,[],{},[{interests:[]}]])test(`Meta broad mode never repairs malformed interest suggestions ${JSON.stringify(value)}`,async()=>{
  const f=fixture();f.observed.adset.targeting.flexible_spec=value;f.source.retainedProviderTerms=existingMetaTerms(f.observed);
  await assert.rejects(f.capture());
});

for(const [objective,optimization] of [['OUTCOME_AWARENESS','REACH'],['OUTCOME_TRAFFIC','LINK_CLICKS'],['OUTCOME_TRAFFIC','IMPRESSIONS'],['OUTCOME_TRAFFIC','REACH']])test(`existing Meta ${objective}/${optimization} retains non-conversion delivery through capture, plans and readback`,async()=>{
  const f=fixture();delete f.source.conversion;
  f.observed.campaign.objective=objective;f.observed.adset.optimization_goal=optimization;
  f.observed.adset.destination_type=objective==='OUTCOME_AWARENESS'?'UNDEFINED':'WEBSITE';
  if(objective==='OUTCOME_AWARENESS')f.observed.adset.promoted_object={page_id:'42'};else delete f.observed.adset.promoted_object;
  f.observed.adset.targeting.targeting_automation.advantage_audience=0;
  if(optimization==='LINK_CLICKS')delete f.observed.adset.targeting.flexible_spec;else f.observed.adset.targeting.targeting_optimization='none';
  f.observed.adset.targeting_optimization_types=[{key:'detailed_targeting',value:0},{key:'lookalike',value:0}];
  f.observed.adset.attribution_spec=[];
  f.source.retainedProviderTerms=existingMetaTerms(f.observed);
  const r=await f.capture(),m=r.material;
  if(m.settings?.provider!=='meta')throw Error('Meta required');
  assert.equal(m.settings.objective,objective);assert.equal(m.settings.optimization,optimization);
  assert.equal(m.settings.delivery,optimization==='LINK_CLICKS'?'ordinary':'strict');assert.equal(m.settings.conversion,undefined);
  assert.equal(m.audience.expansion,false);assert.deepEqual(m.settings.attribution,[]);
  const c={id:'c',projectId:'p',grantId:'g',material:m,state:'paused',receipt:null} as Campaign;
  f.grant.targetingOptions=r.targetingOptions;
  const g=f.grant,assets=[{id:'original-asset',projectId:'p',campaignId:'c',kind:'image',digest:'b'.repeat(64)} as Asset];
  const plan:any=providerPlan(c,g,assets);assert.equal(plan.campaign.objective,objective);assert.equal(plan.adset.optimization_goal,optimization);
  assert.deepEqual(plan.adset.attribution_spec,[]);assert.deepEqual(plan.adset.targeting,f.observed.adset.targeting);
  assert.equal(plan.adset.promoted_object?.pixel_id,undefined);
  assert.equal((await f.provider.inspectExistingCampaign(c,g,assets,{...f.ids,ad:'103'},async()=>{})).candidateReceipt.intent,'paused');
  const review=renderToStaticMarkup(createElement(MaterialReview,{material:m,assets:[],client:{assetUrl:()=>'/fixture'} as any,grant:g}));
  assert.match(review,/None configured/);assert.doesNotMatch(review,/Standard Lead event/);
  f.source.conversion={pixelId:'60',event:'Lead'};
  await assert.rejects(f.capture(),/existing_material_conversion_mismatch/);delete f.source.conversion;
  f.observed.adset.targeting_optimization_types[0].value=1;f.source.retainedProviderTerms=existingMetaTerms(f.observed);
  if(objective==='OUTCOME_AWARENESS')await assert.rejects(f.capture(),/existing_material_expansion_unknown/);
  else if(optimization==='LINK_CLICKS')await assert.rejects(f.capture(),/unsupported_objective_optimization/);
  else assert.equal((await f.capture()).material.audience.expansion,true);
});
test('existing Lead capture cannot treat empty attribution as unknown or non-conversion',async()=>{
  const f=fixture();f.observed.adset.attribution_spec=[];f.source.retainedProviderTerms=structuredClone(existingMetaTerms(f.observed));
  await assert.rejects(f.capture(),/explicit_attribution_required/);
});


test('current Meta creative selects one retained image without inventing historical conversion evidence',async()=>{
  const f=fixture(),{retainedProviderTerms,assetId,conversion,...original}=f.source;
  const source:ReconciledMetaMaterialSource={...original,conversionMissingReason:'historical_conversion_not_retained',
    imageCandidates:[{assetId:'unused-square',providerImageId:'b'.repeat(32),historyRecordId:'b'.repeat(64)},
      {assetId:assetId,providerImageId:f.ids.image,historyRecordId:'a'.repeat(64)},
      {assetId:'unused-story',providerImageId:'c'.repeat(32),historyRecordId:'c'.repeat(64)}],
    retainedObservations:[{key:'campaign.objective',value:'OUTCOME_LEADS',provenance:'legacy_intent',historyRecordId:'d'.repeat(64)}]};
  const {image,...ids}=f.ids,before=structuredClone(source);
  const result=await f.provider.reconcileExistingMetaMaterial(f.grant,ids,source,async()=>{});
  assert.deepEqual(result.selectedImage,source.imageCandidates![1]);assert.deepEqual(result.material.assetIds,[assetId]);
  if(result.material.settings?.provider!=='meta')throw Error('Meta required');
  assert.deepEqual(result.material.settings.conversion,conversion);
  assert.equal(result.materialReconciliation.comparisons.find(x=>x.key==='adset.promotedObject')?.status,'unknown_retained');
  assert.equal(result.materialReconciliation.spendingAuthorityGranted,false);assert.equal(result.executionReady,false);
  assert.deepEqual(source,before);assert.equal(f.calls.length,4);
  for(const mutate of [
    (s:ReconciledMetaMaterialSource)=>{s.imageCandidates![1]!.providerImageId='d'.repeat(32);},
    (s:ReconciledMetaMaterialSource)=>{s.imageCandidates!.push(s.imageCandidates![1]!);},
    (s:ReconciledMetaMaterialSource)=>{s.imageCandidates![0]!.assetId=assetId;},
    (s:ReconciledMetaMaterialSource)=>{s.imageCandidates![0]!.historyRecordId='not-retained';},
    (s:ReconciledMetaMaterialSource)=>{s.assetId=assetId;},
    (s:ReconciledMetaMaterialSource)=>{delete s.conversionMissingReason;},
    (s:ReconciledMetaMaterialSource)=>{s.conversion=conversion;},
    (s:ReconciledMetaMaterialSource)=>{s.retainedObservations.push({key:'adset.promotedObject',value:retainedProviderTerms.adset.promoted_object,provenance:'legacy_observation',historyRecordId:'a'.repeat(64)});},
  ]){const changed=structuredClone(source);mutate(changed);await assert.rejects(f.provider.reconcileExistingMetaMaterial(f.grant,ids,changed,async()=>{}));}
  f.observed.creative.asset_feed_spec={images:[{hash:image},{hash:'b'.repeat(32)}]};
  await assert.rejects(f.provider.reconcileExistingMetaMaterial(f.grant,ids,source,async()=>{}),/existing_material_asset_feed_unsupported/);
  delete f.observed.creative.asset_feed_spec;
  f.afterFetch(()=>{source.imageCandidates![0]!.assetId='changed';});
  await assert.rejects(f.provider.reconcileExistingMetaMaterial(f.grant,ids,source,async()=>{}),/existing_campaign_scope_changed/);
});

test('Meta single-image readback detects a provider asset feed added after capture',async()=>{
  const f=fixture(),r=await f.capture();f.grant.targetingOptions=r.targetingOptions;
  const c={id:'c',projectId:'p',grantId:'g',material:r.material,state:'paused',receipt:null} as Campaign;
  const assets=[{id:'original-asset',projectId:'p',campaignId:'c',kind:'image',digest:'b'.repeat(64)} as Asset];
  f.observed.creative.asset_feed_spec={images:[{hash:f.ids.image},{hash:'b'.repeat(32)}]};
  await assert.rejects(f.provider.inspectExistingCampaign(c,f.grant,assets,{...f.ids,ad:'103'},async()=>{}),/provider_asset_feed_unsupported/);
});

test("Meta existing Reels placement capture preserves exact positions and rejects implicit feed substitution",async()=>{
  const f=fixture(),target=f.observed.adset.targeting;
  target.facebook_positions=["facebook_reels","feed"];
  f.source.retainedProviderTerms=structuredClone(existingMetaTerms(f.observed));
  const result=await f.capture();
  assert.deepEqual(result.material.settings?.placements,["facebook_reels","facebook_feed"]);
  assert.equal(result.executionReady,false);
  const editor=renderToStaticMarkup(createElement(GuidedFields,{value:result.material,grant:f.grant,onChange:()=>{}}));
  assert.match(editor,/Facebook Reels/);assert.match(editor,/Instagram Reels/);
  assert.doesNotMatch(editor,/Feed placements/);
  for(const positions of [[],["story"],["facebook_reels","facebook_reels"]]){
    target.facebook_positions=positions;f.source.retainedProviderTerms=structuredClone(existingMetaTerms(f.observed));
    await assert.rejects(f.capture());
  }
});


for(const encoding of ['array','object'] as const)test(`Meta adoption preserves exact string expansion bits in ${encoding} provider readback`,async()=>{
  const f=fixture();f.observed.adset.targeting_optimization_types=encoding==='array'
    ?[{key:'detailed_targeting',value:'1'},{key:'lookalike',value:'0'}]:{detailed_targeting:'1',lookalike:'0'};
  f.source.retainedProviderTerms=structuredClone(existingMetaTerms(f.observed));
  const retained=structuredClone(f.source.retainedProviderTerms),r=await f.capture();
  assert.deepEqual(r.material.settings?.provider==='meta'&&r.material.settings.targeting.expansion,{detailedTargeting:1,lookalike:0});
  assert.deepEqual(f.source.retainedProviderTerms,retained);
});
for(const [label,value] of Object.entries({missing:undefined,empty:[],nullEntry:[null],privateValue:[{key:'detailed_targeting',value:'synthetic-private-token'},{key:'lookalike',value:0}],
  booleanBits:{detailed_targeting:true,lookalike:false},whitespaceBits:{detailed_targeting:' 1',lookalike:'0'},missingBit:{detailed_targeting:1},
  duplicate:[{key:'detailed_targeting',value:1},{key:'detailed_targeting',value:1}],extraField:{detailed_targeting:1,lookalike:0,'synthetic-private-token':{secret:'private'}}}))
  test(`Meta adoption keeps ${label} expansion unknown with bounded diagnostics`,async()=>{
    const f=fixture();f.observed.adset.targeting_optimization_types=value;
    const {retainedProviderTerms,...source}=f.source;
    await assert.rejects(f.provider.reconcileExistingMetaMaterial(f.grant,f.ids,{...source,retainedObservations:[{key:'campaign.objective',value:'OUTCOME_LEADS',provenance:'legacy_intent',historyRecordId:'a'.repeat(64)}]},async()=>{}),error=>{
      const e=error as Error&{materialDiagnostic:any};assert.equal(e.message,'existing_material_expansion_unknown');
      const d=e.materialDiagnostic;assert.equal(d.phase,'provider_expansion');assert.equal(d.fields.length,2);
      assert.deepEqual(d.fields.map((x:any)=>x.field),['detailed_targeting','lookalike']);
      assert.ok(d.fields.every((x:any)=>x.values.length<=3));assert.doesNotMatch(JSON.stringify(d),/synthetic-private-token|secret|private/);
      if(label==='missingBit')assert.equal(d.fields[1].occurrences,0);
      if(label==='privateValue')assert.equal(d.fields[0].values[0].binaryBit,null);
      return true;
    });
  });

for(const unknownAge of [undefined,false,true])test(`Meta provider-default placements preserve omission and unknown-age ${unknownAge}`,async()=>{
  const f=fixture(),t=f.observed.adset.targeting;
  delete t.publisher_platforms;delete t.facebook_positions;
  if(unknownAge!==undefined)t.user_age_unknown=unknownAge;
  f.source.retainedProviderTerms=structuredClone(existingMetaTerms(f.observed));
  const before=structuredClone(f.source),r=await f.capture(),m=r.material;
  assert.equal(m.settings?.provider,'meta');if(m.settings?.provider!=='meta')throw Error('meta');
  assert.equal(m.settings.placementMode,'provider_defaults');assert.deepEqual(m.settings.placements,[]);
  assert.equal(m.settings.targeting.userAgeUnknown,unknownAge);
  f.grant.targetingOptions=r.targetingOptions;
  const g=f.grant,c={id:'c',projectId:'p',grantId:'g',material:m,state:'paused',receipt:null} as Campaign;
  const assets=[{id:'original-asset',projectId:'p',campaignId:'c',kind:'image',digest:'b'.repeat(64)} as Asset];
  const plan:any=providerPlan(c,g,assets);
  assert.deepEqual(plan.adset.targeting,t);assert.ok(!Object.hasOwn(plan.adset.targeting,'publisher_platforms'));
  assert.equal(Object.hasOwn(plan.adset.targeting,'user_age_unknown'),unknownAge!==undefined);
  assert.deepEqual(f.source,before);assert.equal(r.executionReady,false);assert.equal(capabilityStatus(m,g).accountVerified,false);
  const inspection=await f.provider.inspectExistingCampaign(c,g,assets,{...f.ids,ad:'103'},async()=>{});
  assert.equal(inspection.candidateReceipt.ids.ad,'103');
  // A provider changing to manual placements or changing a known age bit cannot
  // be accepted merely because both configurations might currently serve alike.
  t.publisher_platforms=['facebook'];t.facebook_positions=['feed'];
  await assert.rejects(f.provider.inspectExistingCampaign(c,g,assets,{...f.ids,ad:'103'},async()=>{}),/provider_targeting_mismatch/);
  const review=renderToStaticMarkup(createElement(MaterialReview,{material:m,assets:[],client:{assetUrl:()=>'/image'} as any,grant:g}));
  assert.match(review,/Meta automatic placements/);
  const editor=renderToStaticMarkup(createElement(GuidedFields,{value:m,grant:g,onChange:()=>{}}));
  assert.match(editor,/Meta chooses eligible placements/);assert.match(editor,/People whose age is unknown/);
});

for(const [label,patch] of Object.entries({nullPlatforms:{publisher_platforms:null},emptyPlatforms:{publisher_platforms:[]},
  omittedPositions:{publisher_platforms:['facebook']},orphanPositions:{facebook_positions:['feed']},
  deviceRestriction:{device_platforms:['mobile']},ageNull:{user_age_unknown:null},ageText:{user_age_unknown:'false'},ageNumber:{user_age_unknown:0},unknownField:{private:'secret'}}))
  test(`Meta default-placement adoption rejects partial or malformed ${label}`,async()=>{
    const f=fixture(),t=f.observed.adset.targeting;delete t.publisher_platforms;delete t.facebook_positions;Object.assign(t,patch);
    f.source.retainedProviderTerms=structuredClone(existingMetaTerms(f.observed));await assert.rejects(f.capture());
  });

test('Meta provider-default placement mode cannot hide a manual selection or an invalid mode',async()=>{
  const f=fixture(),r=await f.capture(),s=r.material.settings! as any;
  s.placementMode='provider_defaults';assert.ok(capabilityStatus(r.material,f.grant).blockers.includes('unsupported_placement'));
  s.placements=[];s.placementMode='arbitrary';assert.ok(capabilityStatus(r.material,f.grant).blockers.includes('unsupported_placement_mode'));
  delete s.placementMode;assert.ok(capabilityStatus(r.material,f.grant).blockers.includes('unsupported_placement'));
});

function awarenessFixture(){
  const f=fixture();delete f.source.conversion;
  f.observed.campaign.objective='OUTCOME_AWARENESS';f.observed.adset.optimization_goal='REACH';
  f.observed.adset.destination_type='UNDEFINED';f.observed.adset.promoted_object={page_id:'42'};
  f.observed.adset.targeting.targeting_automation.advantage_audience=0;
  f.observed.adset.targeting.targeting_optimization='none';
  f.observed.adset.targeting_optimization_types=[{key:'detailed_targeting',value:0},{key:'lookalike',value:0}];
  f.observed.adset.attribution_spec=[];f.source.retainedProviderTerms=structuredClone(existingMetaTerms(f.observed));
  return f;
}
for(const flag of [undefined,false,true])test(`awareness page promotion ${flag} survives reconciliation, editing, plan and exact readback`,async()=>{
  const f=awarenessFixture(),{retainedProviderTerms,...source}=f.source;
  const original=structuredClone(retainedProviderTerms);
  if(flag!==undefined)f.observed.adset.promoted_object.smart_pse_enabled=flag;
  const result=await f.provider.reconcileExistingMetaMaterial(f.grant,f.ids,{...source,retainedObservations:[
    {key:'adset.promotedObject',value:original.adset.promoted_object,provenance:'legacy_observation',historyRecordId:'a'.repeat(64)}]},async()=>{});
  const m=result.material,s=m.settings!;if(s.provider!=='meta')throw Error('Meta required');
  assert.equal(s.conversion,undefined);assert.deepEqual(s.pagePromotion,flag===undefined?undefined:{smartPseEnabled:flag});
  assert.deepEqual(f.source.retainedProviderTerms,original);
  assert.equal(result.materialReconciliation.comparisons.find(x=>x.key==='adset.promotedObject')!.status,flag===undefined?'equal':'different');
  let edited:any;const tree=GuidedFields({value:m,grant:f.grant,onChange:x=>{edited=x;}});
  const find=(node:any):any=>Array.isArray(node)?node.map(find).find(Boolean):node?.props?.['aria-label']==='Meta page promotion Smart PSE'?node:node?.props?find(node.props.children):null;
  const select=find(tree);assert.ok(select);assert.equal(select.props.value,flag===undefined?'unspecified':flag?'enabled':'disabled');
  for(const [choice,expected] of [['enabled',true],['disabled',false],['unspecified',undefined]] as const){
    select.props.onChange({target:{value:choice}});
    assert.deepEqual(edited.settings.pagePromotion,expected===undefined?undefined:{smartPseEnabled:expected});
    assert.equal(edited.settings.conversion,undefined);assert.deepEqual(edited.advertisingBudget,m.advertisingBudget);
    assert.deepEqual(edited.settings.targeting,s.targeting);
  }
  const review=renderToStaticMarkup(createElement(MaterialReview,{material:m,assets:[],client:{assetUrl:()=>'/fixture'} as any,grant:f.grant}));
  assert.ok(review.includes('Meta page promotion Smart PSE</dt><dd>'+(flag===undefined?'Not specified':flag?'Enabled':'Disabled')));
  assert.doesNotMatch(review,/Standard Lead event/);
  f.grant.targetingOptions=result.targetingOptions;
  const c={id:'c',projectId:'p',grantId:'g',material:m,state:'paused',receipt:null} as Campaign;
  const assets=[{id:'original-asset',projectId:'p',campaignId:'c',kind:'image',digest:'b'.repeat(64)} as Asset];
  assert.deepEqual((providerPlan(c,f.grant,assets) as any).adset.promoted_object,f.observed.adset.promoted_object);
  assert.equal((await f.provider.inspectExistingCampaign(c,f.grant,assets,{...f.ids,ad:'103'},async()=>{})).candidateReceipt.intent,'paused');
  f.observed.adset.promoted_object.smart_pse_enabled=flag===true?false:true;
  await assert.rejects(f.provider.inspectExistingCampaign(c,f.grant,assets,{...f.ids,ad:'103'},async()=>{}),/promoted_object_mismatch/);
});
for(const value of [null,0,1,'false',{},[]])test(`awareness rejects malformed provider Smart PSE ${JSON.stringify(value)}`,async()=>{
  const f=awarenessFixture();f.observed.adset.promoted_object.smart_pse_enabled=value;
  f.source.retainedProviderTerms=existingMetaTerms(f.observed);await assert.rejects(f.capture(),/existing_material_smart_pse_invalid/);
});
test('page promotion rejects malformed settings, extra fields and use on lead campaigns',async()=>{
  const f=awarenessFixture(),r=await f.capture();
  for(const value of [null,{},[],{smartPseEnabled:null},{smartPseEnabled:'false'},{smartPseEnabled:false,extra:true}]){
    (r.material.settings as any).pagePromotion=value;
    assert.ok(capabilityStatus(r.material,f.grant).blockers.includes('invalid_meta_page_promotion'));
  }
  const lead=await fixture().capture();(lead.material.settings as any).pagePromotion={smartPseEnabled:false};
  assert.ok(capabilityStatus(lead.material,f.grant).blockers.includes('invalid_meta_page_promotion'));
});

for(const mode of ['absent','empty','explicit'] as const)test(`awareness attribution ${mode} stays distinct through history and exact readback`,async()=>{
  const f=awarenessFixture(),{retainedProviderTerms,...source}=f.source;
  if(mode==='absent')delete f.observed.adset.attribution_spec;
  if(mode==='explicit')f.observed.adset.attribution_spec=[{event_type:'CLICK_THROUGH',window_days:1}];
  const r=await f.provider.reconcileExistingMetaMaterial(f.grant,f.ids,{...source,retainedObservations:[
    {key:'adset.attribution',value:[],provenance:'legacy_observation',historyRecordId:'a'.repeat(64)}]},async()=>{});
  const s=r.material.settings!;if(s.provider!=='meta')throw Error('Meta required');
  assert.deepEqual(s.attribution,mode==='absent'?undefined:mode==='empty'?[]:[{eventType:'CLICK_THROUGH',windowDays:1}]);
  assert.equal(s.conversion,undefined);assert.deepEqual(retainedProviderTerms.adset.attribution_spec,[]);
  const comparison=r.materialReconciliation.comparisons.find(x=>x.key==='adset.attribution')!;
  assert.equal(comparison.status,mode==='absent'?'current_not_returned':mode==='empty'?'equal':'different');
  assert.equal(comparison.currentPresent,mode!=='absent');
  assert.equal(comparison.missingReason,mode==='absent'?'provider_field_not_returned':null);
  f.grant.targetingOptions=r.targetingOptions;
  const c={id:'c',projectId:'p',grantId:'g',material:r.material,state:'paused',receipt:null} as Campaign;
  const assets=[{id:'original-asset',projectId:'p',campaignId:'c',kind:'image',digest:'b'.repeat(64)} as Asset];
  const plan:any=providerPlan(c,f.grant,assets);
  assert.equal(Object.hasOwn(plan.adset,'attribution_spec'),mode!=='absent');
  assert.deepEqual(plan.adset.attribution_spec,f.observed.adset.attribution_spec);
  await f.provider.inspectExistingCampaign(c,f.grant,assets,{...f.ids,ad:'103'},async()=>{});
  if(mode==='absent')f.observed.adset.attribution_spec=[];else delete f.observed.adset.attribution_spec;
  await assert.rejects(f.provider.inspectExistingCampaign(c,f.grant,assets,{...f.ids,ad:'103'},async()=>{}),/attribution_spec_mismatch/);
});
for(const value of [null,{},'unknown',false])test(`awareness rejects malformed attribution ${JSON.stringify(value)}`,async()=>{
  const f=awarenessFixture();f.observed.adset.attribution_spec=value;
  f.source.retainedProviderTerms=structuredClone(existingMetaTerms(f.observed));
  await assert.rejects(f.capture(),/existing_material_attribution_unknown/);
});
test('lead capture still requires explicit provider attribution',async()=>{
  const f=fixture();delete f.observed.adset.attribution_spec;f.source.retainedProviderTerms=structuredClone(existingMetaTerms(f.observed));
  await assert.rejects(f.capture(),/existing_material_attribution_unknown/);
});

for(const hint of [undefined,'none'] as const)for(const optimization of ['IMPRESSIONS','REACH'])
test(`expanded traffic ${optimization} preserves ${hint??'absent'} targeting hint and historical discrepancy through exact readback`,async()=>{
  const f=fixture();delete f.source.conversion;
  f.observed.campaign.objective='OUTCOME_TRAFFIC';f.observed.adset.optimization_goal=optimization;
  delete f.observed.adset.promoted_object;delete f.observed.adset.attribution_spec;
  f.observed.adset.targeting.targeting_automation.advantage_audience=0;
  if(hint)f.observed.adset.targeting.targeting_optimization=hint;
  const {retainedProviderTerms,...base}=f.source;
  const source:ReconciledMetaMaterialSource={...base,retainedObservations:[{key:'adset.expansion',
    value:[{key:'detailed_targeting',value:0},{key:'lookalike',value:0}],provenance:'legacy_observation',historyRecordId:'b'.repeat(64)}]};
  const before=structuredClone(source);
  const r=await f.provider.reconcileExistingMetaMaterial(f.grant,f.ids,source,async()=>{}),m=r.material;
  assert.deepEqual(source,before);assert.equal(r.materialReconciliation.materialApproved,false);
  assert.equal(r.materialReconciliation.spendingAuthorityGranted,false);
  assert.equal(r.materialReconciliation.comparisons.find(x=>x.key==='adset.expansion')?.status,'different');
  assert.equal(m.audience.expansion,true);assert.equal(m.settings?.provider,'meta');
  if(m.settings?.provider!=='meta')throw Error('Meta required');
  assert.equal(m.settings.delivery,'expanded');assert.equal(m.settings.targeting.optimization,hint);
  assert.deepEqual(m.settings.targeting.expansion,{detailedTargeting:1,lookalike:0});
  assert.equal(m.settings.conversion,undefined);
  const c={id:'c',projectId:'p',grantId:'g',material:m,state:'paused',receipt:null} as Campaign;
  f.grant.targetingOptions=r.targetingOptions;const g=f.grant;
  const assets=[{id:'original-asset',projectId:'p',campaignId:'c',kind:'image',digest:'b'.repeat(64)} as Asset];
  const plan:any=providerPlan(c,g,assets);assert.deepEqual(plan.adset.targeting,f.observed.adset.targeting);
  assert.equal(plan.adset.targeting.targeting_automation.advantage_audience,0);
  const inspect=()=>f.provider.inspectExistingCampaign(c,g,assets,{...f.ids,ad:'103'},async()=>{});
  assert.equal((await inspect()).candidateReceipt.intent,'paused');
  const editor=renderToStaticMarkup(createElement(GuidedFields,{value:m,grant:g,onChange:()=>{}}));
  assert.match(editor,/Expanded traffic audience/);assert.match(editor,/Detailed targeting expansion/);assert.doesNotMatch(editor,/Lead Pixel/);
  for(const value of [undefined,[],[{key:'detailed_targeting',value:0},{key:'lookalike',value:0}],
    [{key:'detailed_targeting',value:true},{key:'lookalike',value:0}]]){
    f.observed.adset.targeting_optimization_types=value;
    await assert.rejects(inspect(),/meta_expansion_settings_mismatch/);
  }
  assert.deepEqual(g.permissions,['pause','report']);assert.deepEqual(source,before);
});
