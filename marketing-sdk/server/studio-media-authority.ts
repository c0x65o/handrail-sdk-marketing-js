import type {DraftGenerationJob} from '../core/index.js';
import {Store,digest,requireThat,type Principal} from './store.js';
import {sessionBinding,type SessionInspection} from './session-authority.js';

/** The admission remains immutable. A host-authorized continuation retains its
 * dispatch identity separately; it cannot create a grant or reset an attempt. */
export interface DraftMediaDispatchAuthority {
  jobId:string; materialDigest:string; originalActorDigest:string; originalSessionDigest:string;
  actor:Principal; inspection:SessionInspection;
}
export function draftMediaMaterialDigest(job:DraftGenerationJob) {
  return digest({...job,state:'queued',providerRequestId:null,assetId:null,reason:null});
}
export async function readDraftMediaAuthority(store:Store,project:string,job:DraftGenerationJob) {
  const original=await store.get<Principal>(project,'draftJobActor',job.id);
  const {inspection:admitted}=await store.get<{inspection:SessionInspection}>(project,'draftJobSession',job.id);
  requireThat(job.projectId===project&&digest(sessionBinding(original))===job.sessionDigest&&
    digest(admitted.binding)===job.sessionDigest,'generation_actor_changed');
  const row=await store.db.prepare("SELECT id FROM records WHERE project_id=? AND kind='draftMediaDispatchAuthority' AND id=?").get(project,job.id);
  if(!row)return {actor:original,inspection:admitted,original,admitted,continuation:null};
  const continuation=await store.get<DraftMediaDispatchAuthority>(project,'draftMediaDispatchAuthority',job.id);
  requireThat(continuation.jobId===job.id&&continuation.materialDigest===draftMediaMaterialDigest(job)&&
    continuation.originalActorDigest===digest(original)&&continuation.originalSessionDigest===digest(admitted)&&
    continuation.actor.userId===original.userId&&digest(continuation.actor.externalIdentity??null)===digest(original.externalIdentity??null)&&
    digest(sessionBinding(continuation.actor))===digest(continuation.inspection.binding)&&continuation.inspection.projectId===project,
    'generation_continuation_changed');
  return {actor:continuation.actor,inspection:continuation.inspection,original,admitted,continuation};
}
