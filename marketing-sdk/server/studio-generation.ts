import type { DraftGenerationJob, GenerationGrant } from '../core/index.js';
import type { GenerationOutput, BillingPort } from './ports.js';
import { NativeGeneration } from './generation.js';
/** Additive v2 contract. No dummy campaignId, no widening of legacy ports. */
export interface DraftGenerationPort {
  version: 2; evidence: 'fixture'|'generated';
  validate(grant:GenerationGrant):void;
  /** Harmless exact quote inspection; never reserves or submits. */
  quote(grant:GenerationGrant):Promise<DraftGenerationJob['quote']>;
  submit(job:DraftGenerationJob,grant:GenerationGrant,retain:(id:string)=>Promise<void>,beforeWrite:()=>Promise<void>):Promise<GenerationOutput>;
  reconcile(job:DraftGenerationJob,grant:GenerationGrant):Promise<GenerationOutput>;
}
export interface DraftGenerationBilling extends Omit<BillingPort,'authorize'> {
  authorize(grant:GenerationGrant,job:DraftGenerationJob):Promise<void>;
  quote(grant:GenerationGrant):Promise<DraftGenerationJob['quote']>;
}
/** Reuses the qualified image/video byte transport with explicitly v2 billing.
 * Hosts must bind their existing original-session custody and exact cost authority.
 * This factory supplies no grant, background identity, credential or scheduler. */
export function createNativeDraftGeneration(credentials:(provider:'openai'|'xai',project:string,grantId:string)=>Promise<string>,billing:DraftGenerationBilling,fetcher:typeof fetch=fetch,beforeCredentialUse?:(provider:'openai'|'xai',project:string,grantId:string)=>Promise<void>):DraftGenerationPort {
  const native=new NativeGeneration<DraftGenerationJob>(credentials,billing,fetcher,beforeCredentialUse);
  return {version:2,evidence:'generated',validate:g=>native.validate(g),quote:g=>billing.quote(g),submit:(j,g,r,b)=>native.submit(j,g,r,b),reconcile:(j,g)=>native.reconcile(j,g)};
}
