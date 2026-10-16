import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectMetaDeliveryInventory, type MetaDeliveryTarget} from '../server/delivery-inventory.js';
import type {Grant} from '../core/index.js';
function fixture(){
 const grant={id:'g',projectId:'p',revision:1,provider:'meta',accountId:'act_123',currency:'USD',timezone:'America/Chicago',
  permissions:['report'],expiresAt:'2099-01-01T00:00:00Z',revokedAt:null,secretRef:'test',label:'Test'} as Grant;
 const targets:MetaDeliveryTarget[]=[{nativeCampaignId:'local',campaignId:'100',expectedAdsetIds:['101'],expectedAdIds:['102']}];
 const common={account_id:'123',status:'PAUSED',effective_status:'PAUSED'};
 const rows:Record<string,any[]>={campaigns:[{...common,id:'100'},{...common,id:'999',status:'ACTIVE',effective_status:'ACTIVE'}],
  adsets:[{...common,id:'101',campaign_id:'100'}],ads:[{...common,id:'102',campaign_id:'100',adset_id:'101',creative:{id:'103'}}]};
 let hook=async()=>{},reads=0,expired=false;const pages:Record<string,any[]>={};
 const fetcher:typeof fetch=async(input,init)=>{
  reads++;const u=new URL(String(input));assert.equal(init?.method,'GET');assert.equal(init?.redirect,'error');
  assert.equal(u.origin,'https://graph.facebook.com');assert.equal(u.searchParams.has('filtering'),false);
  await hook();if(u.pathname==='/v26.0/act_123')return Response.json({id:'act_123',currency:'USD',timezone_name:grant.timezone});
  const edge=u.pathname.split('/').at(-1)!;assert.ok(rows[edge]);
  const page=pages[edge]?.shift();if(page instanceof Response)return page;return Response.json(page??{data:rows[edge]});
 };
 const vault={use:async()=>{throw Error('write custody forbidden');},useReadOnly:async(_g:Grant,guard:()=>Promise<void>,action:any)=>{
  await guard();return action({accessToken:'synthetic-only',expiresAt:expired?0:Date.parse(grant.expiresAt ?? ""),scopes:['ads_read']});
 }};
 return {grant,targets,rows,pages,setHook:(h:()=>Promise<void>)=>hook=h,expire:()=>expired=true,reads:()=>reads,
  read:()=>inspectMetaDeliveryInventory({grant,targets,vault,guard:async()=>{},fetcher})};
}
test('one Meta account read separates mapped campaigns from unverified provider identities without writes',async()=>{
 const f=fixture();const x=await f.read();assert.equal(x.requestCount,4);assert.equal(x.paginationComplete,true);
 assert.equal(x.allPaused,true);assert.equal(x.snapshot.campaigns[0]?.objects.length,3);
 assert.equal(x.pauseScope,'mapped_campaigns_only');assert.equal(x.ownershipBasis,'explicit_native_mappings_only');
 assert.deepEqual(x.snapshot.unmappedProviderCampaigns,[{nativeCampaignId:null,campaignId:'999',ownership:'unverified',reason:'no_native_campaign_mapping',
  objects:[{id:'999',accountId:'123',type:'campaign',campaignId:'999',adsetId:null,creativeId:null,configuredStatus:'ACTIVE',effectiveStatus:'ACTIVE'}],
  campaignObserved:true,orphanAdIds:[],unknownStatusIds:[]}]);
 assert.equal(x.providerWritesPerformed,false);assert.equal(x.deliveryVerified,false);assert.equal(x.historicalEffectsSettled,false);
});
test('unmapped child pages retain missing parents, unknown states and identities without implying ownership',async()=>{
 const f=fixture();f.pages.ads=[{data:f.rows.ads,paging:{next:'https://foreign.invalid/token',cursors:{after:'next'}}},
  {data:[{account_id:'123',id:'777',campaign_id:'888',adset_id:'889',status:'ACTIVE',creative:{id:'778'},name:'Unrequested private copy'}]}];
 const x=await f.read();assert.equal(x.requestCount,5);assert.equal(x.allPaused,true);
 const row=x.snapshot.unmappedProviderCampaigns.find(c=>c.campaignId==='888')!;
 assert.equal(row.ownership,'unverified');assert.equal(row.nativeCampaignId,null);assert.equal(row.campaignObserved,false);
 assert.deepEqual(row.orphanAdIds,['777']);assert.deepEqual(row.unknownStatusIds,['777']);
 assert.equal(row.objects[0]?.effectiveStatus,null);assert.equal(row.objects[0]?.creativeId,'778');
 assert.equal(JSON.stringify(x).includes('Unrequested private copy'),false);
 assert.ok(!x.snapshot.campaigns.some(c=>c.campaignId==='888'));
});
test('all pages are required and newly discovered active children prevent paused proof',async()=>{
 const f=fixture();f.pages.ads=[{data:f.rows.ads,paging:{next:'https://foreign.invalid/token',cursors:{after:'next'}}},
  {data:[{...f.rows.ads![0],id:'104',status:'ACTIVE',effective_status:'ACTIVE'}]}];
 const x=await f.read();assert.equal(x.requestCount,5);assert.equal(x.complete,true);assert.equal(x.allPaused,false);
 assert.equal(x.snapshot.campaigns[0]?.objects.length,4);
});
for(const key of ['campaigns','adsets','ads'])test(`missing ${key} remain unknown`,async()=>{
 const f=fixture();f.rows[key]=[];const x=await f.read();assert.equal(x.complete,false);assert.equal(x.allPaused,false);
 assert.equal(x.snapshot.campaigns[0]?.allPaused,null);assert.ok(x.snapshot.campaigns[0]?.missing.length);
});
test('missing status and orphaned ad remain incomplete',async()=>{
 const f=fixture();delete f.rows.ads![0].effective_status;f.rows.ads![0].adset_id='555';const x=await f.read();
 assert.equal(x.complete,false);assert.deepEqual(x.snapshot.campaigns[0]?.orphanAds,['102']);assert.deepEqual(x.snapshot.campaigns[0]?.unknownStatusIds,['102']);
});
for(const mode of ['duplicate','account','badId'])test(`invalid ${mode} identity fails closed`,async()=>{
 const f=fixture();if(mode==='duplicate')f.rows.ads!.push({...f.rows.ads![0]});
 if(mode==='account')f.rows.ads![0].account_id='456';if(mode==='badId')f.rows.ads![0].campaign_id=null;
 await assert.rejects(f.read(),{code:'delivery_inventory_identity_invalid'});
});
for(const mode of ['cycle','missingCursor','malformed','expired'])test(`partial pagination ${mode} cannot become a complete inventory`,async()=>{
 const f=fixture();const paging={next:'https://foreign.invalid',cursors:{after:'same'}};
 f.pages.ads=[{data:f.rows.ads,paging},mode==='cycle'?{data:[],paging}:mode==='expired'?new Response(JSON.stringify({error:{code:190,message:'Synthetic expiry'}}),{status:401}):{paging:{}}];
 if(mode==='missingCursor')delete (f.pages.ads[0].paging as any).cursors;
 await assert.rejects(f.read(),{code:'delivery_inventory_unavailable'});assert.ok(f.reads()<=5);
});
test('expired custody, revoked authority and changed mappings cannot produce evidence',async()=>{
 const expired=fixture();expired.expire();await assert.rejects(expired.read(),{code:'provider_access_expired_or_denied'});assert.equal(expired.reads(),0);
 const revoked=fixture();revoked.setHook(async()=>{revoked.grant.revokedAt=new Date().toISOString();});
 await assert.rejects(revoked.read(),{code:'delivery_inventory_scope_changed'});assert.equal(revoked.reads(),1);
 const changed=fixture();changed.setHook(async()=>{changed.targets[0]!.campaignId='200';});
 await assert.rejects(changed.read(),{code:'delivery_inventory_scope_changed'});
});
test('duplicate native or provider mappings are rejected before any network request',async()=>{
 const f=fixture();f.targets.push({...f.targets[0]!});await assert.rejects(f.read(),{code:'delivery_inventory_scope_invalid'});assert.equal(f.reads(),0);
});
