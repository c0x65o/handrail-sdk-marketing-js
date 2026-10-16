import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeProvider,type VaultPort} from '../server/providers.js';
import {digest,type Store} from '../server/store.js';
import type {Grant} from '../core/index.js';

function fixture(){
  const g:Grant={id:'g',projectId:'p',revision:1,provider:'meta',accountId:'act_123',pageId:'42',label:'Fixture',currency:'USD',timezone:'America/Chicago',permissions:['report'],expiresAt:'2099-01-01T00:00:00Z',revokedAt:null,secretRef:'opaque'};
  const ids={campaign:'100',adset:'101',ad:'103',creative:'102'};
  const account:any={id:'act_123',currency:'USD',timezone_name:'America/Chicago'};
  const campaign:any={id:'100',account_id:'123',status:'PAUSED',effective_status:'PAUSED'};
  const adset:any={id:'101',account_id:'123',campaign_id:'100',status:'PAUSED',effective_status:'CAMPAIGN_PAUSED'};
  const ad:any={id:'103',account_id:'123',campaign_id:'100',adset_id:'101',creative:{id:'102'},status:'PAUSED',effective_status:'ADSET_PAUSED'};
  const pages:Record<string,any[]>={adsets:[{data:[adset]}],ads:[{data:[ad]}]},calls:URL[]=[];
  let afterFetch=()=>{},credentialExpiry=Date.parse(g.expiresAt ?? "");
  const vault:VaultPort={use:async()=>{throw Error('write credential use prohibited');},useReadOnly:async(_g,guard,action)=>{
    await guard();return action({accessToken:'synthetic-secret',expiresAt:credentialExpiry,scopes:['ads_read']});
  }};
  const provider=new NativeProvider('meta',vault,null as unknown as Store,async(input,init)=>{
    const u=new URL(String(input));calls.push(u);assert.equal(init?.method,'GET');assert.equal(init?.redirect,'error');
    assert.equal(u.searchParams.has('filtering'),false);
    const body=u.pathname==='/v26.0/act_123'?account:u.pathname==='/v26.0/100'?campaign:pages[u.pathname.split('/').at(-1)!]?.shift();
    assert.ok(body,'unexpected request');afterFetch();return body instanceof Response?body:Response.json(body);
  });
  return {g,ids,account,campaign,adset,ad,pages,calls,read:(guard=async()=>{})=>provider.inspectExistingMetaHierarchy(g,ids,guard),
    after:(fn:()=>void)=>{afterFetch=fn;},expire:()=>{credentialExpiry=0;}};
}
test('Meta hierarchy proof is complete current state with no historical settlement or material/authority claim',async()=>{
  const f=fixture(),r=await f.read();assert.equal(r.digest,digest(r.snapshot));assert.equal(r.inventoryComplete,true);assert.equal(r.allPaused,true);
  for(const key of ['historicalEffectsSettled','materialVerified','executionTransferred','spendingAuthorityGranted'] as const)assert.equal(r[key],false);
  assert.deepEqual(f.calls.map(u=>u.pathname),['/v26.0/act_123','/v26.0/100','/v26.0/100/adsets','/v26.0/100/ads']);
  assert.doesNotMatch(JSON.stringify(r),/synthetic-secret|access_token/);
});
for(const [label,change] of Object.entries({
  wrongAccount:(f:ReturnType<typeof fixture>)=>{f.campaign.account_id='999';},
  wrongCampaign:(f:ReturnType<typeof fixture>)=>{f.campaign.id='999';},
  currency:(f:ReturnType<typeof fixture>)=>{f.account.currency='CAD';},
  active:(f:ReturnType<typeof fixture>)=>{f.campaign.status='ACTIVE';},
  effectiveUnknown:(f:ReturnType<typeof fixture>)=>{delete f.campaign.effective_status;},
  extraChild:(f:ReturnType<typeof fixture>)=>{f.pages.ads![0].data.push({...f.ad,id:'999'});},
  activeChild:(f:ReturnType<typeof fixture>)=>{f.ad.status='ACTIVE';},
  wrongParent:(f:ReturnType<typeof fixture>)=>{f.ad.adset_id='999';},
}))test(`Meta hierarchy rejects ${label}`,async()=>{const f=fixture();change(f);await assert.rejects(f.read());});
test('Meta hierarchy completes cursor pagination but rejects a failed later page',async()=>{
  const f=fixture();f.pages.ads!.unshift({data:[],paging:{next:'https://untrusted.invalid/ignored',cursors:{after:'next'}}});
  await f.read();assert.equal(f.calls.at(-1)!.searchParams.get('after'),'next');
  const h=fixture();h.pages.ads![0].paging={next:'ignored',cursors:{after:'next'}};
  h.pages.ads!.push(Response.json({error:{code:190,message:'synthetic-secret'}},{status:401}));
  await assert.rejects(h.read(),{code:'existing_campaign_read_unavailable'});
});
test('Meta hierarchy rejects expired credentials, grant changes and lost native authority',async()=>{
  const f=fixture();f.expire();await assert.rejects(f.read(),{code:'provider_access_expired_or_denied'});assert.equal(f.calls.length,0);
  const g=fixture();g.after(()=>{g.g.accountId='act_999';});await assert.rejects(g.read(),{code:'existing_campaign_scope_changed'});
  const h=fixture();let revoked=false;h.after(()=>{revoked=true;});await assert.rejects(h.read(async()=>{if(revoked)throw Error('native access revoked');}),/native access revoked/);
});
