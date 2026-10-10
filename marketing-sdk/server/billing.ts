import { readFileSync } from "node:fs";
import type { GenerationGrant, GenerationJob } from "../core/index.js";
import { Store, requireThat } from "./store.js";
import type { BillingPort } from "./ports.js";
import type { TextPlanningQuote, TextPlanningSettlement, PlanningRequest } from '../core/index.js';
import { digest } from './store.js';

/** Existing billing owner. quote/measure may resolve externally, outside locks.
 * inspect/admit/settle are bounded LOCAL operations in the caller's Store
 * transaction and must participate in its rollback. No telemetry-only admission.
 * An external ledger needs its own qualified atomic composition; do not emulate
 * it with this port or perform network I/O while holding these guards. */
export interface TextPlanningBilling {
  quote(input: { operationId: string; projectId: string; environment: string; provider: 'openai'|'xai'; model: string; connectionDigest: string; requestDigest: string; body: unknown; maxOutputTokens: number }, signal: AbortSignal): Promise<TextPlanningQuote>;
  inspect(quote: TextPlanningQuote): Promise<void>;
  admit(store: Store, request: PlanningRequest, quote: TextPlanningQuote): Promise<void>;
  measure(request: PlanningRequest, quote: TextPlanningQuote, signal: AbortSignal): Promise<TextPlanningSettlement | null>;
  settle(store: Store, fact: TextPlanningSettlement): Promise<void>;
}

/** Uses the existing planning reservation record, never a parallel balance ledger. */
export class BoundTextPlanningBilling {
  constructor(readonly store: Store, readonly host: TextPlanningBilling) {}
  async reserve(request: PlanningRequest, quote: TextPlanningQuote) {
    return this.store.transaction(() => this.reserveLocal(request, quote));
  }
  private async reserveLocal(request: PlanningRequest, quote: TextPlanningQuote) {
    requireThat(quote.operationId===request.id,'planning_quote_operation_mismatch');
    const project = request.projectId;
    const all = await this.store.list<{ requestId: string; quote: TextPlanningQuote }>(project, 'planningReservation');
    const old = all.find(x => x.requestId === request.id);
    if (old) { requireThat(digest(old.quote) === digest(quote), 'planning_reservation_conflict'); return; }
    requireThat(!all.some(x => x.quote?.receipt === quote.receipt), 'planning_quote_already_reserved');
    await this.host.inspect(quote);
    await this.host.admit(this.store, request, quote);
    await this.store.put(project, 'planningReservation', request.id, { requestId: request.id, quote, state: 'reserved', settlement: null });
  }
  async settle(request: PlanningRequest, quote: TextPlanningQuote, fact: TextPlanningSettlement | null) {
    return this.store.transaction(() => this.settleLocal(request, quote, fact));
  }
  private async settleLocal(request: PlanningRequest, quote: TextPlanningQuote, fact: TextPlanningSettlement | null) {
    const record = await this.store.get<{ requestId: string; quote: TextPlanningQuote; state: string; settlement: TextPlanningSettlement | null }>(request.projectId, 'planningReservation', request.id);
    requireThat(digest(record.quote) === digest(quote), 'planning_reservation_conflict');
    if (!fact) {
      if (!record.settlement) { record.state = 'unknown'; await this.store.put(request.projectId, 'planningReservation', request.id, record); }
      return record.settlement;
    }
    requireThat(fact.requestId === request.id && fact.attemptId === request.textReceipt?.attemptId &&
      fact.requestDigest === quote.requestDigest && fact.quoteReceipt === quote.receipt &&
      fact.connectionDigest === quote.connectionDigest && fact.projectId === request.projectId &&
      fact.environment === quote.environment && fact.pricingRevision === quote.pricingRevision &&
      fact.currency === quote.currency && Number.isSafeInteger(fact.measuredMinor) && fact.measuredMinor >= 0 &&
      fact.measuredMinor <= quote.ceilingMinor && typeof fact.receipt === 'string' && fact.receipt.length > 0 && fact.receipt.length <= 500 &&
      fact.usage.inputTokens !== null && fact.usage.outputTokens !== null && digest(fact.usage) === digest(request.usage), 'planning_settlement_mismatch');
    if (record.settlement) { requireThat(digest(record.settlement) === digest(fact), 'planning_settlement_conflict'); return record.settlement; }
    await this.host.settle(this.store, fact);
    record.state = 'settled'; record.settlement = fact;
    await this.store.put(request.projectId, 'planningReservation', request.id, record);
    return fact;
  }
}

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
  /** Legacy mounted credential. Omit when using CreativeConnections.credentials. */
  apiKey?: string;
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
  /** Exact metadata for v2 draft jobs; reading never reserves funds. */
  async quote(g: GenerationGrant) {
    const b = this.binding(g);
    return { receipt: b.quoteReceipt, expiresAt: b.expiresAt, currency: b.currency, maxUnitMinor: b.maxUnitMinor };
  }
  /** The Studio controller has already retained this exact reservation atomically.
   * Revalidating it is not a second submission or a new reservation. */
  async authorizeDraft(g: GenerationGrant, job: import("../core/index.js").DraftGenerationJob) {
    const quote = await this.quote(g);
    await this.store.transaction(async () => {
      const current = await this.store.get<GenerationGrant>(g.projectId, "generationGrant", g.id);
      requireThat(!current.revokedAt && Date.parse(current.expiresAt) > Date.now(), "generation_grant_unavailable");
      const reservation = await this.store.get<{jobId:string;grantId:string;minor:number;currency:string;quoteReceipt:string}>(g.projectId, "generationCostReservation", job.id);
      requireThat(reservation.jobId === job.id && reservation.grantId === g.id && reservation.quoteReceipt === quote.receipt && reservation.minor === quote.maxUnitMinor && reservation.currency === quote.currency && job.quote.receipt === quote.receipt && job.quote.expiresAt === quote.expiresAt, "generation_cost_quote_changed");
      const all = await this.store.list<{grantId:string;minor:number}>(g.projectId,"generationCostReservation");
      requireThat(all.filter(r => r.grantId === g.id).reduce((n,r) => n+r.minor,0) <= current.ceiling.minor, "generation_ceiling_exceeded");
    });
  }
  async inspect(g: GenerationGrant) {
    try {
      const b = this.binding(g);
      if (g.revokedAt || Date.parse(g.expiresAt) <= Date.now()) return { state: "unavailable" as const };
      return { state: "configured" as const, currency: b.currency, maxUnitMinor: b.maxUnitMinor, expiresAt: b.expiresAt };
    } catch { return { state: "unavailable" as const }; }
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
    const key = this.binding(grants[0]!).apiKey;
    requireThat(typeof key === "string" && key.length > 0, "generation_credential_binding_missing");
    return key;
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
