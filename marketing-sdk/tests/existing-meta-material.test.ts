import test from "node:test";
import {createElement} from "react";
import {createRequire} from "node:module";
const {renderToStaticMarkup} = createRequire(import.meta.url)("react-dom/server") as {renderToStaticMarkup:(element:ReturnType<typeof createElement>)=>string};
import {MaterialReview} from "../react/index.js";
import {GuidedFields} from "../react/guided.js";
import assert from "node:assert/strict";
import { NativeProvider, providerPlan, type VaultPort } from "../server/providers.js";
import { Store } from "../server/store.js";
import { existingMetaTerms, type ExistingMetaMaterialSource } from "../server/existing-meta-material.js";
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
  const vault:VaultPort={use:async()=>{throw Error("write custody prohibited");},useReadOnly:async(g,guard,fn)=>{assert.equal(g,grant);await guard();return fn({accessToken:"synthetic-private-token",expiresAt:Date.parse(grant.expiresAt),scopes:["ads_management"]});}};
  const provider=new NativeProvider("meta",vault,null as unknown as Store,async(input,init)=>{
    const url=new URL(String(input));calls.push(url.pathname);assert.equal(init?.method,"GET");assert.equal(init?.redirect,"error");
    let body:any;
    if(url.pathname==="/v26.0/act_123")body={id:"act_123",currency:"USD",timezone_name:"America/Chicago"};
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
  assert.ok(capabilityStatus(m,f.grant).blockers.includes("meta_daily_budget_semantics_unverified"));
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
