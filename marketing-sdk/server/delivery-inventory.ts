import type {Grant} from '../core/index.js';
import type {VaultPort} from './providers.js';
import {MetaMarketingClient,accountPath} from '../support/owner-marketing/meta-client.js';
import {digest,DomainError,requireThat} from './store.js';

export interface MetaDeliveryTarget {
  nativeCampaignId:string;
  campaignId:string;
  expectedAdsetIds:string[];
  expectedAdIds:string[];
}
export interface MetaDeliveryObject {
  id:string; accountId:string; type:'campaign'|'adset'|'ad';
  campaignId:string; adsetId:string|null; creativeId:string|null;
  configuredStatus:string|null; effectiveStatus:string|null;
}
export interface MetaUnmappedDeliveryCampaign {
  nativeCampaignId:null; campaignId:string; ownership:'unverified';
  reason:'no_native_campaign_mapping'; objects:MetaDeliveryObject[];
  campaignObserved:boolean; orphanAdIds:string[]; unknownStatusIds:string[];
}
const numeric=(v:unknown):v is string=>typeof v==='string'&&/^\d+$/.test(v);
const state=(v:unknown)=>typeof v==='string'&&v.length>0?v:null;

/** A fresh account-level read with separate mapped and ownership-unverified rows.
 * Collection completion is not proof of historical requests, delivery or ownership
 * of unrelated rows. Missing expected objects remain unknown; no write is possible. */
export async function inspectMetaDeliveryInventory(input:{grant:Grant;targets:MetaDeliveryTarget[];
  vault:VaultPort;guard:()=>Promise<void>;fetcher?:typeof fetch}) {
  const {grant:g,targets,vault,guard,fetcher=fetch}=input;
  requireThat(g.campaignId===undefined,'delivery_inventory_account_grant_required',403);
  requireThat(g.provider==='meta'&&vault.useReadOnly&&g.permissions.includes('report')&&
    Array.isArray(targets)&&targets.length>0,'delivery_inventory_scope_invalid',422);
  const unique=(xs:string[])=>new Set(xs).size===xs.length;
  requireThat(targets.every(t=>typeof t.nativeCampaignId==='string'&&t.nativeCampaignId.length>0&&numeric(t.campaignId)&&
    Array.isArray(t.expectedAdsetIds)&&Array.isArray(t.expectedAdIds)&&
    [...t.expectedAdsetIds,...t.expectedAdIds].every(numeric)&&unique(t.expectedAdsetIds)&&unique(t.expectedAdIds))&&
    unique(targets.map(t=>t.campaignId))&&unique(targets.map(t=>t.nativeCampaignId)), 'delivery_inventory_scope_invalid',422);
  const account=accountPath(g.accountId),accountId=account.slice(4),scopeDigest=digest({g,targets});
  requireThat(numeric(accountId),'delivery_inventory_scope_invalid',422);
  const current=async()=>{await guard();requireThat(!g.revokedAt&&Date.parse(g.expiresAt ?? "")>Date.now()&&
    digest({g,targets})===scopeDigest,'delivery_inventory_scope_changed',403);};
  const paths=[account,`${account}/campaigns`,`${account}/adsets`,`${account}/ads`].map(p=>`/v26.0/${p}`);
  let requestCount=0;
  const transport:typeof fetch=async(url,init)=>{
    const u=new URL(String(url));requireThat(u.origin==='https://graph.facebook.com'&&paths.includes(u.pathname)&&
      init?.method==='GET'&&init.redirect==='error','delivery_inventory_read_boundary',403);
    await current();requestCount++;const r=await fetcher(url,init);await current();return r;
  };
  await current();const startedAt=new Date().toISOString();
  try{return await vault.useReadOnly!(g,current,async credentials=>{
    requireThat(credentials.expiresAt>Date.now(),'provider_access_expired_or_denied',403);
    const client=new MetaMarketingClient({...credentials,fetchImpl:transport});
    const accountRow=await client.getObject(account,'id,currency,timezone_name');
    requireThat(accountRow.id===account&&accountRow.currency===g.currency&&accountRow.timezone_name===g.timezone,
      'provider_account_context_changed');
    const definitions=[['campaign','campaigns','id,account_id,status,effective_status'],
      ['adset','adsets','id,account_id,campaign_id,status,effective_status'],
      ['ad','ads','id,account_id,campaign_id,adset_id,creative,status,effective_status']] as const;
    const objects:MetaDeliveryObject[]=[];
    for(const [type,edge,fields] of definitions){
      const result=await client.readAllPages(`${account}/${edge}`,{fields,limit:200});const seen=new Set<string>();
      for(const row of result.data){
        requireThat(row&&numeric(row.id)&&row.account_id===accountId&&!seen.has(row.id)&&
          (type==='campaign'||numeric(row.campaign_id))&&(type!=='ad'||numeric(row.adset_id)),
          'delivery_inventory_identity_invalid');seen.add(row.id);
        const campaignId=type==='campaign'?row.id:row.campaign_id;
        objects.push({id:row.id,accountId,type,campaignId,adsetId:type==='ad'?row.adset_id:null,
          creativeId:type==='ad'&&numeric(row.creative?.id)?row.creative.id:null,
          configuredStatus:state(row.status),effectiveStatus:state(row.effective_status)});
      }
    }
    const campaigns=targets.map(t=>{
      const found=objects.filter(o=>o.campaignId===t.campaignId).sort((a,b)=>a.type.localeCompare(b.type)||a.id.localeCompare(b.id));
      const missing=[...(!found.some(o=>o.type==='campaign')?[{type:'campaign',id:t.campaignId}]:[]),
        ...t.expectedAdsetIds.filter(id=>!found.some(o=>o.type==='adset'&&o.id===id)).map(id=>({type:'adset',id})),
        ...t.expectedAdIds.filter(id=>!found.some(o=>o.type==='ad'&&o.id===id)).map(id=>({type:'ad',id}))];
      const orphanAds=found.filter(o=>o.type==='ad'&&!found.some(p=>p.type==='adset'&&p.id===o.adsetId)).map(o=>o.id);
      const unknownStatusIds=found.filter(o=>!o.configuredStatus||!o.effectiveStatus).map(o=>o.id);
      const complete=missing.length===0&&orphanAds.length===0&&unknownStatusIds.length===0;
      return {nativeCampaignId:t.nativeCampaignId,campaignId:t.campaignId,objects:found,missing,orphanAds,unknownStatusIds,complete,
        allPaused:complete?found.every(o=>o.configuredStatus==='PAUSED'&&
          (o.type==='campaign'?o.effectiveStatus==='PAUSED':['PAUSED','CAMPAIGN_PAUSED',...(o.type==='ad'?['ADSET_PAUSED']:[])].includes(o.effectiveStatus!))):null};
    });
    const unmappedCampaignIds=[...new Set(objects.filter(o=>!targets.some(t=>t.campaignId===o.campaignId)).map(o=>o.campaignId))].sort();
    const unmappedProviderCampaigns:MetaUnmappedDeliveryCampaign[]=unmappedCampaignIds.map(campaignId=>{
      const found=objects.filter(o=>o.campaignId===campaignId).sort((a,b)=>a.type.localeCompare(b.type)||a.id.localeCompare(b.id));
      return {nativeCampaignId:null,campaignId,ownership:'unverified',reason:'no_native_campaign_mapping',objects:found,
        campaignObserved:found.some(o=>o.type==='campaign'),
        orphanAdIds:found.filter(o=>o.type==='ad'&&!found.some(p=>p.type==='adset'&&p.id===o.adsetId)).map(o=>o.id),
        unknownStatusIds:found.filter(o=>!o.configuredStatus||!o.effectiveStatus).map(o=>o.id)};
    });
    await current();const snapshot={account:{id:account,currency:g.currency,timezone:g.timezone},campaigns,unmappedProviderCampaigns};
    return {provider:'meta' as const,source:'provider_api' as const,scope:'visible_account_campaigns_and_children' as const,
      ownershipBasis:'explicit_native_mappings_only' as const,pauseScope:'mapped_campaigns_only' as const,
      startedAt,observedAt:new Date().toISOString(),requestCount,paginationComplete:true as const,
      complete:campaigns.every(c=>c.complete),allPaused:campaigns.every(c=>c.complete&&c.allPaused===true),
      snapshot,digest:digest(snapshot),providerWritesPerformed:false as const,spendingAuthorityGranted:false as const,
      deliveryVerified:false as const,historicalEffectsSettled:false as const};
  });}catch(error){await current();if(error instanceof DomainError)throw error;
    // No provider response, URL or credential enters diagnostics.
    throw new DomainError('delivery_inventory_unavailable',502);
  }
}
