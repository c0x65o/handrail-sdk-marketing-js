import type {Campaign, Grant, Operation, Packet} from '../core/index.js';
import type {AdvertisingBudgetReservation} from './budgets.js';
import {digest, requireThat, type Principal, type Store} from './store.js';

const actor = (p: Principal) => ({userId:p.userId,hostSessionRef:p.externalSessionRef??null});
/** A local cancellation is not provider pause or proof of current delivery.
 * Original authorization and budget records are retained as history only. */
export interface ActivationCancellationReceipt {
  id:string; projectId:string; campaignId:string; requestKey:string;
  outcome:'not_dispatched'; cancelledAt:string;
  operation:Operation; campaign:Campaign; grant:Grant; packet:Packet;
  originalActor:ReturnType<typeof actor>; actor:ReturnType<typeof actor>;
  originalActorDigest:string;
  reservations:{storageProjectId:string; reservation:AdvertisingBudgetReservation}[];
}

/** Caller holds current host pause authority, executor custody and the SDK
 * transaction, and has excluded an in-process dispatch. No provider I/O. */
export async function cancelUnclaimedActivation(store:Store,c:Campaign,o:Operation,p:Principal,requestKey:string,now:number):Promise<ActivationCancellationReceipt>{
  requireThat(o.kind==='activate'&&o.projectId===c.projectId&&o.campaignId===c.id,'activation_operation_scope_mismatch');
  requireThat(o.state==='queued'&&!o.receipt&&!o.cancelledByReceiptId,'activation_not_queued');
  requireThat(c.state==='paused'&&c.receipt?.intent==='paused'&&c.revision===o.campaignRevision&&
    digest(c.material)===digest(c.preparedMaterial),'queued_activation_changed');
  const g=await store.get<Grant>(c.projectId,'grant',c.grantId);
  // Expiration/revocation must not prevent a currently authorized cancellation.
  // We never renew or consume the old grant or approval.
  requireThat(g.projectId===c.projectId&&g.accountId===o.accountId&&g.revision===o.grantRevision&&
    (!g.campaignId||g.campaignId===c.id),'queued_activation_changed');
  requireThat(o.packetId,'activation_packet_missing');
  const packet=await store.get<Packet>(c.projectId,'packet',o.packetId);
  requireThat(packet.digest===digest({...packet,digest:undefined}),'packet_corrupt');
  requireThat(packet.projectId===c.projectId&&packet.campaignId===c.id&&packet.action==='activate'&&
    packet.campaignRevision===c.revision&&packet.grantId===g.id&&packet.grantRevision===g.revision&&
    packet.accountId===g.accountId&&digest(packet.material)===digest(c.material)&&
    digest(packet.effectivePlan)===o.payloadDigest&&c.receipt.payloadDigest===o.payloadDigest&&
    digest(packet.receipt)===digest(c.receipt),'queued_activation_changed');
  requireThat(!await store.db.prepare('SELECT operation_id FROM leases WHERE project_id=? AND account_id=?').get(c.projectId,g.accountId),
    'account_execution_pending');
  const original=await store.get<Principal>(c.projectId,'executionActor',o.id);
  const rows=await store.db.prepare('SELECT project_id,body FROM records WHERE kind=?').all('advertisingBudgetReservation');
  const reservations=rows.map(row=>({storageProjectId:String(row.project_id),reservation:JSON.parse(String(row.body)) as AdvertisingBudgetReservation}))
    .filter(({reservation:r})=>r.projectId===c.projectId&&r.campaignId===c.id&&r.operationId===o.id);
  requireThat(reservations.every(({reservation:r})=>r.state==='held'),'queued_activation_budget_changed');
  const receipt:ActivationCancellationReceipt={id:o.id,projectId:c.projectId,campaignId:c.id,requestKey,
    outcome:'not_dispatched',cancelledAt:new Date(now).toISOString(),operation:o,campaign:c,grant:g,packet,
    originalActor:actor(original),actor:actor(p),originalActorDigest:digest(original),reservations};
  // Include portfolio storage scopes. Historical records survive even when a
  // later fixed-budget launch reuses its campaign reservation ID.
  for(const {storageProjectId,reservation} of reservations)
    await store.put(storageProjectId,'advertisingBudgetReservation',reservation.id,{...reservation,state:'released'});
  await store.put(c.projectId,'operation',o.id,{...o,state:'blocked',reason:'queued_activation_cancelled_before_dispatch',cancelledByReceiptId:o.id});
  await store.append(c.projectId,o.id,'execution.queued_activation_cancelled',{
    receiptId:receipt.id,actor:receipt.actor,originalActor:receipt.originalActor,outcome:receipt.outcome,
    operationDigest:digest(o),reservationCount:reservations.length});
  return receipt;
}
