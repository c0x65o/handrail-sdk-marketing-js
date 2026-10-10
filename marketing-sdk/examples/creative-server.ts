import {
  CreativeConnections, EncryptedCredentialCustody, NativeGeneration,
  createNativeDraftGeneration, type DraftGenerationBilling,
  type BillingPort, type CreativeConnectionsOptions,
} from "@handrail/marketing/server";
import { mountMarketingConnections } from "./connections-server.js";

/** Public host composition only; no provider form, grant creation or scheduler.
 * Existing ingress must omit secure-entry request bodies from logs and traces. */
export function mountManualCreativeConnections(config:
  Omit<Parameters<typeof mountMarketingConnections>[0], "generation" | "creative"> & {
    billing: BillingPort; creativeEnvironment: string;
    /** Existing exact v2 reservation billing; omission leaves Studio generation unavailable. */
    draftBilling?: DraftGenerationBilling;
    creativePolicy: CreativeConnectionsOptions["accessPolicy"];
  }) {
  const creative = new CreativeConnections({ store: config.store, environment: config.creativeEnvironment,
    custody: new EncryptedCredentialCustody(config.store, config.custody.cipher),
    sessionAuthority: config.sessionAuthority, accessPolicy: config.creativePolicy, billing: config.billing });
  const generation = new NativeGeneration((provider, project, grantId) =>
    creative.credentials(provider, project, grantId), config.billing, undefined,
    (provider, project, grantId) => creative.assertCredentialAccess(provider, project, grantId));
  const draftGeneration = config.draftBilling && createNativeDraftGeneration(
    (provider, project, grantId) => creative.credentials(provider, project, grantId), config.draftBilling,
    undefined, (provider, project, grantId) => creative.assertCredentialAccess(provider, project, grantId));
  return { ...mountMarketingConnections({ ...config, creative, generation,
    studio: { ...config.studio, ...(draftGeneration ? { generation: draftGeneration } : {}) } }), creative };
}
