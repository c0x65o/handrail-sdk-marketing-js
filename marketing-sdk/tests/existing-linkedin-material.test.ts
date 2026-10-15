import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeProvider, type VaultPort } from '../server/providers.js';
import { Store } from '../server/store.js';
import type { Grant } from '../core/index.js';
import {existingLinkedInChildren} from '../server/existing-linkedin-material.js';
import type { ExistingLinkedInMaterialSource } from '../server/existing-linkedin-material.js';

function fixture() {
  const grant: Grant = {id:'g',projectId:'p',revision:1,provider:'linkedin',accountId:'123',organizationId:'456',
    label:'Retained',currency:'USD',timezone:'UTC',permissions:['pause','report'],expiresAt:'2099-01-01T00:00:00Z',revokedAt:null,secretRef:'opaque'};
  const source: ExistingLinkedInMaterialSource = {name:'Original',headline:'Original headline',body:'Original copy',destination:'https://example.com/landing?utm_campaign=original',
    destinationDigest:'a'.repeat(64),assetId:'original-asset',purpose:'acquisition',campaignDailyCeiling:1500,
    policy:{nondiscriminationAccepted:true,politicalConsent:true,receiptRefs:['native-plan-policy']},
    conversion:{id:'urn:lla:llaPartnerConversion:789',type:'LEAD',event:'Lead'}};
  let campaign: any = {id:111,status:'PAUSED',account:'urn:li:sponsoredAccount:123',associatedEntity:'urn:li:organization:456',
    format:'STANDARD_UPDATE',type:'SPONSORED_UPDATES',audienceExpansionEnabled:false,offsiteDeliveryEnabled:false,connectedTelevisionOnly:false,
    politicalIntent:'NOT_POLITICAL',objectiveType:'WEBSITE_CONVERSION',optimizationTargetType:'NONE',costType:'CPC',
    unitCost:{amount:'5.00',currencyCode:'USD'},dailyBudget:{amount:'10.00',currencyCode:'USD'},
    runSchedule:{start:1791127433318},targetingCriteria:{include:{and:[
      {or:{'urn:li:adTargetingFacet:titles':['urn:li:title:1','urn:li:title:28']}},
      {or:{'urn:li:adTargetingFacet:locations':['urn:li:geo:103644278']}},
      {or:{'urn:li:adTargetingFacet:interfaceLocales':['urn:li:locale:en_US']}},
    ]}}};
  let calls=0,afterFetch=()=>{};
  const vault:VaultPort={use:async()=>{throw Error('write custody must never open');},useReadOnly:async(g,guard,fn)=>{
    assert.equal(g,grant);await guard();return fn({accessToken:'private-fixture',clientId:'fixture-client',clientSecret:'fixture-secret',expiresAt:Date.parse(grant.expiresAt),scopes:['r_ads']});}};
  const provider=new NativeProvider('linkedin',vault,null as unknown as Store,async(input,init)=>{
    calls++;assert.equal(String(input),'https://api.linkedin.com/rest/adAccounts/123/adCampaigns/111');
    assert.equal(init?.method,'GET');assert.equal(init?.redirect,'error');assert.equal(new Headers(init?.headers).get('LinkedIn-Version'),'202609');
    afterFetch();return Response.json(campaign);
  });
  const capture=(guard=async()=>{})=>provider.captureExistingLinkedInMaterial(grant,'111',source,guard);
  return {source,grant,campaign,capture,calls:()=>calls,afterFetch:(fn:()=>void)=>{afterFetch=fn;}};
}
test('existing LinkedIn capture preserves original copy, daily exposure ceiling, exact partial-day schedule and provider targeting',async()=>{
  const f=fixture(),result=await f.capture();
  assert.equal(f.calls(),1);assert.equal(result.executionReady,false);
  assert.equal(result.material.budget,null);assert.equal(result.material.endAt,null);
  assert.equal(result.material.startAt,'2026-10-04T15:23:53.318Z');
  assert.deepEqual(result.material.advertisingBudget,{daily:{currency:'USD',minor:1000},campaignDailyCeiling:{currency:'USD',minor:1500}});
  assert.equal(result.material.settings?.optimization,'NONE');assert.equal(result.material.headline,f.source.headline);
  assert.equal(result.material.destination,f.source.destination);assert.deepEqual(result.material.assetIds,['original-asset']);
  assert.equal(result.targetingOptions.length,4);assert.equal(result.providerCampaignDigest.length,64);
  assert.deepEqual(f.grant.permissions,['pause','report']);assert.equal(f.grant.targetingOptions,undefined);
  f.campaign.totalBudget={amount:'25.00',currencyCode:'USD'};f.campaign.runSchedule.end=1791213833318;
  const capped=await f.capture();assert.deepEqual(capped.material.budget,{currency:'USD',minor:2500});
  assert.equal(capped.material.endAt,'2026-10-05T15:23:53.318Z');
});
for(const [label,change] of Object.entries({
  currency:(f:ReturnType<typeof fixture>)=>{f.campaign.dailyBudget.currencyCode='EUR';},
  fraction:(f:ReturnType<typeof fixture>)=>{f.campaign.dailyBudget.amount='10.001';},
  missingBudget:(f:ReturnType<typeof fixture>)=>{delete f.campaign.dailyBudget;},
  missingStart:(f:ReturnType<typeof fixture>)=>{delete f.campaign.runSchedule.start;},
  groupInsteadOfCampaign:(f:ReturnType<typeof fixture>)=>{f.campaign.id=222;},
  wrongAccount:(f:ReturnType<typeof fixture>)=>{f.campaign.account='urn:li:sponsoredAccount:999';},
  active:(f:ReturnType<typeof fixture>)=>{f.campaign.status='ACTIVE';},
  unknownExpansion:(f:ReturnType<typeof fixture>)=>{delete f.campaign.audienceExpansionEnabled;},
  offsite:(f:ReturnType<typeof fixture>)=>{f.campaign.offsiteDeliveryEnabled=true;},
  policy:(f:ReturnType<typeof fixture>)=>{f.source.policy.politicalConsent=false;},
  ceiling:(f:ReturnType<typeof fixture>)=>{f.source.campaignDailyCeiling=1000;},
  unknownPurpose:(f:ReturnType<typeof fixture>)=>{f.source.purpose=undefined;},
  unknownOptimization:(f:ReturnType<typeof fixture>)=>{delete f.campaign.optimizationTargetType;},
  conversion:(f:ReturnType<typeof fixture>)=>{delete f.source.conversion;},
  unknownTargeting:(f:ReturnType<typeof fixture>)=>{f.campaign.targetingCriteria.unknown=true;},
  duplicateClause:(f:ReturnType<typeof fixture>)=>{f.campaign.targetingCriteria.include.and.push(f.campaign.targetingCriteria.include.and[0]);},
  mixedOr:(f:ReturnType<typeof fixture>)=>{f.campaign.targetingCriteria.include.and[0].or['urn:li:adTargetingFacet:industries']=['urn:li:industry:48'];},
}))test(`existing LinkedIn capture rejects ${label} without changing provider state`,async()=>{
  const f=fixture();change(f);await assert.rejects(f.capture());assert.equal(f.calls(),1);
});
test('existing LinkedIn capture fences authority changed during the actual read',async()=>{
  const f=fixture();let revoked=false;f.afterFetch(()=>{revoked=true;});
  await assert.rejects(f.capture(async()=>{if(revoked)throw Error('fixture-revoked');}),/fixture-revoked/);
  const g=fixture();g.afterFetch(()=>{g.source.body='changed';});
  await assert.rejects(g.capture(),/existing_campaign_scope_changed/);
});

for(const scenario of ['complete','extra_child','partial','cycle','active','duplicate','missing'])test(`adoption child inventory ${scenario}`,async()=>{
  let calls=0;
  const child={id:'urn:li:sponsoredCreative:333',campaign:'urn:li:sponsoredCampaign:111',intendedStatus:'PAUSED'};
  const client={listCreatives:async(account:string,input:any)=>{
    calls++;assert.equal(account,'123');assert.equal(input.campaignUrn,'urn:li:sponsoredCampaign:111');assert.equal(input.pageSize,100);
    if(calls===1)return {elements:[child],metadata:{nextPageToken:'page-two'}};
    assert.equal(input.pageToken,'page-two');
    if(scenario==='partial')throw Error('interrupted inventory');
    if(scenario==='cycle')return {elements:[],metadata:{nextPageToken:'page-two'}};
    if(scenario==='missing')return {};
    return {elements:scenario==='complete'?[]:[{...child,...(scenario==='extra_child'?{id:'444'}:{}),...(scenario==='active'?{intendedStatus:'ACTIVE'}:{})}]};
  }};
  const read=()=>existingLinkedInChildren(client,'123','111','333');
  if(scenario==='complete')assert.deepEqual(await read(),[{id:'333',campaign:child.campaign,intendedStatus:'PAUSED'}]);
  else await assert.rejects(read());assert.equal(calls,2);
});
