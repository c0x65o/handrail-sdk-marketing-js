import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeProvider,type VaultPort} from '../server/providers.js';
import {digest,type Store} from '../server/store.js';
import type {Grant} from '../core/index.js';
function fixture(){
  const g:Grant={id:'g',projectId:'p',revision:1,provider:'linkedin',accountId:'123',organizationId:'42',label:'Fixture',currency:'USD',timezone:'UTC',permissions:['report'],expiresAt:'2099-01-01T00:00:00Z',revokedAt:null,secretRef:'opaque'};
  const ids={group:'99',campaign:'100',creative:'102'},account:any={id:123,currency:'USD'},
    group:any={id:99,account:'urn:li:sponsoredAccount:123',status:'ACTIVE'},
    campaign:any={id:100,account:'urn:li:sponsoredAccount:123',campaignGroup:'urn:li:sponsoredCampaignGroup:99',associatedEntity:'urn:li:organization:42',status:'PAUSED'},
    creative:any={id:'urn:li:sponsoredCreative:102',campaign:'urn:li:sponsoredCampaign:100',intendedStatus:'PAUSED'},
    pages:any[]=[{elements:[creative]}],calls:URL[]=[];
  let afterFetch=()=>{},credentialExpiry=Date.parse(g.expiresAt!);
  const vault:VaultPort={use:async()=>{throw Error('write credentials prohibited');},useReadOnly:async(_g,guard,action)=>{
    await guard();return action({accessToken:'synthetic-secret',clientId:'synthetic-client',clientSecret:'synthetic-client-secret',expiresAt:credentialExpiry,scopes:['r_ads']});
  }};
  const provider=new NativeProvider('linkedin',vault,null as unknown as Store,async(input,init)=>{
    const u=new URL(String(input));calls.push(u);assert.equal(init?.method,'GET');assert.equal(init?.redirect,'error');
    assert.equal(u.origin,'https://api.linkedin.com');
    const body=u.pathname==='/rest/adAccounts/123'?account:u.pathname.endsWith('/adCampaignGroups/99')?group:
      u.pathname.endsWith('/adCampaigns/100')?campaign:u.pathname.endsWith('/creatives')?pages.shift():null;
    assert.ok(body,'unexpected request');if(u.pathname.endsWith('/creatives'))assert.equal(u.searchParams.get('campaigns'),'List(urn:li:sponsoredCampaign:100)');
    afterFetch();return body instanceof Response?body:Response.json(body);
  });
  return {g,ids,account,group,campaign,creative,pages,calls,read:(guard=async()=>{})=>provider.inspectExistingLinkedInHierarchy(g,ids,guard),
    after:(fn:()=>void)=>{afterFetch=fn;},expire:()=>{credentialExpiry=0;}};
}
test('LinkedIn hierarchy retains ACTIVE shared group and proves only exact stopped campaign and complete children',async()=>{
  const f=fixture(),r=await f.read();assert.equal(r.digest,digest(r.snapshot));assert.equal(r.inventoryComplete,true);assert.equal(r.allPaused,true);
  assert.equal(r.snapshot.group.status,'ACTIVE');assert.equal(r.sharedGroupModified,false);assert.equal(r.snapshot.creatives[0]!.id,'102');
  for(const key of ['historicalEffectsSettled','materialVerified','executionTransferred','spendingAuthorityGranted'] as const)assert.equal(r[key],false);
  assert.equal(f.calls.length,4);assert.doesNotMatch(JSON.stringify(r),/synthetic-secret|access_token/);
});
for(const [label,change] of Object.entries({
  account:(f:ReturnType<typeof fixture>)=>{f.account.id=999;},currency:(f:ReturnType<typeof fixture>)=>{f.account.currency='CAD';},
  groupAccount:(f:ReturnType<typeof fixture>)=>{f.group.account='urn:li:sponsoredAccount:999';},group:(f:ReturnType<typeof fixture>)=>{f.group.id=999;},
  campaignAccount:(f:ReturnType<typeof fixture>)=>{f.campaign.account='urn:li:sponsoredAccount:999';},
  campaignGroup:(f:ReturnType<typeof fixture>)=>{f.campaign.campaignGroup='urn:li:sponsoredCampaignGroup:999';},
  organization:(f:ReturnType<typeof fixture>)=>{f.campaign.associatedEntity='urn:li:organization:999';},
  active:(f:ReturnType<typeof fixture>)=>{f.campaign.status='ACTIVE';},unknownStatus:(f:ReturnType<typeof fixture>)=>{delete f.campaign.status;},
  extraChild:(f:ReturnType<typeof fixture>)=>{f.pages[0].elements.push({...f.creative,id:999});},
  activeChild:(f:ReturnType<typeof fixture>)=>{f.creative.intendedStatus='ACTIVE';},wrongParent:(f:ReturnType<typeof fixture>)=>{f.creative.campaign='urn:li:sponsoredCampaign:999';},
}))test(`LinkedIn hierarchy rejects ${label}`,async()=>{const f=fixture();change(f);await assert.rejects(f.read());});
test('LinkedIn hierarchy completes pagination and rejects failed, missing, duplicate and repeating pages',async()=>{
  const f=fixture();f.pages.unshift({elements:[],metadata:{nextPageToken:'next'}});await f.read();assert.equal(f.calls.at(-1)!.searchParams.get('pageToken'),'next');
  for(const next of [Response.json({message:'synthetic-secret',status:401},{status:401}),{},
    {elements:[{id:'102',campaign:'urn:li:sponsoredCampaign:100',intendedStatus:'PAUSED'}]},
    {elements:[],metadata:{nextPageToken:'next'}}]){
    const h=fixture();h.pages[0].metadata={nextPageToken:'next'};h.pages.push(next);await assert.rejects(h.read());
  }
});
test('LinkedIn hierarchy rejects expired credentials, changed grant and revoked host authority',async()=>{
  const f=fixture();f.expire();await assert.rejects(f.read(),{code:'provider_access_expired_or_denied'});assert.equal(f.calls.length,0);
  const g=fixture();g.after(()=>{g.g.accountId='999';});await assert.rejects(g.read(),{code:'existing_campaign_scope_changed'});
  const h=fixture();let revoked=false;h.after(()=>{revoked=true;});await assert.rejects(h.read(async()=>{if(revoked)throw Error('native access revoked');}),/native access revoked/);
});
