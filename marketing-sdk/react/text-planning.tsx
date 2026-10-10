import { useEffect, useRef, useState } from 'react';
import type { MarketingClient, TextPlanningConnection, TextPlanningReview, PlanningRequest, Commands } from '../core/index.js';

/** Explicit reads only. Host supplies authority facts, never replacement forms. */
export function TextPlanningConnections({client}:{client:MarketingClient}) {
  const [value,setValue]=useState<Commands['textPlanningConnections']['output']|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  const pending=useRef<AbortController|null>(null);
  useEffect(()=>{setValue(null);setError('');setLoading(false);return()=>{pending.current?.abort();pending.current=null;};},[client]);
  async function check(){
    if(pending.current)return;const abort=new AbortController();pending.current=abort;setLoading(true);setError('');setValue(null);
    try{const result=await client.call('textPlanningConnections',{},{signal:abort.signal});if(!abort.signal.aborted)setValue(result);}
    catch{if(!abort.signal.aborted)setError('Text setup could not be checked. Sign in again or ask the project administrator to restore text permission and billing.');}
    finally{if(pending.current===abort){pending.current=null;setLoading(false);}}
  }
  return <section className="card" aria-label="Text planning connections"><h2>AI text planning</h2><p>Text access is separate from advertising, image and video access. Your current human session, text-purpose credential permission and exact cost review are all required. Agent is optional.</p>
    <button disabled={loading} onClick={()=>void check()}>{loading?'Checking text setup…':'Check text setup'}</button>
    <p role="status">{error||value?.reason}</p>{value?.setup?.map(s=><p key={s.provider}>{s.configured?<a href={s.path}>Secure {s.provider==='openai'?'OpenAI':'xAI'} text setup</a>:`${s.provider} text setup needs current host configuration.`}</p>)}{value?.connections.map(c=><article key={c.id}><h3>{c.label}</h3><p>{c.provider} · {c.model} · {c.environment}</p><p>{c.state==='available'?'Credential permission available; exact quote still required':'Setup needs attention'} · {c.reason}</p></article>)}
  </section>;
}
type Intent = {command:'applyPlanningOption';input:Commands['applyPlanningOption']['input']}|{command:'reviewTextPlan';input:Commands['reviewTextPlan']['input']}|{command:'approveTextPlan';input:Commands['approveTextPlan']['input']};
export function TextPlanningPanel({client,draftId,revision,dirty,reviews,plans,busy,run,submit,onRefresh,onConnections}:{client:MarketingClient;draftId:string;revision:number;dirty:boolean;reviews:TextPlanningReview[];plans:PlanningRequest[];busy:boolean;run:(action:()=>Promise<void>)=>Promise<void>;submit:(intent:Intent)=>Promise<void>;onRefresh:()=>Promise<void>;onConnections?:()=>void}) {
  const [connections,setConnections]=useState<TextPlanningConnection[]>([]),[reason,setReason]=useState('Choose a text-purpose connection to review one bounded request.'),[selected,setSelected]=useState(''),[cancelled,setCancelled]=useState('');
  const lookup=useRef<AbortController|null>(null);
  useEffect(()=>{setConnections([]);setSelected('');setCancelled('');return()=>{lookup.current?.abort();lookup.current=null;};},[client,draftId]);
  const review=reviews.filter(r=>r.state==='review'&&r.id!==cancelled&&r.draftRevision===revision&&(!selected||r.connection.id===selected)).at(-1);
  const unresolved=plans.some(r=>['queued','running','unknown'].includes(r.state)||(r.textReceipt&&r.textReceipt.settlement!=='settled'));
  return <section className="card" aria-label="Interactive AI planning"><h3>Suggest campaign options</h3><p>{reason}</p>
    <button disabled={busy} onClick={()=>void run(async()=>{lookup.current?.abort();const abort=new AbortController();lookup.current=abort;const result=await client.call('textPlanningConnections',{},{signal:abort.signal});if(!abort.signal.aborted){setConnections(result.connections);setReason(result.reason);}})}>Choose text connection and model</button>
    {onConnections&&<button className="secondary" onClick={onConnections}>Review Connections setup</button>}
    {connections.length>0&&<label>Text connection and model<select aria-label="Text connection and model" value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Choose current text permission</option>{connections.map(c=><option key={c.id} value={c.id} disabled={c.state!=='available'}>{c.label} · {c.provider} / {c.model} · {c.environment}{c.state!=='available'?' · unavailable':''}</option>)}</select></label>}
    {connections.find(c=>c.id===selected)&&<p>{connections.find(c=>c.id===selected)!.reason}</p>}
    {selected&&<button disabled={busy||dirty||unresolved} onClick={()=>void run(()=>submit({command:'reviewTextPlan',input:{draftId,expectedRevision:revision,connectionId:selected,maxOutputTokens:4096,requestKey:crypto.randomUUID()}}))}>Review exact request and cost</button>}
    {dirty&&<p>Save your edits before reviewing a quote.</p>}
    {unresolved&&<p>An admitted request or its cost is unresolved. Check its retained progress below; another key cannot start a second request.</p>}
    {review&&<section aria-label="Exact text request review"><h4>Review before requesting options</h4>
      <p>{review.evidence==='synthetic'?'Synthetic qualification · no real provider spend. ':''}{review.connection.label} · {review.connection.provider} / {review.connection.model} · {review.connection.environment}</p>
      <p>Saved brief revision {review.draftRevision}. One attempt; at most {review.quote.inputTokenUpperBound.toLocaleString()} input tokens and {review.quote.maxOutputTokens.toLocaleString()} output tokens. Request size: {review.requestBytes.toLocaleString()} UTF-8 bytes.</p>
      <p>Maximum cost: {money(review.quote.ceilingMinor,review.quote.currency)} ({review.quote.ceilingMinor} minor units). Expires {new Date(review.quote.expiresAt).toLocaleString()}. Price revision: {review.quote.pricingRevision}.</p>
      <p>Token bound: {review.quote.meteringBasis}. Refused or invalid output may still cost money. Closing this page after approval does not prove cancellation. No automatic retries or unattended access.</p>
      <details><summary>Exact brief sent to the model</summary><dl>{Object.entries(review.brief).map(([name,value])=><div key={name}><dt>{name}</dt><dd>{Array.isArray(value)?value.join('; '):value??'Not supplied'}</dd></div>)}</dl><p>{review.prompt}</p></details>
      <details><summary>Full generated request (technical details)</summary><pre>{JSON.stringify(review.requestBody,null,2)}</pre></details><details><summary>Request identity</summary><p>Request: <code>{review.requestDigest}</code></p><p>Schema: <code>{review.schemaDigest}</code></p><p>Review: <code>{review.reviewDigest}</code></p></details>
      <button disabled={busy||dirty||unresolved||Date.parse(review.quote.expiresAt)<=Date.now()} onClick={()=>void run(()=>submit({command:'approveTextPlan',input:{reviewId:review.id,reviewDigest:review.reviewDigest,requestKey:crypto.randomUUID()}}))}>Approve exact cost and request options once</button>
      <button className="secondary" disabled={busy} onClick={()=>void run(async()=>{await client.call('cancelTextPlan',{reviewId:review.id,reviewDigest:review.reviewDigest});setSelected('');setCancelled(review.id);setReason('Review cancelled. No new request was authorized. Reload saved progress to refresh retained reviews.');})}>Cancel request review</button>
    </section>}
    {plans.filter(r=>r.textReceipt).map(r=><article key={r.id} aria-label="Text planning progress"><h4>{({queued:'Accepted',running:'Running',succeeded:'Needs your review',failed:'Response needs attention',unknown:'Outcome needs attention'})[r.state]}</h4><p>{r.reason}</p><p>Cost: {r.textReceipt!.settlement==='settled'?`${money(r.textReceipt!.settledMinor!,r.textReceipt!.currency)} settled`:'Reserved; final cost is not confirmed'}. {r.providerResponseId?'Response identity retained.':'Response identity not available.'}</p><p>Synthetic and provider evidence remain distinct: {r.textReceipt!.evidence}.</p>{r.options.map((o,n)=><article key={n}><h4>{o.title}</h4><p>{o.rationale}</p><p>Audience hypothesis: {o.audienceHypothesis}</p><p>Unknowns: {o.unknowns.join('; ')||'Review is still required'}</p>{o.variants.map((v,j)=><div key={j}><h5>{v.headline}</h5><p>{v.body}</p><p>{v.cta}</p></div>)}<button disabled={dirty||busy||r.draftRevision!==revision} onClick={()=>void run(()=>submit({command:'applyPlanningOption',input:{draftId,expectedRevision:revision,requestKey:crypto.randomUUID(),requestId:r.id,optionIndex:n}}))}>Retain suggestion {n+1} for editing</button></article>)}<button onClick={()=>void run(async()=>{await client.call('reconcilePlanning',{requestId:r.id});await onRefresh();setReason('Original progress checked. No provider retry or reservation release was requested.');})}>Check original outcome</button></article>)}
  </section>;
}

function money(minor:number,currency:string){const format=new Intl.NumberFormat(undefined,{style:'currency',currency});return format.format(minor/10**(format.resolvedOptions().maximumFractionDigits??2));}
