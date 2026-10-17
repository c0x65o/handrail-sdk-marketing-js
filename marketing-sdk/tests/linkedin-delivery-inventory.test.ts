import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectLinkedInDeliveryInventory,type LinkedInDeliveryTarget} from '../server/linkedin-delivery-inventory.js';
import type {Grant} from '../core/index.js';
function fixture(){
 const grant={id:'g',projectId:'p',revision:1,provider:'linkedin',accountId:'123',currency:'USD',timezone:'UTC',
  permissions:['report'],expiresAt:'2099-01-01T00:00:00Z',revokedAt:null,secretRef:'fixture',label:'Fixture'} as Grant;
 const targets:LinkedInDeliveryTarget[]=[{nativeCampaignId:'local',campaignId:'100',groupId:'10',expectedCreativeIds:['200']}];
 const account='urn:li:sponsoredAccount:123';
 const rows:Record<string,any[]>={adCampaignGroups:[{id:10,account,status:'ACTIVE',servingStatuses:['RUNNABLE']}],
  adCampaigns:[{id:100,account,campaignGroup:'urn:li:sponsoredCampaignGroup:10',status:'PAUSED',servingStatuses:['STOPPED']}],
  creatives:[{id:'urn:li:sponsoredCreative:200',account,campaign:'urn:li:sponsoredCampaign:100',intendedStatus:'PAUSED',isServing:false}]};
 const pages:Record<string,any[]>={};let reads=0,expired=false,hook=async()=>{};
 const fetcher:typeof fetch=async(input,init)=>{
  const u=new URL(String(input));reads++;assert.equal(u.origin,'https://api.linkedin.com');assert.equal(init?.method,'GET');
  assert.equal(init.redirect,'error');await hook();
  if(u.pathname==='/rest/adAccounts/123')return Response.json({id:123,currency:'USD'});
  const edge=u.pathname.split('/').at(-1)!;assert.ok(rows[edge]);assert.equal(u.searchParams.has('campaigns'),false);
  if(edge==='creatives'){assert.equal(u.searchParams.get('pageSize'),'100');assert.equal(new Headers(init.headers).get('x-restli-method'),'FINDER');}
  const page=pages[edge]?.shift();if(page instanceof Response)return page;
  return Response.json(page??{elements:rows[edge],metadata:{}});
 };
 const vault={use:async()=>{throw Error('write custody forbidden');},useReadOnly:async(_g:Grant,guard:()=>Promise<void>,action:any)=>{
  await guard();return action({accessToken:'synthetic-only',clientId:'fixture',clientSecret:'fixture-secret',
   expiresAt:expired?0:Date.parse(grant.expiresAt??''),scopes:['r_ads']});
 }};
 return {grant,targets,rows,pages,reads:()=>reads,setHook:(h:()=>Promise<void>)=>hook=h,expire:()=>expired=true,
  read:()=>inspectLinkedInDeliveryInventory({grant,targets,vault,guard:async()=>{},fetcher})};
}
test('LinkedIn account inventory observes active shared groups while verifying paused mapped campaigns',async()=>{
 const f=fixture();const x=await f.read();assert.equal(x.requestCount,4);assert.equal(x.complete,true);assert.equal(x.allPaused,true);
 assert.equal(x.snapshot.groups[0]?.configuredStatus,'ACTIVE');assert.equal(x.snapshot.campaigns[0]?.objects.length,2);
 assert.equal(x.providerWritesPerformed,false);assert.equal(x.historicalEffectsSettled,false);assert.equal(x.deliveryVerified,false);
});
test('every account page is collected; unmapped active campaigns and orphan creatives remain unowned',async()=>{
 const f=fixture();f.pages.creatives=[{elements:f.rows.creatives,metadata:{nextPageToken:'next'}},
  {elements:[{...f.rows.creatives![0],id:'urn:li:sponsoredCreative:201',campaign:'urn:li:sponsoredCampaign:999',intendedStatus:'ACTIVE',isServing:true,
   name:'Unrequested private copy',content:{reference:'Unrequested content'}}],metadata:{}}];
 const x=await f.read();assert.equal(x.requestCount,5);assert.equal(x.allPaused,true);
 const u=x.snapshot.unmappedProviderCampaigns[0]!;assert.equal(u.campaignObserved,false);assert.equal(u.ownership,'unverified');
 assert.equal(u.objects[0]?.configuredStatus,'ACTIVE');assert.equal(u.nativeCampaignId,null);
 assert.equal(JSON.stringify(x).includes('Unrequested'),false);
});
test('newly discovered active children prevent complete paused proof',async()=>{
 const f=fixture();f.rows.creatives!.push({...f.rows.creatives![0],id:'201',intendedStatus:'ACTIVE',isServing:true});
 const x=await f.read();assert.equal(x.complete,true);assert.equal(x.allPaused,false);
});
for(const missing of ['adCampaignGroups','adCampaigns','creatives'])test(`missing ${missing} remains unknown`,async()=>{
 const f=fixture();f.rows[missing]=[];const x=await f.read();assert.equal(x.complete,false);assert.equal(x.allPaused,false);
 assert.equal(x.snapshot.campaigns[0]?.allPaused,null);
});
for(const invalid of ['duplicate','foreign_account','group_changed','malformed_id'])test(`invalid ${invalid} rejects the inventory`,async()=>{
 const f=fixture();if(invalid==='duplicate')f.rows.creatives!.push({...f.rows.creatives![0]});
 if(invalid==='foreign_account')f.rows.creatives![0].account='urn:li:sponsoredAccount:999';
 if(invalid==='group_changed')f.rows.adCampaigns![0].campaignGroup='urn:li:sponsoredCampaignGroup:999';
 if(invalid==='malformed_id')f.rows.adCampaigns![0].id='100unsafe';
 await assert.rejects(f.read(),{code:'delivery_inventory_identity_invalid'});
});
for(const mode of ['cycle','missing_metadata','bad_token','missing_elements','provider_failure'])test(`pagination ${mode} cannot become complete`,async()=>{
 const f=fixture();const first={elements:f.rows.creatives,metadata:{nextPageToken:'same'}};
 f.pages.creatives=[first,mode==='cycle'?{elements:[],metadata:{nextPageToken:'same'}}:
  mode==='missing_metadata'?{elements:[]}:mode==='bad_token'?{elements:[],metadata:{nextPageToken:123}}:
  mode==='missing_elements'?{metadata:{}}:new Response(JSON.stringify({message:'fixture-secret'}),{status:401})];
 await assert.rejects(f.read(),{code:mode==='provider_failure'?'delivery_inventory_unavailable':'delivery_inventory_pagination_invalid'});
 assert.ok(f.reads()<=5);
});
test('expired credentials, campaign grant and revoked authority cannot expose inventory',async()=>{
 const expired=fixture();expired.expire();await assert.rejects(expired.read(),{code:'provider_access_expired_or_denied'});assert.equal(expired.reads(),0);
 const scoped=fixture();scoped.grant.campaignId='local';await assert.rejects(scoped.read(),{code:'delivery_inventory_account_grant_required'});assert.equal(scoped.reads(),0);
 const revoked=fixture();revoked.setHook(async()=>{revoked.grant.revokedAt=new Date().toISOString();});
 await assert.rejects(revoked.read(),{code:'delivery_inventory_scope_changed'});assert.equal(revoked.reads(),1);
});
test('scope changes while reading discard evidence; serving contradictions and missing status stay explicit',async()=>{
 const changed=fixture();changed.setHook(async()=>{changed.targets[0]!.campaignId='999';});
 await assert.rejects(changed.read(),{code:'delivery_inventory_scope_changed'});
 const missing=fixture();delete missing.rows.creatives![0].intendedStatus;assert.equal((await missing.read()).complete,false);
 const serving=fixture();serving.rows.creatives![0].isServing=true;assert.equal((await serving.read()).allPaused,false);
});
