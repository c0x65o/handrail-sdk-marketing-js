import {digest,requireThat,type Store} from './store.js';

/** Provider observations are not invoices or spend authorization. Repeated video
 * polls may report cumulative usage; callers must not add these observations. */
export interface GenerationUsageObservation {
  schemaVersion: 1;
  phase: 'submit'|'reconcile';
  outcome: 'response'|'error'|'unknown';
  observedAt: string;
  requestId: string|null;
  httpStatus: number|null;
  usage: {
    inputTokens:number|null; cachedInputTokens:number|null; outputTokens:number|null;
    reasoningTokens:number|null; totalTokens:number|null;
    inputImageTokens:number|null; inputTextTokens:number|null; outputImageTokens:number|null;
    reasons:string[];
  };
  measuredCost: null;
  costReason: 'provider_cost_not_observed';
}

export interface GenerationUsageEvidence {
  id:string;projectId:string;jobId:string;grantId:string;provider:string;model:string;kind:'image'|'video';
  /** Present on new observations; historical facts are not backfilled. */
  size?:string;quality?:import("../core/index.js").ImageGenerationQuality|null;maxSeconds?:number;
  observation:GenerationUsageObservation;
}
export const generationUsagePrefix=(project:string,jobId:string)=>`generation_usage_${digest([project,jobId])}_`;

/** Server-only, project/job-scoped receipt pagination. The host supplies read
 * authority; evidence never confers permission or releases a cost reservation. */
export async function readGenerationUsageEvidence(store:Store,project:string,jobId:string,
  options:{after?:string;limit?:number}={}):Promise<{items:GenerationUsageEvidence[];nextAfter:string|null}> {
  const prefix=generationUsagePrefix(project,jobId),limit=options.limit??50;
  requireThat(Number.isSafeInteger(limit)&&limit>=1&&limit<=100,'invalid_generation_usage_limit',400);
  requireThat(!options.after||options.after.startsWith(prefix)&&/^[a-f0-9]{64}$/.test(options.after.slice(prefix.length)),
    'generation_usage_cursor_scope',400);
  const rows=await store.db.prepare("SELECT body FROM records WHERE project_id=? AND kind='generationUsageEvidence' AND id LIKE ? ESCAPE '!' AND id>? ORDER BY id LIMIT ?")
    .all(project,`${prefix.replaceAll('_','!_')}%`,options.after??'',limit+1);
  const items=rows.slice(0,limit).map(row=>JSON.parse(String(row.body)) as GenerationUsageEvidence);
  return {items,nextAfter:rows.length>limit?items[items.length-1]!.id:null};
}

export const generationRequestId=(value:unknown):string|null=>
  typeof value==='string'&&/^[a-zA-Z0-9_-]{1,200}$/.test(value)?value:null;

/** Copy only documented numeric usage fields. Never persist raw responses,
 * prompts, media, headers, credentials or provider error messages. */
export function generationUsageObservation(phase:GenerationUsageObservation['phase'],
  outcome:GenerationUsageObservation['outcome'],requestId:unknown,status:unknown,usage:unknown):GenerationUsageObservation {
  const raw=usage&&typeof usage==='object'?usage as Record<string,unknown>:{};
  const nested=(key:string)=>raw[key]&&typeof raw[key]==='object'?raw[key] as Record<string,unknown>:{};
  const input=nested('input_tokens_details'),output=nested('output_tokens_details'),reasons:string[]=[];
  const count=(key:string,value:unknown):number|null=>{
    if(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0)return value;
    reasons.push(`${key}:${value===undefined||value===null?'missing':'invalid'}`);return null;
  };
  const counts={inputTokens:count('inputTokens',raw.input_tokens),cachedInputTokens:count('cachedInputTokens',input.cached_tokens),
    outputTokens:count('outputTokens',raw.output_tokens),reasoningTokens:count('reasoningTokens',output.reasoning_tokens),
    totalTokens:count('totalTokens',raw.total_tokens),inputImageTokens:count('inputImageTokens',input.image_tokens),
    inputTextTokens:count('inputTextTokens',input.text_tokens),outputImageTokens:count('outputImageTokens',output.image_tokens)};
  if(counts.inputTokens!==null&&counts.outputTokens!==null&&counts.totalTokens!==null&&
    counts.inputTokens+counts.outputTokens!==counts.totalTokens)reasons.push('totalTokens:provider_counts_disagree');
  return {schemaVersion:1,phase,outcome,observedAt:new Date().toISOString(),requestId:generationRequestId(requestId),
    httpStatus:typeof status==='number'&&Number.isInteger(status)&&status>=100&&status<=599?status:null,
    usage:{...counts,reasons},measuredCost:null,costReason:'provider_cost_not_observed'};
}
