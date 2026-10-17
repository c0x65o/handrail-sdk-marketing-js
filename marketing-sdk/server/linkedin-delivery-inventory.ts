import type {Grant} from '../core/index.js';
import type {VaultPort} from './providers.js';
import {LinkedInMarketingClient} from '../support/owner-marketing/linkedin-client.js';
import {digest,DomainError,requireThat} from './store.js';

export interface LinkedInDeliveryTarget {
  nativeCampaignId:string; campaignId:string; groupId:string; expectedCreativeIds:string[];
}
export interface LinkedInDeliveryObject {
  id:string; accountId:string; type:'group'|'campaign'|'creative';
  campaignId:string|null; groupId:string|null; configuredStatus:string|null;
  servingStatuses:string[]|null; isServing:boolean|null;
}
const numeric=(v:unknown):v is string=>typeof v==='string'&&/^\d+$/.test(v);
const unique=(xs:string[])=>new Set(xs).size===xs.length;
const providerId=(v:unknown,kind:string)=>{
  if(typeof v==='number'&&Number.isSafeInteger(v)&&v>0)return String(v);
  if(numeric(v))return v;
  const prefix=`urn:li:${kind}:`;
  return typeof v==='string'&&v.startsWith(prefix)&&numeric(v.slice(prefix.length))?v.slice(prefix.length):null;
};

/** Account-wide collection with immutable mapped identities. Shared group state
 * is observed, never changed or mistaken for individual campaign delivery.
 * Unmapped identities remain ownership-unverified, including orphan children. */
export async function inspectLinkedInDeliveryInventory(input:{grant:Grant;targets:LinkedInDeliveryTarget[];
  vault:VaultPort;guard:()=>Promise<void>;fetcher?:typeof fetch}) {
  const {grant:g,targets,vault,guard,fetcher=fetch}=input;
  requireThat(g.campaignId===undefined,'delivery_inventory_account_grant_required',403);
  requireThat(g.provider==='linkedin'&&vault.useReadOnly&&g.permissions.includes('report')&&numeric(g.accountId)&&
    Array.isArray(targets)&&targets.length>0&&targets.every(t=>typeof t.nativeCampaignId==='string'&&t.nativeCampaignId.length>0&&
      numeric(t.campaignId)&&numeric(t.groupId)&&Array.isArray(t.expectedCreativeIds)&&t.expectedCreativeIds.every(numeric)&&
      unique(t.expectedCreativeIds))&&unique(targets.map(t=>t.campaignId))&&unique(targets.map(t=>t.nativeCampaignId)),
    'delivery_inventory_scope_invalid',422);
  const scopeDigest=digest({g,targets}),accountId=g.accountId,root=`/rest/adAccounts/${accountId}`;
  const current=async()=>{await guard();requireThat(!g.revokedAt&&Date.parse(g.expiresAt??'')>Date.now()&&
    digest({g,targets})===scopeDigest,'delivery_inventory_scope_changed',403);};
  const paths=[root,`${root}/adCampaignGroups`,`${root}/adCampaigns`,`${root}/creatives`];
  let requestCount=0;
  const transport:typeof fetch=async(url,init)=>{
    const u=new URL(String(url));requireThat(u.origin==='https://api.linkedin.com'&&paths.includes(u.pathname)&&
      init?.method==='GET'&&init.redirect==='error','delivery_inventory_read_boundary',403);
    await current();requestCount++;const r=await fetcher(url,init);await current();return r;
  };
  await current();const startedAt=new Date().toISOString();
  try{return await vault.useReadOnly!(g,current,async credentials=>{
    requireThat(credentials.expiresAt>Date.now(),'provider_access_expired_or_denied',403);
    // Custody has already refreshed and qualified this exact token. This reader
    // admits only GETs and cannot refresh credentials or follow provider links.
    const client=new LinkedInMarketingClient({accessToken:credentials.accessToken,clientId:credentials.clientId,
      clientSecret:credentials.clientSecret,fetchImpl:transport});
    const account=await client.getAdAccount(accountId);
    requireThat(providerId(account.id,'sponsoredAccount')===accountId&&account.currency===g.currency&&g.timezone==='UTC',
      'provider_account_context_changed');
    const objects:LinkedInDeliveryObject[]=[];
    for(const type of ['group','campaign','creative'] as const){
      let pageToken:string|null=null;const tokens=new Set<string>(),seen=new Set<string>();
      do {
        const options:{pageSize:number;pageToken:string|null}={pageSize:100,pageToken};
        const page:any=await (type==='group'?client.listCampaignGroups(accountId,options):
          type==='campaign'?client.listCampaigns(accountId,options):client.listCreatives(accountId,options));
        requireThat(page&&Array.isArray(page.elements)&&page.metadata&&typeof page.metadata==='object'&&!Array.isArray(page.metadata),
          'delivery_inventory_pagination_invalid');
        for(const row of page.elements){
          const id=providerId(row?.id,type==='group'?'sponsoredCampaignGroup':type==='campaign'?'sponsoredCampaign':'sponsoredCreative');
          const campaignId=type==='campaign'?id:type==='creative'?providerId(row?.campaign,'sponsoredCampaign'):null;
          const groupId=type==='group'?id:type==='campaign'?providerId(row?.campaignGroup,'sponsoredCampaignGroup'):null;
          requireThat(id&&providerId(row?.account,'sponsoredAccount')===accountId&&!seen.has(id)&&
            (type!=='campaign'||groupId)&&(type!=='creative'||campaignId),'delivery_inventory_identity_invalid');
          seen.add(id!);
          const status=type==='creative'?row.intendedStatus:row.status;
          objects.push({id:id!,accountId,type,campaignId,groupId,configuredStatus:typeof status==='string'&&status.length>0?status:null,
            servingStatuses:Array.isArray(row.servingStatuses)&&row.servingStatuses.every((s:unknown)=>typeof s==='string')?row.servingStatuses:null,
            isServing:typeof row.isServing==='boolean'?row.isServing:null});
        }
        const next:unknown=page.metadata.nextPageToken;
        requireThat(next===undefined||next===null||typeof next==='string'&&next.length>0,'delivery_inventory_pagination_invalid');
        pageToken=typeof next==='string'?next:null;
        if(pageToken){requireThat(!tokens.has(pageToken),'delivery_inventory_pagination_invalid');tokens.add(pageToken);}
      }while(pageToken);
    }
    const groups=objects.filter(o=>o.type==='group');
    const campaigns=targets.map(t=>{
      const found=objects.filter(o=>o.type!=='group'&&o.campaignId===t.campaignId);
      const campaign=found.find(o=>o.type==='campaign'),group=groups.find(o=>o.id===t.groupId)??null;
      const missing=[...(!campaign?[{type:'campaign',id:t.campaignId}]:[]),...(!group?[{type:'group',id:t.groupId}]:[]),
        ...t.expectedCreativeIds.filter(id=>!found.some(o=>o.type==='creative'&&o.id===id)).map(id=>({type:'creative',id}))];
      requireThat(!campaign||campaign.groupId===t.groupId,'delivery_inventory_identity_invalid');
      const unknownStatusIds=found.filter(o=>!o.configuredStatus).map(o=>o.id);
      const complete=missing.length===0&&unknownStatusIds.length===0;
      return {nativeCampaignId:t.nativeCampaignId,campaignId:t.campaignId,group,objects:found,missing,unknownStatusIds,complete,
        allPaused:complete?found.every(o=>o.configuredStatus==='PAUSED'&&o.isServing!==true&&
          !o.servingStatuses?.includes('RUNNABLE')):null};
    });
    const unmappedIds=[...new Set(objects.filter(o=>o.type!=='group'&&!targets.some(t=>t.campaignId===o.campaignId)).map(o=>o.campaignId!))].sort();
    const unmappedProviderCampaigns=unmappedIds.map(campaignId=>{
      const found=objects.filter(o=>o.type!=='group'&&o.campaignId===campaignId),campaign=found.find(o=>o.type==='campaign');
      return {nativeCampaignId:null,campaignId,ownership:'unverified' as const,reason:'no_native_campaign_mapping' as const,
        objects:found,campaignObserved:Boolean(campaign),groupObserved:Boolean(campaign&&groups.some(g=>g.id===campaign.groupId)),
        unknownStatusIds:found.filter(o=>!o.configuredStatus).map(o=>o.id)};
    });
    await current();const snapshot={account:{id:accountId,currency:g.currency,timezone:g.timezone},groups,campaigns,unmappedProviderCampaigns};
    return {provider:'linkedin' as const,source:'provider_api' as const,scope:'visible_account_campaigns_and_children' as const,
      ownershipBasis:'explicit_native_mappings_only' as const,pauseScope:'mapped_campaigns_only' as const,
      startedAt,observedAt:new Date().toISOString(),requestCount,paginationComplete:true as const,
      complete:campaigns.every(c=>c.complete),allPaused:campaigns.every(c=>c.complete&&c.allPaused===true),
      snapshot,digest:digest(snapshot),providerWritesPerformed:false as const,spendingAuthorityGranted:false as const,
      deliveryVerified:false as const,historicalEffectsSettled:false as const};
  });}catch(error){await current();if(error instanceof DomainError)throw error;throw new DomainError('delivery_inventory_unavailable',502);}
}
