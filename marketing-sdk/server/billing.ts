import { readFileSync } from "node:fs";
import type { GenerationGrant, GenerationJob } from "../core/index.js";
import { Store, requireThat } from "./store.js";
import type { BillingPort } from "./ports.js";

/** Mounted existing grant/billing integration, never ad authorization. The host
 * records a conservative quoted reservation BEFORE a paid submission. Unknown
 * outcomes retain that reservation. No inferred pricing or automatic refund.
 * An embedding host may replace this with its existing spending authority.
 */
export interface GenerationBinding {
  projectId: string;
  grantId: string;
  provider: "openai" | "xai";
  model: string;
  capabilityRef: string;
  apiKey: string;
  expiresAt: string;
  currency: string;
  maxUnitMinor: number;
  quoteReceipt: string;
}
export class BoundGenerationBilling implements BillingPort {
  constructor(
    readonly store: Store,
    readonly path: string | undefined,
  ) {}
  private binding(g: GenerationGrant): GenerationBinding {
    requireThat(this.path, "generation_billing_binding_missing");
    const bindings = JSON.parse(
      readFileSync(this.path, "utf8"),
    ) as GenerationBinding[];
    const matches = bindings.filter(
      (b) =>
        b.projectId === g.projectId &&
        b.grantId === g.id &&
        b.provider === g.provider &&
        b.model === g.model &&
        b.capabilityRef === g.billingCapabilityRef,
    );
    requireThat(matches.length === 1, "generation_billing_binding_mismatch");
    const b = matches[0]!;
    requireThat(
      Date.parse(b.expiresAt) > Date.now() &&
        b.quoteReceipt &&
        Number.isSafeInteger(b.maxUnitMinor) &&
        b.maxUnitMinor > 0 &&
        b.currency === g.ceiling.currency,
      "generation_cost_quote_unavailable",
    );
    return b;
  }
  async credentials(
    provider: "openai" | "xai",
    project: string,
    grantId?: string,
  ) {
    const grants = (
      await this.store.list<GenerationGrant>(project, "generationGrant")
    ).filter((g) => g.provider === provider && (!grantId || g.id === grantId));
    requireThat(grants.length === 1, "generation_credential_binding_ambiguous");
    return this.binding(grants[0]!).apiKey;
  }
  async authorize(g: GenerationGrant, job: GenerationJob) {
    const b = this.binding(g);
    await this.store.transaction(async () => {
      const current = await this.store.get<GenerationGrant>(
        g.projectId,
        "generationGrant",
        g.id,
      );
      requireThat(
        !current.revokedAt && Date.parse(current.expiresAt) > Date.now(),
        "generation_grant_unavailable",
      );
      const reservations = (
        await this.store.list<{
          jobId: string;
          grantId: string;
          minor: number;
        }>(g.projectId, "generationCostReservation")
      ).filter((r) => r.grantId === g.id);
      requireThat(
        !reservations.some((r) => r.jobId === job.id),
        "paid_submission_already_reserved",
      );
      requireThat(
        reservations.reduce((n, r) => n + r.minor, 0) + b.maxUnitMinor <=
          current.ceiling.minor,
        "generation_ceiling_exceeded",
      );
      await this.store.put(g.projectId, "generationCostReservation", job.id, {
        jobId: job.id,
        grantId: g.id,
        minor: b.maxUnitMinor,
        currency: b.currency,
        quoteReceipt: b.quoteReceipt,
      });
    });
  }
}
