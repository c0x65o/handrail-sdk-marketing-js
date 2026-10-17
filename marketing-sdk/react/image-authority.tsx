import {useEffect,useRef,useState} from 'react';
import {MarketingRequestError,type ImageGenerationAuthorityClient,type ImageGenerationReview,type ImageGenerationApproval,type ImageGenerationReviewInput,type ImageGenerationEstimate,type ImageGenerationSettings,type Commands,type DraftGenerationJob} from '../core/index.js';
type Pending={command:'review';input:ImageGenerationReviewInput}|{command:'approve';input:Parameters<ImageGenerationAuthorityClient['approve']>[0]}|{command:'revoke';input:Parameters<ImageGenerationAuthorityClient['revoke']>[0]};
type Form=ImageGenerationSettings&{rightsReceipt:string;reservation:string;expires:string};
type Saved={recoveryError?:boolean;form:Form;review?:ImageGenerationReview;approval?:ImageGenerationApproval;pending?:Pending;generationKey?:string;submitted?:boolean;revoked?:boolean};
const fresh=():Saved=>({form:{model:'',quality:'medium',size:'1024x1024',prompt:'',rightsReceipt:'',reservation:'',expires:''}});
const usd=(minor:number)=>new Intl.NumberFormat(undefined,{style:'currency',currency:'USD'}).format(minor/100);
/** Native decisions are never synthesized by the SDK. Original intent is saved
 * before each request; receipt reads cannot submit a paid image automatically. */
export function ImageAuthorityPanel({authority,draftId,revision,storage,disabled,jobs,run,onGenerate}:{authority:ImageGenerationAuthorityClient;draftId:string;revision:number;storage:string;disabled:boolean;jobs:DraftGenerationJob[];run:(work:()=>Promise<void>)=>Promise<void>;onGenerate:(input:Commands['generateDraftMedia']['input'])=>Promise<void>}){
  const key=`${storage}:image-authority:${draftId}`;
  const [saved,setSaved]=useState<Saved>(()=>{try{const raw=sessionStorage.getItem(key);if(raw){const value=JSON.parse(raw);if(value?.form&&typeof value.form.prompt==='string')return value;throw Error('Unreadable original decision');}}catch{return {...fresh(),recoveryError:true};}return fresh();});
  const [configuration,setConfiguration]=useState<Awaited<ReturnType<ImageGenerationAuthorityClient['configuration']>>|null>(null),[estimate,setEstimate]=useState<ImageGenerationEstimate|null>(null),[message,setMessage]=useState('');
  const current=useRef(saved),active=useRef(true);current.current=saved;
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  function save(next:Saved){try{sessionStorage.setItem(key,JSON.stringify(next));}catch{throw new Error('Browser recovery storage unavailable. No generation decision was sent.');}current.current=next;if(active.current)setSaved(next);}
  function note(value:string){if(active.current)setMessage(value);}
  function edit(patch:Partial<Form>){try{save({...current.current,form:{...current.current.form,...patch}});if(['model','quality','size','prompt'].some(k=>k in patch))setEstimate(null);setMessage('');}catch(error){note((error as Error).message);}}
  const review=saved.review,approval=saved.approval,form=saved.form;
  const job=approval?jobs.find(j=>j.grantId===approval.id):undefined;
  const used=Boolean(saved.submitted||job),finished=Boolean(job&&['retained','failed'].includes(job.state));
  const stale=Boolean(review&&review.input.expectedRevision!==revision);
  const model=configuration?.models.find(m=>m.id===form.model);
  const writable=!disabled&&!saved.pending&&!saved.recoveryError;
  async function accept(pending:Pending,result:ImageGenerationReview|ImageGenerationApproval|{revokedAt:string}){
    const next={...current.current,pending:undefined};
    if(pending.command==='review'){next.review=result as ImageGenerationReview;next.approval=undefined;next.generationKey=undefined;next.submitted=false;next.revoked=false;}
    if(pending.command==='approve')next.approval=result as ImageGenerationApproval;
    if(pending.command==='revoke')next.revoked=true;
    save(next);note(pending.command==='review'?'Review ready. No image has been requested.':pending.command==='approve'?'Approval retained. The image has not been requested by this receipt read.':'Authority revoked. Existing usage and reservations remain retained.');
  }
  async function decide(pending:Pending){
    save({...current.current,pending});note('Saving the exact request…');
    try{
      const result=pending.command==='review'?await authority.review(pending.input):pending.command==='approve'?await authority.approve(pending.input):await authority.revoke(pending.input);
      await accept(pending,result);
    }catch(error){
      if(error instanceof MarketingRequestError&&error.status>=400&&error.status<500&&![408,429].includes(error.status))save({...current.current,pending:undefined});
      note('The request did not complete here. Check the saved outcome before changing it.');throw error;
    }
  }
  async function recover(){
    const pending=current.current.pending;if(!pending)return;
    const result=pending.command==='review'?await authority.request({command:'review',requestKey:pending.input.requestKey}):pending.command==='approve'?await authority.request({command:'approve',requestKey:pending.input.requestKey}):await authority.request({command:'revoke',requestKey:pending.input.requestKey});
    if(result.found)await accept(pending,result.result);else note('No saved receipt was found. You can retry this same original request; no new identity will be created.');
  }
  async function generate(){
    const value=current.current;
    if(!value.review||!value.approval||value.revoked||value.submitted)throw new Error('Current unused approval is required.');
    const generationKey=value.generationKey??crypto.randomUUID();save({...value,generationKey});
    const i=value.review.input;
    await onGenerate({draftId:i.draftId,expectedRevision:i.expectedRevision,grantId:value.approval.id,prompt:i.prompt,rightsReceipt:i.rightsReceipt,quoteReceipt:value.approval.quote.receipt,requestKey:generationKey});
    save({...current.current,submitted:true});note('Original request retained. Review its outcome below.');
  }
  return <section aria-label="Image generation review">
    {saved.recoveryError&&<p role="alert">Saved generation recovery could not be read. Restore that browser record before another decision.</p>}
    <h3>Generate artwork</h3><p>Review the exact image and its cost before one paid attempt. An uncertain outcome keeps its reservation and is never regenerated automatically.</p>
    <button disabled={!writable} onClick={()=>void run(async()=>{const value=await authority.configuration();if(active.current)setConfiguration(value);})}>Check image setup</button>
    {configuration&&!configuration.credentialAvailable&&<p>Image credentials are unavailable. Restore the configured connection before requesting a review.</p>}
    {configuration?.permission==='native_policy_blocks_generation'&&<p role="status">Current project policy does not permit image generation. Estimates and review are available; approval stays blocked.</p>}
    {configuration&&!configuration.models.length&&<p>No supported image prices are configured.</p>}
    {configuration&&<fieldset disabled={!writable||Boolean(review)}><div className="studio-fields">
      <label>Image model<select aria-label="Image model" value={form.model} onChange={e=>edit({model:e.target.value,quality:'medium'})}><option value="">Choose a model</option>{configuration.models.map(m=><option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
      <label>Image quality<select aria-label="Image quality" value={form.quality} onChange={e=>edit({quality:e.target.value as Form['quality']})}>{model?.qualities.map(q=><option key={q} value={q}>{q}</option>)}</select></label>
      <label>Image size<select aria-label="Image size" value={form.size} onChange={e=>edit({size:e.target.value})}>{model?.sizes.map(size=><option key={size} value={size}>{size}</option>)}</select></label>
    </div><label>Artwork prompt<textarea maxLength={6000} value={form.prompt} onChange={e=>edit({prompt:e.target.value})}/></label>
    <label>Generation rights declaration<textarea maxLength={200} value={form.rightsReceipt} onChange={e=>edit({rightsReceipt:e.target.value})}/></label>
    <button disabled={!model||!form.prompt.trim()} onClick={()=>void run(async()=>{const cost=await authority.estimate({draftId,expectedRevision:revision,model:form.model,quality:form.quality,size:form.size,prompt:form.prompt});if(active.current)setEstimate(cost);})}>Estimate image cost</button>
    {estimate&&<p role="status">Estimated cost: USD {estimate.estimatedUsd}. Rounded up: {usd(estimate.estimatedMinor)}. Provider overhead is not observed; the final charge may differ.</p>}
    <div className="studio-fields"><label>Reservation (USD)<input inputMode="decimal" value={form.reservation} onChange={e=>edit({reservation:e.target.value})}/></label><label>Approval expires (local time)<input type="datetime-local" value={form.expires} onChange={e=>edit({expires:e.target.value})}/></label></div>
    <p>The reservation limits admission to this attempt. It is not a provider-enforced charge cap. Missing usage remains unknown.</p>
    <button disabled={!model||!form.prompt.trim()||!form.rightsReceipt.trim()||!form.reservation||!form.expires||!configuration.credentialAvailable} onClick={()=>void run(async()=>{
      const amount=Number(form.reservation),minor=Math.round(amount*100),expiresAt=new Date(form.expires);
      if(!Number.isFinite(amount)||!Number.isSafeInteger(minor)||minor<=0||Math.abs(amount*100-minor)>0.000001||!Number.isFinite(expiresAt.getTime())||expiresAt.getTime()<=Date.now())throw new Error('Enter a positive USD reservation with at most two decimals and a future expiry.');
      await decide({command:'review',input:{draftId,expectedRevision:revision,model:form.model,quality:form.quality,size:form.size,prompt:form.prompt,rightsReceipt:form.rightsReceipt,reservationMinor:minor,expiresAt:expiresAt.toISOString(),requestKey:crypto.randomUUID()}});
    })}>Review exact image request</button></fieldset>}
    {review&&<section className="card" aria-label="Exact image request"><h4>Review this image</h4>
      <p>{review.input.model} · {review.input.quality} · {review.input.size} · saved revision {review.input.expectedRevision}</p><p>{review.input.prompt}</p><p>Rights: {review.input.rightsReceipt}</p>
      <p>Estimate: USD {review.cost.estimatedUsd}. Reservation: {usd(review.input.reservationMinor)}. Expires {new Date(review.input.expiresAt).toLocaleString()}.</p>
      {stale&&<p>This draft changed. This review cannot authorize its new material.</p>}
      {review.permission==='native_policy_blocks_generation'&&<p>Approval blocked by current project policy.</p>}
      {!approval&&<div className="studio-actions"><button disabled={!writable||stale||review.permission!=='review_required'||Date.parse(review.input.expiresAt)<=Date.now()} onClick={()=>void run(async()=>{await decide({command:'approve',input:{reviewId:review.id,reviewDigest:review.digest,decision:'approve_exact_generation',requestKey:crypto.randomUUID()}});await generate();})}>Approve {usd(review.input.reservationMinor)} and generate once</button>
      <button className="secondary" disabled={!writable} onClick={()=>void run(async()=>{save({form:current.current.form});setEstimate(null);note('Review dismissed. No generation authority was created.');})}>Reject / edit review</button></div>}
      {approval&&!saved.revoked&&<div className="studio-actions">{used?<><p>Request submitted. Original progress and reservation are retained below.</p>{finished&&<button disabled={!writable} onClick={()=>void run(async()=>save({form:current.current.form}))}>Review another image</button>}</>:<><button disabled={!writable||stale||Date.parse(approval.quote.expiresAt)<=Date.now()} onClick={()=>void run(generate)}>Generate approved artwork once</button><button className="secondary" disabled={!writable} onClick={()=>void run(()=>decide({command:'revoke',input:{grantId:approval.id,approvalDigest:approval.digest,requestKey:crypto.randomUUID()}}))}>Revoke unused approval</button></>}</div>}
      {saved.revoked&&<><p>Approval revoked.</p><button disabled={!writable} onClick={()=>void run(async()=>save({form:current.current.form}))}>Review another image</button></>}
      <details><summary>Request details</summary><p>Review: <code>{review.id}</code></p><p>Approval: <code>{approval?.id??'Not approved'}</code></p><p>Pricing source: <a href={review.cost.source} target="_blank" rel="noreferrer">Provider image pricing and calculation</a></p></details>
    </section>}
    {saved.pending&&<section role="status"><p>Original {saved.pending.command} outcome needs checking.</p><div className="studio-actions"><button disabled={disabled} onClick={()=>void run(recover)}>Check saved generation decision</button><button disabled={disabled} onClick={()=>void run(()=>decide(current.current.pending!))}>Retry original decision</button></div></section>}
    {message&&<p role="status">{message}</p>}
  </section>;
}
