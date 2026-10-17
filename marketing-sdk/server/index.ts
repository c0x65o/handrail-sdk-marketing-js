export * from "./service.js";
export * from "./store.js";
export * from "./ports.js";
export * from "./providers.js";
export * from "./agent.js";
export * from "./generation.js";
export * from "./generation-usage.js";
export * from "./billing.js";
export * from "../support/vault-crypto.js";
export * from "./budgets.js";
export * from "./reporting.js";
// Explicit no-network boundary for disposable installed-consumer qualification.
// Its receipts remain fixture evidence; it is not a native provider adapter.
export { FixtureProvider } from "./fixtures.js";

export * from "./connections.js";
export * from "./campaign-access.js";
export * from "./session-authority.js";
export { classifyConnectionRoute, type PrivateMutationHeaders } from "./handoff-http.js";

export * from "./credential-custody.js";
export * from "./meta-token-inspection.js";
export * from "./creative-connections.js";

export * from "./studio.js";
export * from "./planning.js";

export * from "./studio-http.js";

export * from "./studio-generation.js";

export * from "./tracking.js";

export { createNativeTextPlanning, createSyntheticTextPlanning, createTextPlanningAccess } from './text-planning.js';
export type { NativeTextPlanning, NativeTextPlanningOptions, TextPlanningAccess, TextPurposePermission, TextPlanningCustody } from './text-planning.js';
export * from "./measurement.js";
export * from "./measurement-adoption.js";
export * from "./execution-authority.js";
export * from "./measurement-collectors.js";
export * from "./adoption.js";
export * from "./execution-adoption.js";
export * from "./historical-purpose.js";
export type { ExistingLinkedInMaterialSource } from "./existing-linkedin-material.js";

// Native adoption binds a real public destination snapshot, never a URL hash.
export { capturePublicDestination } from "./destination.js";
export { destinationSnapshot, destinationContentDigest, retainDestinationSnapshot, type DestinationSnapshot, type DestinationRedirect } from './destination.js';

export { existingMetaMaterial, existingMetaTerms, reconcileExistingMetaMaterial, type ExistingMetaMaterialSource, type ReconciledMetaMaterialSource, type RetainedMetaImageCandidate } from "./existing-meta-material.js";
export {META_OBSERVATION_KEYS,metaMaterialObservations,type RetainedMetaObservation,type MetaMaterialReconciliation} from './meta-material-observations.js';
export {HistoricalEffectResolutions,readHistoricalEffectResolution,type HistoricalEffectInput,type HistoricalEffectCandidate,type HistoricalEffectResolution,type HistoricalEffectSource} from './historical-effects.js';

export * from "./meta-image.js";
export {inspectMetaDeliveryInventory,type MetaDeliveryTarget,type MetaDeliveryObject,type MetaUnmappedDeliveryCampaign} from './delivery-inventory.js';

export * from "./campaign-execution-connection.js";

export * from "./grant-authority.js";

export {readHostActivationApproval, type RetainedHostActivationApproval} from "./activation-approval.js";

export {advertisingBudgetPeriod, recurringExposureBound, type RecurringBudgetExposure} from "./recurring-budgets.js";
export * from './budget-observation.js';

export type {ActivationStopIntent,ActivationStopReceipt} from './activation-stops.js';
export type {ActivationCancellationReceipt} from './activation-cancellation.js';

// Shared provider transport and private lifecycle coverage for native bindings.
export {MetaMarketingClient,MetaMarketingError,META_AD_FIELDS,META_INSIGHT_FIELDS,redactProviderMessage,metaMarketingSafety} from '../support/owner-marketing/meta-client.js';
export {recordMarketingCredentials,withMarketingCredentialCoverage,projectMarketingCredentialEvidence} from '../support/owner-marketing/evidence-credentials.js';

export {LinkedInMarketingClient,LinkedInMarketingError,linkedInObjectName,linkedInFailureEvidence,linkedInCommentaryText,linkedInCommentaryPlainText,linkedInMarketingSafety} from '../support/owner-marketing/linkedin-client.js';

export {createCampaignImageGenerator,CampaignImageError} from '../support/owner-marketing/campaign-images.js';
export type {CampaignImagePorts,CampaignImageInput,CampaignImage,CampaignImageSpec,CampaignImageContract} from './campaign-images-types.js';
