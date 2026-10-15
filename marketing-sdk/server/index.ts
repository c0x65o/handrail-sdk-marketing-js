export * from "./service.js";
export * from "./store.js";
export * from "./ports.js";
export * from "./providers.js";
export * from "./agent.js";
export * from "./generation.js";
export * from "./billing.js";
export * from "../support/vault-crypto.js";
export * from "./budgets.js";
export * from "./reporting.js";
// Explicit no-network boundary for disposable installed-consumer qualification.
// Its receipts remain fixture evidence; it is not a native provider adapter.
export { FixtureProvider } from "./fixtures.js";

export * from "./connections.js";
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
export type { NativeTextPlanning, NativeTextPlanningOptions, TextPlanningAccess, TextPurposePermission } from './text-planning.js';
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

export { existingMetaMaterial, existingMetaTerms, type ExistingMetaMaterialSource } from "./existing-meta-material.js";
export {HistoricalEffectResolutions,readHistoricalEffectResolution,type HistoricalEffectInput,type HistoricalEffectCandidate,type HistoricalEffectResolution,type HistoricalEffectSource} from './historical-effects.js';

export * from "./meta-image.js";
