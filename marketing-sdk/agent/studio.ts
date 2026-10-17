import type { StudioCommands } from '../core/index.js';
import {material} from './schemas.js';

const str=(maxLength:number,minLength=0)=>({type:'string',minLength,maxLength});
const id=str(200,1), revision={type:'integer',minimum:1};
const object=(properties:Record<string,unknown>,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const destination={type:['string','null'],maxLength:2000};
const brief=object({name:str(100,1),offer:str(4000),audience:str(4000),outcome:{enum:['acquisition','recruitment']},
  destination,facts:{type:'array',maxItems:10,items:str(2000)},constraints:str(4000),direction:str(1000)});
const option=object({title:str(200,1),audienceHypothesis:str(4000),offer:str(4000),rationale:str(2000),
  unknowns:{type:'array',maxItems:10,items:str(2000)},provider:{enum:['meta','google','linkedin']},
  format:{enum:['single_image','search_text']},destination,
  variants:{type:'array',minItems:1,maxItems:3,items:object({headline:str(150),body:str(3000),cta:str(100)})}});
const change={draftId:id,expectedRevision:revision,requestKey:id};
const source={id,kind:{enum:['draft','campaign']},expectedRevision:revision,requestKey:id};
// Draft settings are partial versions of the same provider contract. The SDK
// validates edits again; partial data is never publication readiness.
const partial=(schema:unknown):unknown=>{
  if(!schema||typeof schema!=='object')return schema;
  if(Array.isArray(schema))return schema.map(partial);
  return Object.fromEntries(Object.entries(schema).filter(([key])=>!['required','minLength'].includes(key)).map(([key,value])=>[key==='oneOf'?'anyOf':key,partial(value)]));
};
const draftProperties={...partial(material.properties) as Record<string,unknown>,name:str(100,1),
  settings:partial(material.properties.settings),audience:partial(material.properties.audience),
  budget:{anyOf:[partial(material.properties.budget),{type:'null'}]},
  advertisingBudget:partial(material.properties.advertisingBudget),endAt:{type:['string','null']}};
/** Shared Studio workflow. Generation consumes separate exact host authority;
 * no tool creates approval, credentials, tracking evidence or ad publication. */
export const marketingStudioToolSchemas = [
  {command:'studio',description:'Read the current SDK draft, options, assets and checks.',inputSchema:object({draftId:id})},
  {command:'generateDraftMedia',description:'Request one image/media attempt against an existing exact generation grant and quote. Host approval, current policy, material and cost controls apply. A saved request is not proof of success; inspect its job state. Never replace an uncertain request or retry with a new key.',inputSchema:object({...change,grantId:id,prompt:str(6000,1),rightsReceipt:str(200,1),quoteReceipt:id})},
  {command:'continueDraftMedia',description:'Continue only the original never-attempted queued media job under current explicit host authority, identified by its original generation request key. Keeps its original approval and reservation. Running, unknown or attempted jobs cannot be retried; use original outcome reads instead.',inputSchema:object({generationRequestKey:id})},
  {command:'draftMediaRequest',description:'Read the original generation admission receipt and current job using its original request key. Missing is unknown. No dispatch, provider retry, reservation release or settlement inference; remains readable after original grant/session expiry.',inputSchema:object({generationRequestKey:id})},
  {command:'listCampaigns',description:'Read the SDK campaign/draft library. Follow nextCursor.',inputSchema:object({query:str(200),kind:source.kind,lifecycle:{enum:['active','archived','trash']},cursor:id,limit:{type:'integer',minimum:1,maximum:50}},[])},
  {command:'saveBrief',description:'Create or revise a local SDK campaign brief. For a revision supply id and expectedRevision. Preserve acquisition/recruitment intent and factual sources. This creates no ad or spending authority.',inputSchema:object({id,expectedRevision:revision,requestKey:id,brief},['requestKey','brief'])},
  {command:'saveCampaignOption',description:'Save a campaign option using actual brief facts; distinguish audience hypotheses and unknowns. This is an authored proposal, not a provider observation.',inputSchema:object({...change,optionId:id,value:option},[...Object.keys(change),'value'])},
  {command:'saveStudioMaterial',description:'Revise local draft material using SDK provider settings, budget, copy and tracking contracts. Missing fields remain incomplete. Use media selection for asset changes and the brief for acquisition/recruitment intent.',inputSchema:object({...change,material:object(draftProperties,['name']),step:{enum:['brief','options','media','checks','tracking']}})},
  {command:'selectCampaignOption',description:'Select the exact retained option revision and copy variant.',inputSchema:object({...change,optionId:id,optionRevision:revision,variant:{type:'integer',minimum:0,maximum:2}})},
  {command:'selectStudioMedia',description:'Select existing SDK asset identities for the draft. Does not import, generate or assert rights for new media.',inputSchema:object({...change,assetIds:{type:'array',items:id,maxItems:30}})},
  {command:'copyToDraft',description:'Copy the exact retained draft/campaign revision into a local draft, preserving source references and media rights. Never recreates provider ads.',inputSchema:object(source)},
  {command:'setCampaignLifecycle',description:'Archive, trash or restore the local library entry. Provider delivery and historical records are unchanged; this is not provider deletion or pause/resume.',inputSchema:object({...source,lifecycle:{enum:['active','archived','trash']}})},
  {command:'checkStudio',description:'Record SDK technical/editorial/provider readiness against the current draft and optional account. Missing evidence remains unknown; a check grants no approval.',inputSchema:object({draftId:id,expectedRevision:revision,grantId:id},['draftId','expectedRevision'])},
  {command:'promoteStudio',description:'Promote the exact draft and account revision into a canonical local campaign. Retains original media/tracking/source identities; creates no provider objects or launch approval.',inputSchema:object({...change,grantId:id,expectedGrantRevision:revision})},
] satisfies {command:keyof StudioCommands;description:string;inputSchema:ReturnType<typeof object>}[];

export type MarketingStudioAgentCommand = typeof marketingStudioToolSchemas[number]['command'];
