import type {Campaign, Grant, Operation, Receipt} from '../core/index.js';
import {Store,digest,requireThat} from './store.js';

/** Original uncertain launch retained verbatim; a later verified stop does not
 * establish whether that launch delivered or what it spent. */
export interface ActivationStopIntent {
  id:string; projectId:string; campaignId:string; activationOperation:Operation;
  activationDigest:string; campaignDigest:string; requestedAt:string;
  precedingStops:Operation[]; leaseOwnerId:string;
}
export interface ActivationStopReceipt {
  id:string; projectId:string; campaignId:string; activationOperationId:string;
  pauseOperationId:string; precedingStopIds:string[]; originalOutcome:'unknown'; originalActivationDigest:string;
  pauseReceipt:Receipt; observedAt:string;
}
const campaignDigest=(c:Campaign)=>digest({id:c.id,projectId:c.projectId,revision:c.revision,
  grantId:c.grantId,material:c.material,preparedMaterial:c.preparedMaterial,receipt:c.receipt});
const pending=(o:Operation)=>['queued','running','unknown'].includes(o.state);

export class ActivationStops {
  constructor(readonly store:Store){}
  async original(c:Campaign,g:Grant,operationId:string) {
    const original=await this.store.get<Operation>(c.projectId,'operation',operationId);
    requireThat(original.kind==='activate'&&original.state==='unknown'&&original.projectId===c.projectId&&
      original.campaignId===c.id&&original.campaignRevision===c.revision&&original.accountId===g.accountId&&
      original.grantRevision<=g.revision&&c.receipt?.payloadDigest===original.payloadDigest,
    'uncertain_activation_stop_scope');
    const lease=await this.store.db.prepare('SELECT operation_id FROM leases WHERE project_id=? AND account_id=?').get(c.projectId,g.accountId);
    const operations=await this.store.list<Operation>(c.projectId,'operation');
    const leaf=operations.find(o=>o.id===lease?.operation_id);
    const precedingStops:Operation[]=[];
    if(leaf?.id!==original.id){
      requireThat(leaf?.kind==='pause'&&leaf.state==='unknown'&&leaf.stopsActivationId===original.id,
        'uncertain_activation_lease_changed');
      for(const id of [...(leaf!.precedingStopIds??[]),leaf!.id]){
        const stop=operations.find(o=>o.id===id);
        requireThat(stop?.kind==='pause'&&stop.state==='unknown'&&stop.stopsActivationId===original.id&&
          stop.campaignId===c.id&&stop.campaignRevision===c.revision&&stop.accountId===g.accountId,
        'uncertain_activation_stop_scope');
        await this.assertIntent(c,stop!);precedingStops.push(stop!);
      }
    }
    requireThat(lease&&leaf&&(leaf.id===original.id||precedingStops.length>0),'uncertain_activation_lease_changed');
    requireThat(new Set(precedingStops.map(o=>o.id)).size===precedingStops.length,'activation_stop_intent_changed');
    return {original,precedingStops,leaseOwnerId:String(lease!.operation_id)};
  }
  async retain(c:Campaign,stop:Operation,source:{original:Operation;precedingStops:Operation[];leaseOwnerId:string}) {
    const {original,precedingStops,leaseOwnerId}=source;
    const intent:ActivationStopIntent={id:stop.id,projectId:c.projectId,campaignId:c.id,
      activationOperation:structuredClone(original),activationDigest:digest(original),
      campaignDigest:campaignDigest(c),requestedAt:stop.createdAt,precedingStops:structuredClone(precedingStops),leaseOwnerId};
    requireThat(!(await this.store.list<ActivationStopIntent>(c.projectId,'activationStopIntent')).some(r=>r.id===stop.id),
      'activation_stop_intent_exists');
    await this.store.put(c.projectId,'activationStopIntent',stop.id,intent);
    await this.store.append(c.projectId,stop.id,'execution.activation_stop_requested',{
      activationOperationId:original.id,pauseOperationId:stop.id,precedingStopIds:intent.precedingStops.map(o=>o.id),originalOutcome:'unknown',activationDigest:intent.activationDigest});
  }
  async assertIntent(c:Campaign,stop:Operation) {
    const intent=await this.store.get<ActivationStopIntent>(c.projectId,'activationStopIntent',stop.id);
    const original=await this.store.get<Operation>(c.projectId,'operation',stop.stopsActivationId!);
    requireThat(stop.kind==='pause'&&stop.projectId===c.projectId&&stop.campaignId===c.id&&
      intent.projectId===c.projectId&&intent.campaignId===c.id&&intent.id===stop.id&&
      intent.activationOperation.id===stop.stopsActivationId&&original.kind==='activate'&&original.state==='unknown'&&
      digest(original)===intent.activationDigest&&digest(intent.activationOperation)===intent.activationDigest&&
      campaignDigest(c)===intent.campaignDigest&&stop.payloadDigest===original.payloadDigest&&
      stop.accountId===original.accountId&&stop.campaignRevision===original.campaignRevision,
    'activation_stop_intent_changed');
    requireThat(digest(stop.precedingStopIds??[])===digest(intent.precedingStops.map(o=>o.id)), 'activation_stop_intent_changed');
    for(const prior of intent.precedingStops){
      requireThat(prior.kind==='pause'&&prior.state==='unknown'&&prior.stopsActivationId===original.id&&
        digest(await this.store.get(c.projectId,'operation',prior.id))===digest(prior),'activation_stop_intent_changed');
    }
    requireThat(intent.leaseOwnerId===(intent.precedingStops.at(-1)?.id??original.id),'activation_stop_intent_changed');
    return {intent,original};
  }
  async assertOriginalReadable(project:string,original:Operation) {
    const operations=await this.store.list<Operation>(project,'operation');
    requireThat(!operations.some(o=>pending(o)&&(o.stopsActivationId===original.id||
      o.precedingStopIds?.includes(original.id))), 'activation_stop_pending');
  }
  /** Called in the verified pause's final transaction, with its lease held. */
  async finish(c:Campaign,stop:Operation,pauseReceipt:Receipt) {
    const {intent,original}=await this.assertIntent(c,stop);
    requireThat(pauseReceipt.intent==='paused'&&pauseReceipt.payloadDigest===original.payloadDigest,
      'activation_stop_receipt_mismatch');
    const receipt:ActivationStopReceipt={id:stop.id,projectId:c.projectId,campaignId:c.id,
      activationOperationId:original.id,pauseOperationId:stop.id,precedingStopIds:intent.precedingStops.map(o=>o.id),originalOutcome:'unknown',
      originalActivationDigest:intent.activationDigest,pauseReceipt,observedAt:pauseReceipt.observedAt};
    await this.store.put(c.projectId,'activationStopReceipt',stop.id,receipt);
    for(const prior of intent.precedingStops)await this.store.put(c.projectId,'operation',prior.id,{...prior,state:'stopped',
      reason:'pause_replaced_original_outcome_unknown',stoppedByOperationId:stop.id});
    await this.store.put(c.projectId,'operation',original.id,{...original,state:'stopped',
      reason:'activation_stopped_original_outcome_unknown',stoppedByOperationId:stop.id});
    await this.store.append(c.projectId,original.id,'execution.uncertain_activation_stopped',receipt);
  }
}
