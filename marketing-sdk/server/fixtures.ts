/** Explicit deterministic external-service fixtures. They share the production
 * SQL store/transactions but never call an ad network or generation provider. */
import { readFileSync } from "node:fs";
import type {
  Asset,
  Campaign,
  GenerationGrant,
  GenerationJob,
  Grant,
  Permission,
  Receipt,
} from "../core/index.js";
import type { AgentPort, GenerationPort, ProviderPort } from "./ports.js";
import { providerPlan } from "./providers.js";
import { Store, digest, requireThat } from "./store.js";
export class FixtureProvider implements ProviderPort {
  readonly evidence = "fixture" as const;
  loseNextResponse = false;
  constructor(readonly store: Store) {}
  async verify(g: Grant) {
    return {
      accountId: g.accountId,
      currency: g.currency,
      timezone: g.timezone,
      permissions: [
        "setup",
        "prepare",
        "activate",
        "pause",
        "report",
      ] as Permission[],
    };
  }
  plan(c: Campaign, g: Grant, a: Asset[]) {
    return providerPlan(c, g, a);
  }
  async prepare(
    c: Campaign,
    g: Grant,
    a: Asset[],
    key: string,
    retain: (ids: Record<string, string>) => void | Promise<void>,
    beforeWrite: () => void | Promise<void>,
  ) {
    if (g.provider !== "google") requireThat(c.material.settings, "explicit_provider_settings_required", 422);
    const plan = this.plan(c, g, a);
    await beforeWrite();
    const receipt: Receipt = {
      ids: {
        campaign: `fixture-${key}`,
      },
      payloadDigest: digest(plan),
      intent: "paused",
      delivery: "unverified",
      providerRequestId: `fixture-${key}`,
      observedAt: new Date().toISOString(),
      evidence: "fixture",
    };
    await this.store.put(c.projectId, "fixtureEffect", c.id, receipt);
    await retain(receipt.ids);
    if (this.loseNextResponse) {
      this.loseNextResponse = false;
      throw new Error("fixture_lost_response");
    }
    return receipt;
  }
  async activate(
    c: Campaign,
    _g: Grant,
    beforeWrite: () => void | Promise<void>,
  ) {
    await beforeWrite();
    return await this.change(c, "enabled");
  }
  async pause(c: Campaign, _g: Grant, beforeWrite: () => void | Promise<void>) {
    await beforeWrite();
    return await this.change(c, "paused");
  }
  private async change(c: Campaign, intent: Receipt["intent"]) {
    const old = await this.store.get<Receipt>(
      c.projectId,
      "fixtureEffect",
      c.id,
    );
    const next = {
      ...old,
      intent,
      observedAt: new Date().toISOString(),
    };
    await this.store.put(c.projectId, "fixtureEffect", c.id, next);
    if (this.loseNextResponse) {
      this.loseNextResponse = false;
      throw new Error("fixture_lost_response");
    }
    return next;
  }
  async reconcile(
    c: Campaign,
    _g: Grant,
    o: {
      payloadDigest: string;
      kind: string;
    },
  ) {
    let r;
    try {
      r = await this.store.get<Receipt>(c.projectId, "fixtureEffect", c.id);
    } catch {
      return null;
    }
    return r.payloadDigest === o.payloadDigest &&
      r.intent === (o.kind === "activate" ? "enabled" : "paused")
      ? r
      : null;
  }
  async metrics(_c: Campaign, g: Grant, from: string, until: string) {
    return {
      from,
      until,
      timezone: g.timezone,
      currency: g.currency,
      observedAt: new Date().toISOString(),
      source: "fixture" as const,
      spendMinor: 1200,
      impressions: 1000,
      clicks: 40,
      providerConversions: 2,
    };
  }
}
export class FixtureGeneration implements GenerationPort {
  readonly evidence = "fixture" as const;
  fault: "none" | "unknown" | "failed" | "processing" = "none";
  validate(g: GenerationGrant) {
    requireThat(g.provider === "fixture", "fixture_generation_only");
  }
  async submit(
    job: GenerationJob,
    _g: GenerationGrant,
    retain: (r: string) => void | Promise<void>,
    beforeWrite: () => Promise<void> = async () => {},
  ) {
    if (this.fault === "unknown") throw new Error("fixture_lost_response");
    await beforeWrite();
    await retain(`fixture-${job.id}`);
    if (this.fault === "failed" || this.fault === "processing")
      return {
        state: this.fault,
        requestId: `fixture-${job.id}`,
      };
    return this.output(job);
  }
  private output(job: GenerationJob) {
    const video = job.kind === "video";
    return {
      state: "retained" as const,
      requestId: `fixture-${job.id}`,
      bytes: readFileSync(
        new URL(
          `../../marketing-sdk/tests/fixtures/test-pattern.${video ? "mp4" : "png"}`,
          import.meta.url,
        ),
      ),
      mime: video ? "video/mp4" : "image/png",
      width: 320,
      height: 180,
      ...(video
        ? {
            seconds: 1,
          }
        : {}),
    };
  }
  async reconcile(job: GenerationJob, _g: GenerationGrant) {
    return job.providerRequestId
      ? this.output(job)
      : {
          state: "unknown" as const,
          requestId: null,
        };
  }
}
export class FixtureAgent implements AgentPort {
  constructor(readonly store: Store) {}
  async inspect(s: Parameters<AgentPort["inspect"]>[0], g: Grant) {
    const completed = (
      await this.store.list<{
        setupId: string;
      }>(g.projectId, "fixtureTakeover")
    ).some((x) => x.setupId === s.id);
    return completed
      ? {
          state: "ready" as const,
          reason: null,
          handoffUrl: null,
        }
      : {
          state: "waiting_human" as const,
          reason: "fixture_human_takeover",
          handoffUrl: `/fixture-takeover/${g.projectId}/${s.id}`,
        };
  }
}
