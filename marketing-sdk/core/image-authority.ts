import type {ImageGenerationQuality} from './index.js';
/** Optional native host authority. It supplies policy/custody/catalog facts and
 * real human decisions; the SDK remains the sole media job/reservation owner. */
export interface ImageGenerationSettings { model:string;quality:ImageGenerationQuality;size:string;prompt:string }
export interface ImageGenerationEstimate { currency:'USD';estimatedUsd:string;estimatedMinor:number;source:string;providerOverhead:string }
export interface ImageGenerationReviewInput extends ImageGenerationSettings { draftId:string;expectedRevision:number;rightsReceipt:string;reservationMinor:number;expiresAt:string;requestKey:string }
export interface ImageGenerationReview { id:string;digest:string;input:ImageGenerationReviewInput;cost:ImageGenerationEstimate;permission:'review_required'|'native_policy_blocks_generation' }
export interface ImageGenerationApproval { id:string;digest:string;reviewId:string;quote:{receipt:string;expiresAt:string;currency:string;maxUnitMinor:number} }
export interface ImageGenerationAuthorityClient {
  configuration():Promise<{models:{id:string;label:string;qualities:ImageGenerationQuality[];sizes:string[]}[];permission:'review_required'|'native_policy_blocks_generation';credentialAvailable:boolean}>;
  estimate(input:ImageGenerationSettings&{draftId:string;expectedRevision:number}):Promise<ImageGenerationEstimate>;
  review(input:ImageGenerationReviewInput):Promise<ImageGenerationReview>;
  approve(input:{reviewId:string;reviewDigest:string;decision:'approve_exact_generation';requestKey:string}):Promise<ImageGenerationApproval>;
  revoke(input:{grantId:string;approvalDigest:string;requestKey:string}):Promise<{revokedAt:string}>;
  request(input:{command:'review';requestKey:string}):Promise<{found:false}|{found:true;result:ImageGenerationReview}>;
  request(input:{command:'approve';requestKey:string}):Promise<{found:false}|{found:true;result:ImageGenerationApproval}>;
  request(input:{command:'revoke';requestKey:string}):Promise<{found:false}|{found:true;result:{revokedAt:string}}>;
}
