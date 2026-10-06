import { selectedOptions } from "../core/index.js";
import { validateAccountCapability, metaTargeting, linkedInTargeting, metaExpansionOff, exactTargeting } from "./capabilities.js";
import type {
  Asset,
  Campaign,
  Grant,
  Metrics,
  Permission,
  Receipt,
} from "../core/index.js";
import type { ProviderPort } from "./ports.js";
import { digest, requireThat, Store, DomainError } from "./store.js";
import { providerDayWindow } from "./reporting.js";
import { material } from "./validation.js";
import { GoogleAdsClient } from "./google.js";
// Existing server-only clients; never imported by core or React.
import { MetaMarketingClient, accountPath } from "../support/owner-marketing/meta-client.js";
import { LinkedInMarketingClient } from "../support/owner-marketing/linkedin-client.js";
export interface Credentials {
  accessToken: string;
  appSecret?: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  loginCustomerId?: string;
}
export interface VaultPort {
  use<T>(
    grant: Grant,
    action: (credentials: Credentials) => Promise<T>,
  ): Promise<T>;
}
const dateInZone = (v: string, timezone: string) => {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(new Date(v));
  return parts.replace(",", "");
};
const perms: Permission[] = ["setup", "prepare", "activate", "pause", "report"];
export function providerPlan(c: Campaign, g: Grant, assets: Asset[]) {
  const m = c.material;
  material(m, g.provider);
  validateAccountCapability(c, g);
  const settings = m.settings;
  requireThat(
    g.currency === m.budget.currency && g.timezone === m.timezone,
    "account_context_mismatch",
  );
  if (g.provider === "google") {
    requireThat(!m.advertisingBudget?.daily, "google_daily_budget_unsupported");
    requireThat(assets.length === 0, "google_search_text_only");
    const prefix = `customers/${g.accountId}`;
    const campaign = `${prefix}/campaigns/-2`,
      adGroup = `${prefix}/adGroups/-3`;
    return {
      provider: g.provider,
      operations: [
        {
          campaignBudgetOperation: {
            create: {
              resourceName: `${prefix}/campaignBudgets/-1`,
              name: `${m.name} budget`,
              period: "CUSTOM_PERIOD",
              totalAmountMicros: String(m.budget.minor * 10000),
              explicitlyShared: false,
              deliveryMethod: "STANDARD",
            },
          },
        },
        {
          campaignOperation: {
            create: {
              resourceName: campaign,
              name: m.name,
              status: "PAUSED",
              advertisingChannelType: "SEARCH",
              campaignBudget: `${prefix}/campaignBudgets/-1`,
              manualCpc: {},
              containsEuPoliticalAdvertising:
                "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
              startDateTime: dateInZone(m.startAt, m.timezone),
              endDateTime: dateInZone(m.endAt, m.timezone),
              geoTargetTypeSetting: {
                positiveGeoTargetType: "PRESENCE",
                negativeGeoTargetType: "PRESENCE",
              },
              networkSettings: {
                targetGoogleSearch: true,
                targetSearchNetwork: false,
                targetContentNetwork: false,
                targetPartnerSearchNetwork: false,
              },
            },
          },
        },
        {
          adGroupOperation: {
            create: {
              resourceName: adGroup,
              campaign,
              name: m.name,
              status: "PAUSED",
              type: "SEARCH_STANDARD",
              cpcBidMicros: "100000",
            },
          },
        },
        ...m.audience.locations.map((geoTargetConstant) => ({
          campaignCriterionOperation: {
            create: {
              campaign,
              location: {
                geoTargetConstant,
              },
              negative: false,
            },
          },
        })),
        ...m.audience.keywords!.map((t) => ({
          adGroupCriterionOperation: {
            create: {
              adGroup,
              status: "ENABLED",
              keyword: {
                text: t,
                matchType: "EXACT",
              },
            },
          },
        })),
        {
          adGroupAdOperation: {
            create: {
              adGroup,
              status: "PAUSED",
              ad: {
                finalUrls: [m.destination],
                responsiveSearchAd: {
                  headlines: m.searchHeadlines!.map((t) => ({
                    text: t,
                  })),
                  descriptions: m.searchDescriptions!.map((t) => ({
                    text: t,
                  })),
                },
              },
            },
          },
        },
      ],
      disclosure: {
        bidding: "manual CPC, 0.10 account currency per click",
        placements: "Google Search only",
        lifetimeMinor: m.budget.minor,
      },
    };
  }
  requireThat(
    assets.length === 1 && assets[0]?.kind === "image",
    "single_image_required_video_ads_unsupported",
  );
  const image = assets[0]!;
  if (settings) requireThat(m.assetIds.length === 1 && m.assetIds[0] === image.id && image.projectId === c.projectId && image.campaignId === c.id, "asset_ownership_mismatch");
  if (g.provider === "meta") {
    requireThat(g.pageId && /^\d+$/.test(g.pageId), "meta_page_required");
    const ms = settings?.provider === "meta" ? settings : undefined;
    return {
      provider: g.provider,
      ...(ms ? { capabilityVersion: ms.version, accountId: g.accountId, readbackVersion: "4" } : {}),
      imageDigest: image.digest,
      campaign: {
        name: m.name,
        ...(ms ? { is_adset_budget_sharing_enabled: false } : {}),
        objective: ms?.objective ?? "OUTCOME_TRAFFIC",
        special_ad_categories: ms?.delivery === "employment" ? ["EMPLOYMENT"] : [],
        ...(ms?.delivery === "employment" ? { special_ad_category_country: ["US"] } : {}),
        ...(m.advertisingBudget?.daily ? { spend_cap: String(m.budget.minor) } : {}),
        status: "PAUSED",
      },
      adset: {
        name: m.name,
        billing_event: "IMPRESSIONS",
        optimization_goal: ms?.optimization ?? "LINK_CLICKS",
        ...(ms ? ms.objective === "OUTCOME_AWARENESS" ? { promoted_object: { page_id: ms.identity.pageId } } : { destination_type: "WEBSITE" } : {}),
        ...(ms?.delivery === "employment" ? { promoted_object: { pixel_id: ms.conversion!.pixelId, custom_conversion_id: ms.conversion!.customConversionId } } : {}),
        bid_strategy: "LOWEST_COST_WITHOUT_CAP",
        ...(m.advertisingBudget?.daily ? { daily_budget: String(m.advertisingBudget.daily.minor) } : { lifetime_budget: String(m.budget.minor) }),
        start_time: m.startAt,
        end_time: m.endAt,
        status: "PAUSED",
        targeting: ms ? metaTargeting(c, ms) : {
          geo_locations: {
            countries: m.audience.locations,
          },
          age_min: m.audience.ageMin,
          age_max: m.audience.ageMax,
          publisher_platforms: ["facebook"],
          facebook_positions: ["feed"],
          targeting_automation: {
            advantage_audience: 0,
          },
        },
      },
      creative: {
        pageId: ms?.identity.pageId ?? g.pageId,
        ...(ms?.identity.instagramUserId ? { instagramUserId: ms.identity.instagramUserId } : {}),
        name: m.headline,
        message: m.body,
        link: m.destination,
      },
    };
  }
  requireThat(
    g.organizationId && /^\d+$/.test(g.organizationId),
    "linkedin_organization_required",
  );
  requireThat(m.advertisingBudget?.daily, "linkedin_explicit_daily_budget_required");
  const ls = settings?.provider === "linkedin" ? settings : undefined;
  return {
    provider: g.provider,
    ...(ls ? { capabilityVersion: ls.version, conversion: ls.conversion } : {}),
    imageDigest: image.digest,
    accountId: g.accountId,
    group: {
      name: m.name,
      totalBudgetCents: m.budget.minor,
      currencyCode: m.budget.currency,
      startAt: Date.parse(m.startAt),
      endAt: Date.parse(m.endAt),
    },
    campaign: {
      name: m.name,
      organizationId: g.organizationId,
      currencyCode: m.budget.currency,
      dailyBudgetCents: m.advertisingBudget.daily.minor,
      startAt: Date.parse(m.startAt),
      endAt: Date.parse(m.endAt),
      objectiveType: ls?.objective ?? "WEBSITE_VISIT",
      ...(ls ? { optimizationTargetType: ls.optimization, politicalIntent: ls.politicalIntent } : {}),
      format: "STANDARD_UPDATE",
      type: "SPONSORED_UPDATES",
      costType: ls?.bid.costType ?? "CPC",
      unitCostAmount: ls ? ls.bid.mode === "manual" ? (ls.bid.amountMinor / 100).toFixed(2) : "0" : "0.10",
      audienceExpansionEnabled: false,
      offsiteDeliveryEnabled: false,
      targetingCriteria: ls ? linkedInTargeting(c, ls) : {
        include: {
          and: [
            {
              or: {
                "urn:li:adTargetingFacet:locations": m.audience.locations,
              },
            },
            ...(m.audience.jobTitles?.length
              ? [
                  {
                    or: {
                      "urn:li:adTargetingFacet:titles": m.audience.jobTitles,
                    },
                  },
                ]
              : []),
          ],
        },
      },
    },
    creative: {
      name: m.name,
      organizationId: g.organizationId,
      commentary: m.body,
      mediaTitle: m.headline,
      landingPageUrl: m.destination,
      callToActionLabel: "LEARN_MORE",
    },
  };
}

/** Compare only documented writable fields; additional provider defaults are not authority. */
function subset(actual: any, expected: any): boolean {
  if (expected === null || typeof expected !== "object")
    return String(actual) === String(expected);
  if (Array.isArray(expected))
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((v, i) => subset(actual[i], v))
    );
  return (
    actual && Object.entries(expected).every(([k, v]) => subset(actual[k], v))
  );
}
/** LinkedIn BigDecimal money is a string; insignificant trailing zeroes are not drift. */
function decimalMinor(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  if (/[^0]/.test(fraction.slice(2))) return null;
  return BigInt(whole!) * 100n + BigInt(fraction.slice(0, 2).padEnd(2, "0"));
}
function linkedInMoney(actual: any, amount: string, currency: string): boolean {
  const expected = decimalMinor(amount);
  return expected !== null && decimalMinor(actual?.amount) === expected && actual?.currencyCode === currency;
}
export class NativeProvider implements ProviderPort {
  readonly evidence = "provider" as const;
  constructor(
    readonly name: Grant["provider"],
    readonly vault: VaultPort,
    readonly store: Store,
    readonly fetcher: typeof fetch = fetch,
  ) {}
  private async use<T>(g: Grant, fn: (client: any) => Promise<T>) {
    requireThat(g.provider === this.name, "provider_mismatch");
    try {
      return await this.vault.use(g, (credentials) =>
        fn(
          this.name === "meta"
            ? new MetaMarketingClient({
                ...credentials,
                fetchImpl: this.fetcher,
              })
            : this.name === "linkedin"
              ? new LinkedInMarketingClient({
                  ...credentials,
                  apiVersion: "202609",
                  fetchImpl: this.fetcher,
                })
              : new GoogleAdsClient(
                  async () => credentials.accessToken,
                  credentials.loginCustomerId,
                  this.fetcher,
                ),
        ),
      );
    } catch (error) {
      // Never expose provider bodies, request configuration or credential resolver errors.
      // Partial object IDs have already been retained inside prepare's write boundary.
      if (error instanceof DomainError) throw error;
      throw new DomainError("provider_request_failed", 502);
    }
  }
  async verify(
    g: Grant,
    campaign?: Campaign,
    assets: Asset[] = [],
    intent?: Permission,
  ): ReturnType<ProviderPort["verify"]> {
    requireThat(intent === "pause" || this.name !== "linkedin" || g.timezone === "UTC", "linkedin_utc_required", 422);
    if (campaign && intent !== "pause") validateAccountCapability(campaign, g, true);
    return await this.use(g, async (client) => {
      if (campaign?.material.settings && intent !== "pause") await this.verifySettings(client, campaign, g);
      if (this.name === "google") {
        const c = await client.verify(g.accountId);
        // A read alone is insufficient proof of mutate permission. Validate the
        // exact plan before declaring writes usable, without creating objects.
        if (campaign) {
          const plan: any = this.plan(campaign, g, assets);
          await client.mutate(g.accountId, plan.operations, true);
        }
        return {
          accountId: String(c.id),
          currency: c.currencyCode,
          timezone: c.timeZone,
          permissions: campaign ? perms : ["setup", "report"],
        };
      }
      const v = await client.verifyConnection({
        adAccountId: g.accountId,
        pageId: g.pageId,
        organizationId: g.organizationId,
      });
      requireThat((this.name === "meta" ? accountPath(v.account.id) === accountPath(g.accountId) : v.account.id === g.accountId) &&
        v.account.currency === g.currency && (intent === "pause" && this.name === "linkedin" || v.account.timezoneName === g.timezone),
        "provider_account_context_changed");
      const permissions: Permission[] = ["setup"];
      if (
        v.permissions.adsRead &&
        (this.name === "meta" || v.permissions.adsReporting)
      )
        permissions.push("report");
      if (
        v.permissions.adsManagement &&
        v.paymentReady &&
        (this.name === "meta"
          ? v.assets.page.accessible
          : v.assets.organization.matchesAccountReference &&
            v.permissions.organizationSocialWrite)
      )
        permissions.push("prepare", "activate", "pause");
      return {
        accountId: g.accountId, // Return the grant spelling only after observed identity comparison.
        timezoneSource: this.name === "linkedin" ? "provider_reporting_and_budget_policy" : "provider_account",
        currency: v.account.currency,
        timezone: v.account.timezoneName,
        permissions,
      };
    });
  }
  private async accountContext(client: any, g: Grant) {
    const a = this.name === "meta" ? await client.getObject(accountPath(g.accountId), "id,currency,timezone_name") : await client.getAdAccount(g.accountId);
    const timezone = this.name === "meta" ? a.timezone_name : "UTC";
    const id = this.name === "meta"
      ? typeof a.id === "string" && /^act_\d+$/.test(a.id) ? a.id : null
      : typeof a.id === "string" && /^\d+$/.test(a.id) ? a.id
        : Number.isSafeInteger(a.id) && a.id > 0 ? String(a.id) : null;
    requireThat(id === (this.name === "meta" ? accountPath(g.accountId) : g.accountId) &&
      a.currency === g.currency && timezone === g.timezone, "provider_account_context_changed");
    return { id, currency: a.currency, timezone };
  }

  private mediaIdentity(v: any) { return { id: v.id, owner: v.owner, status: v.status }; }
  private async metaImage(client: any, g: Grant, hash: string) {
    const rows = await client.listImages(g.accountId);
    const found = rows.data.filter((x: any) => x.hash === hash);
    requireThat(found.length === 1, "provider_image_ownership_unverified");
    return { hash: found[0].hash, status: found[0].status };
  }
  private validateLinkedInConversion(actual: any, expected: any, account: string) {
    requireThat(String(actual?.id) === expected.id.split(":").at(-1) &&
      actual.account === `urn:li:sponsoredAccount:${account}` && actual.enabled === true && actual.type === expected.type,
      "conversion_owner_or_type_mismatch");
    if (expected.event === "ApplicantRequestMOU") requireThat(actual.name === "ApplicantRequestMOU" &&
      actual.conversionMethod === "CONVERSIONS_API" && !actual.urlMatchRuleExpression,
      "applicant_event_binding_unverified");
  }
  private async verifySettings(client: any, c: Campaign, g: Grant) {
    const s = c.material.settings!;
    await this.accountContext(client, g);
    if (s.provider === "meta") {
      const page = await client.getObject(s.identity.pageId, "id,instagram_business_account");
      requireThat(String(page.id) === s.identity.pageId && (!s.identity.instagramUserId ||
        page.instagram_business_account?.id === s.identity.instagramUserId), "instagram_page_ownership_unverified");
      for (const interest of s.targeting.interestGroups.flat()) {
        const result = await client.searchTargeting(interest.label);
        requireThat(result.data?.some((x: any) => String(x.id) === interest.id && x.name === interest.label), "interest_resolution_changed");
      }
      if (s.targeting.excludedCustomAudiences.length) {
        const result = await client.listCustomAudiences(g.accountId);
        requireThat(s.targeting.excludedCustomAudiences.every(x => result.data.some((r: any) => String(r.id) === x.id && r.name === x.label)), "custom_audience_ownership_unverified");
      }
      if (s.conversion) {
        const conversion = await client.getObject(s.conversion.customConversionId, "id,account_id,pixel,rule");
        let rule; try { rule = typeof conversion.rule === "string" ? JSON.parse(conversion.rule) : conversion.rule; } catch { rule = null; }
        requireThat(String(conversion.id) === s.conversion.customConversionId && String(conversion.account_id) === g.accountId.replace(/^act_/, "") &&
          String(conversion.pixel?.id) === s.conversion.pixelId && exactTargeting(rule, { and: [{ event: { eq: "ApplicantRequestMOU" } }] }), "applicant_event_binding_unverified");
      }
    } else {
      for (const [kind, option] of selectedOptions(c.material.audience, s)) {
        const label = option.label || g.targetingOptions?.find(x => x.kind === kind && x.id === option.id)?.label;
        const result = await client.findTargetingEntities({ facet: kind, query: label });
        requireThat(result.elements?.some((x: any) => x.urn === option.id && x.name === label), "professional_taxonomy_changed");
      }
      if (s.conversion) this.validateLinkedInConversion(await client.getConversion(s.conversion.id, g.accountId), s.conversion, g.accountId);
    }
  }
  plan(c: Campaign, g: Grant, assets: Asset[]) {
    return providerPlan(c, g, assets);
  }
  private async bytes(project: string, a: Asset) {
    return Buffer.from(
      (await this.store.db
        .prepare("SELECT bytes FROM blobs WHERE project_id=? AND digest=?")
        .get(project, a.digest))!.bytes as Uint8Array,
    );
  }
  async prepare(
    c: Campaign,
    g: Grant,
    assets: Asset[],
    key: string,
    retain: (ids: Record<string, string>) => void | Promise<void>,
    beforeWrite: () => void | Promise<void>,
  ) {
    if (g.provider !== "google") requireThat(c.material.settings, "explicit_provider_settings_required", 422);
    const plan: any = this.plan(c, g, assets);
    validateAccountCapability(c, g, true);
    const hostBeforeWrite = beforeWrite;
    const scopeDigest = digest({ c, g });
    beforeWrite = async () => {
      await hostBeforeWrite();
      requireThat(digest({ c, g }) === scopeDigest, "provider_scope_changed");
      validateAccountCapability(c, g, true);
    };
    const ids: Record<string, string> = { readbackVersion: plan.readbackVersion ?? (c.material.settings ? "3" : "2") };
    const create = async (
      key: string,
      action: () => Promise<{
        id: string;
      }>,
    ) => {
      try {
        const result = await action();
        ids[key] = result.id;
        await retain({
          ...ids,
        });
        return result.id;
      } catch (error) {
        const known = (
          error as {
            providerObjectId?: string;
          }
        ).providerObjectId;
        if (known) {
          ids[key] = String(known);
          await retain({
            ...ids,
          });
        }
        throw error;
      }
    };
    return await this.use(g, async (client) => {
      if (this.name === "linkedin") {
        client.beforeWrite = beforeWrite;
        client.onAssetInitialized = async (image: string) => { ids.image = image; await retain({ ...ids }); };
      }
      if (c.material.settings) await this.verifySettings(client, c, g);
      if (this.name === "google") {
        await client.mutate(g.accountId, plan.operations, true);
        await beforeWrite();
        const result = await client.mutate(g.accountId, plan.operations);
        const rows = result.mutateOperationResponses;
        requireThat(
          Array.isArray(rows) && rows.length === plan.operations.length,
          "google_write_outcome_unknown",
        );
        for (let i = 0; i < rows.length; i++)
          ids[`resource${i}`] = String(
            (Object.values(rows[i]!)[0] as any)?.resourceName || "",
          );
        ids.campaign = ids.resource1!;
        ids.adGroup = ids.resource2!;
        ids.ad = ids[`resource${rows.length - 1}`]!;
        await retain(ids);
      } else if (this.name === "meta") {
        const bytes = await this.bytes(c.projectId, assets[0]!);
        await beforeWrite();
        const image = await client.uploadImage(g.accountId, {
          bytesBase64: bytes.toString("base64"),
          filename: `${key}.png`,
        });
        ids.image = String(
          (Object.values(image.images || {})[0] as any)?.hash || "",
        );
        requireThat(ids.image, "image_upload_unknown");
        await retain(ids);
        await beforeWrite();
        await create("campaign", () =>
          client.createPausedObject(g.accountId, "campaign", {
            ...plan.campaign,
            name: `${c.material.name} [${key}]`,
          }),
        );
        await beforeWrite();
        await create("adset", () =>
          client.createPausedObject(g.accountId, "adset", {
            ...plan.adset,
            campaign_id: ids.campaign,
          }),
        );
        await beforeWrite();
        const creative = await client.request(`${accountPath(g.accountId)}/adcreatives`, {
          method: "POST",
          body: {
            name: c.material.name,
            object_story_spec: {
              page_id: plan.creative.pageId,
              ...(plan.creative.instagramUserId ? { instagram_user_id: plan.creative.instagramUserId } : {}),
              link_data: {
                image_hash: ids.image,
                link: plan.creative.link,
                message: plan.creative.message,
                name: plan.creative.name,
                call_to_action: {
                  type: "LEARN_MORE",
                  value: {
                    link: plan.creative.link,
                  },
                },
              },
            },
          },
        });
        ids.creative = creative.id;
        await retain(ids);
        await beforeWrite();
        await create("ad", () =>
          client.createPausedObject(g.accountId, "ad", {
            name: c.material.name,
            adset_id: ids.adset,
            creative: {
              creative_id: ids.creative,
            },
            status: "PAUSED",
          }),
        );
      } else {
        await beforeWrite();
        const image = await client.uploadImage({
          organizationId: g.organizationId,
          bytes: await this.bytes(c.projectId, assets[0]!),
          mediaType: assets[0]!.mime,
        });
        ids.image = image.assetUrn || image.urn || image.id;
        requireThat(ids.image, "image_upload_unknown");
        await retain(ids);
        await beforeWrite();
        ids.group = (
          await client.createCampaignGroup(g.accountId, {
            ...plan.group,
            name: `${c.material.name} [${key}]`,
          })
        ).id;
        await retain(ids);
        await beforeWrite();
        ids.campaign = (
          await client.createCampaign(g.accountId, {
            ...plan.campaign,
            campaignGroup: ids.group,
          })
        ).id;
        await retain(ids);
        if (plan.conversion) {
          ids.conversion = plan.conversion.id;
          await retain(ids);
          await beforeWrite();
          await client.associateCampaignConversion(ids.campaign, ids.conversion);
        }
        await beforeWrite();
        ids.creative = (
          await client.createDirectSponsoredCreative(g.accountId, {
            ...plan.creative,
            campaignId: ids.campaign,
            mediaUrn: ids.image,
          })
        ).id;
        await retain(ids);
      }
      const snapshot = await this.snapshot(client, g, ids);
      requireThat(snapshot.paused, "provider_not_paused");
      this.validateSnapshot(snapshot.material, plan, ids);
      ids.readbackDigest = digest(snapshot.material);
      await retain(ids);
      return {
        ...this.receipt(ids, digest(plan), "paused"),
        providerRequestId: client.lastRequestId || null,
      };
    });
  }
  private receipt(
    ids: Record<string, string>,
    payloadDigest: string,
    intent: Receipt["intent"],
  ): Receipt {
    return {
      ids,
      payloadDigest,
      intent,
      delivery: "unverified",
      providerRequestId: null,
      observedAt: new Date().toISOString(),
      evidence: "provider",
    };
  }
  private async snapshot(
    client: any,
    g: Grant,
    ids: Record<string, string>,
  ): Promise<{
    material: any;
    paused: boolean;
    enabled: boolean;
  }> {
    requireThat(ids.campaign, "incomplete_provider_identity");
    requireThat(ids.readbackVersion === undefined || ["1", "2", "3"].includes(ids.readbackVersion) ||
      (this.name === "meta" && ids.readbackVersion === "4"), "unsupported_readback_version");
    if (this.name === "meta") {
      // v4 extends every v3 identity/material check; historical field sets stay exact.
      const explicit = ["3", "4"].includes(ids.readbackVersion!);
      const budgets = ["2", "3", "4"].includes(ids.readbackVersion!);
      requireThat(
        ids.adset && ids.creative && ids.ad,
        "incomplete_provider_identity",
      );
      const campaign = await client.getObject(
        ids.campaign,
        budgets ? `id,objective,special_ad_categories,spend_cap,status${explicit ? ",account_id,special_ad_category_country" : ""}${ids.readbackVersion === "4" ? ",is_adset_budget_sharing_enabled" : ""}` : "id,objective,special_ad_categories,status",
      );
      const adset = await client.getObject(
        ids.adset,
        `id,campaign_id,billing_event,optimization_goal,bid_strategy,lifetime_budget,${budgets ? "daily_budget," : ""}start_time,end_time,targeting,status${explicit ? ",account_id,destination_type,promoted_object,targeting_optimization_types" : ""}`,
      );
      const creative = await client.getObject(
        ids.creative,
        explicit ? "id,account_id,object_story_spec" : "id,object_story_spec",
      );
      const ad = await client.getObject(ids.ad, explicit ? "id,account_id,adset_id,creative,status" : "id,adset_id,creative,status");
      const statuses = [campaign.status, adset.status, ad.status];
      delete campaign.status;
      delete adset.status;
      delete ad.status;
      return {
        material: {
          ...(explicit ? { account: await this.accountContext(client, g), image: await this.metaImage(client, g, ids.image!) } : {}),
          campaign,
          adset,
          creative,
          ad,
        },
        paused: statuses.every((x) => x === "PAUSED"),
        enabled: statuses.every((x) => x === "ACTIVE"),
      };
    }
    if (this.name === "linkedin") {
      requireThat(ids.group && ids.creative, "incomplete_provider_identity");
      const group = await client.getCampaignGroup(g.accountId, ids.group),
        campaign = await client.getCampaign(g.accountId, ids.campaign);
      const creative = await client.getCreative(g.accountId, ids.creative);
      const expanded = await client.expandCreativePost(creative);
      let rawPost = expanded.inlineContent?.post;
      if (ids.readbackVersion === "3" && creative.content !== undefined) {
        const reference = creative.content?.reference;
        requireThat(Object.keys(creative.content).length === 1 && /^urn:li:(share|ugcPost):[0-9]+$/.test(reference || ""), "creative_reference_unverified");
        rawPost = await client.request(`posts/${encodeURIComponent(reference)}`, { query: { viewContext: "AUTHOR" } });
        requireThat(rawPost?.id === reference, "creative_reference_unverified");
      }
      requireThat(rawPost, "linkedin_post_readback_required");
      const post = {
        author: rawPost.author,
        commentary: rawPost.commentary,
        content: rawPost.content,
        contentLandingPage: rawPost.contentLandingPage,
        contentCallToActionLabel: rawPost.contentCallToActionLabel,
        distribution: rawPost.distribution,
      };
      const statuses = [group.status, campaign.status, creative.intendedStatus];
      // Exclude reporting/lastModified data from exact material comparison.
      const pick = (obj: any, fields: string[]) =>
        Object.fromEntries(fields.map((f) => [f, obj[f]]));
      return {
        material: {
          ...(ids.readbackVersion === "3" ? { account: await this.accountContext(client, g), image: this.mediaIdentity(await client.request(`images/${encodeURIComponent(ids.image!)}`)),
            associations: await client.listCampaignConversions(ids.campaign),
            ...(ids.conversion ? { conversion: await client.getConversion(ids.conversion, g.accountId),
              association: await client.getCampaignConversion(ids.campaign, ids.conversion) } : {}) } : {}),
          group: pick(group, [...(ids.readbackVersion === "3" ? ["id"] : []), ...(["2", "3"].includes(ids.readbackVersion!) ? ["account"] : []), "totalBudget", "runSchedule"]),
          campaign: pick(campaign, [
            ...(ids.readbackVersion === "3" ? ["id"] : []),
            "account",
            "campaignGroup",
            "associatedEntity",
            "targetingCriteria",
            "dailyBudget",
            "runSchedule",
            "audienceExpansionEnabled",
            "offsiteDeliveryEnabled",
            "unitCost",
            ...(["2", "3"].includes(ids.readbackVersion!) ? ["costType", "format"] : []),
            "objectiveType",
            "type",
            ...(ids.readbackVersion === "3" ? ["optimizationTargetType", "politicalIntent", "locale", "connectedTelevisionOnly"] : []),
          ]),
          creative: pick(creative, [...(ids.readbackVersion === "3" ? ["id"] : []), "campaign", "content"]),
          post,
        },
        paused: statuses.every((x) => ["DRAFT", "PAUSED"].includes(x)),
        enabled: statuses.every((x) => x === "ACTIVE"),
      };
    }
    requireThat(
      new RegExp(`^customers/${g.accountId}/campaigns/\\d+$`).test(
        ids.campaign,
      ),
      "google_identity_mismatch",
    );
    const campaignId = ids.campaign.split("/").at(-1);
    const rows = await client.search(
      g.accountId,
      `SELECT campaign.resource_name, campaign.status, campaign.advertising_channel_type, campaign.bidding_strategy_type, campaign.campaign_budget, campaign.start_date_time, campaign.end_date_time, campaign.geo_target_type_setting.positive_geo_target_type, campaign.geo_target_type_setting.negative_geo_target_type, campaign.network_settings.target_google_search, campaign.network_settings.target_search_network, campaign.network_settings.target_content_network, campaign.network_settings.target_partner_search_network, campaign_budget.resource_name, campaign_budget.total_amount_micros, campaign_budget.period, campaign_budget.explicitly_shared FROM campaign WHERE campaign.id = ${campaignId}`,
    );
    const ads = await client.search(
      g.accountId,
      `SELECT ad_group.resource_name, ad_group.status, ad_group.cpc_bid_micros, ad_group_ad.resource_name, ad_group_ad.status, ad_group_ad.ad.final_urls, ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions FROM ad_group_ad WHERE campaign.id = ${campaignId}`,
    );
    const targets = await client.search(
      g.accountId,
      `SELECT campaign_criterion.location.geo_target_constant, campaign_criterion.negative FROM campaign_criterion WHERE campaign.id = ${campaignId}`,
    );
    const keywords = await client.search(
      g.accountId,
      `SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status FROM ad_group_criterion WHERE campaign.id = ${campaignId}`,
    );
    requireThat(
      rows.length === 1 && ads.length === 1,
      "google_readback_incomplete",
    );
    const statuses = [
      rows[0].campaign.status,
      ads[0].adGroup.status,
      ads[0].adGroupAd.status,
    ];
    delete rows[0].campaign.status;
    delete ads[0].adGroup.status;
    delete ads[0].adGroupAd.status;
    return {
      material: {
        rows,
        ads,
        targets: targets.sort((a: any, b: any) =>
          digest(a).localeCompare(digest(b)),
        ),
        keywords: keywords.sort((a: any, b: any) =>
          digest(a).localeCompare(digest(b)),
        ),
      },
      paused: statuses.every((x) => x === "PAUSED"),
      enabled: statuses.every((x) => x === "ENABLED"),
    };
  }
  private validateSnapshot(s: any, plan: any, ids: Record<string, string>) {
    if (this.name === "meta") {
      if (plan.readbackVersion === "4") requireThat(ids.readbackVersion === "4" &&
        plan.campaign.is_adset_budget_sharing_enabled === false && s.campaign.is_adset_budget_sharing_enabled === false,
        "meta_budget_sharing_unverified");
      if (plan.capabilityVersion) {
        const account = plan.accountId.replace(/^act_/, "");
        requireThat(["campaign", "adset", "creative", "ad"].every(k => s[k].id === ids[k]), "provider_object_identity_mismatch");
        requireThat([s.campaign, s.adset, s.creative, s.ad].every(o => String(o.account_id) === account) &&
          s.image?.hash === ids.image && s.image?.status === "ACTIVE", "provider_media_or_account_mismatch");
        requireThat(exactTargeting(s.adset.targeting, plan.adset.targeting), "provider_targeting_mismatch");
        if (plan.campaign.objective === "OUTCOME_AWARENESS") requireThat(s.adset.destination_type === "UNDEFINED", "awareness_destination_unverified");
        if (plan.adset.promoted_object) requireThat(exactTargeting(s.adset.promoted_object, plan.adset.promoted_object), "promoted_object_mismatch");
        else requireThat(s.adset.promoted_object === undefined || exactTargeting(s.adset.promoted_object, {}), "unexpected_promoted_object");
        requireThat(exactTargeting(s.creative.object_story_spec, {
          page_id: plan.creative.pageId, ...(plan.creative.instagramUserId ? { instagram_user_id: plan.creative.instagramUserId } : {}),
          link_data: { image_hash: ids.image, link: plan.creative.link, message: plan.creative.message, name: plan.creative.name,
            call_to_action: { type: "LEARN_MORE", value: { link: plan.creative.link } } },
        }), "creative_identity_or_content_mismatch");
        if (plan.adset.targeting.targeting_optimization === "none") requireThat(metaExpansionOff(s.adset.targeting_optimization_types), "meta_expansion_off_unverified");
      }
      const { name: _name, status: _status, ...expected } = plan.adset;
      expected.start_time = new Date(expected.start_time).getTime();
      expected.end_time = new Date(expected.end_time).getTime();
      requireThat(
        subset(
          {
            ...s.adset,
            start_time: Date.parse(s.adset.start_time),
            end_time: Date.parse(s.adset.end_time),
          },
          expected,
        ) &&
          subset(s.campaign, {
            objective: plan.campaign.objective,
            special_ad_categories: plan.campaign.special_ad_categories,
            ...(plan.campaign.special_ad_category_country ? { special_ad_category_country: plan.campaign.special_ad_category_country } : {}),
            ...(plan.campaign.spend_cap ? { spend_cap: plan.campaign.spend_cap } : {}),
          }) &&
          s.adset.campaign_id === ids.campaign &&
          s.ad.adset_id === ids.adset &&
          s.ad.creative?.id === ids.creative &&
          subset(s.creative.object_story_spec, {
            page_id: plan.creative.pageId,
            ...(plan.creative.instagramUserId ? { instagram_user_id: plan.creative.instagramUserId } : {}),
            link_data: {
              image_hash: ids.image,
              name: plan.creative.name,
              message: plan.creative.message,
              link: plan.creative.link,
            },
          }),
        "provider_effective_material_mismatch",
      );
    } else if (this.name === "google") {
      const ops = plan.operations;
      const expectedBudget = ops[0].campaignBudgetOperation.create;
      const expectedCampaign = ops[1].campaignOperation.create;
      const expectedAd = ops.at(-1).adGroupAdOperation.create.ad;
      requireThat(
        subset(s.rows[0].campaignBudget, {
          totalAmountMicros: expectedBudget.totalAmountMicros,
          period: "CUSTOM_PERIOD",
          explicitlyShared: false,
          resourceName: ids.resource0,
        }) &&
          subset(s.rows[0].campaign, {
            resourceName: ids.campaign,
            campaignBudget: ids.resource0,
            advertisingChannelType: "SEARCH",
            biddingStrategyType: "MANUAL_CPC",
            startDateTime: expectedCampaign.startDateTime,
            endDateTime: expectedCampaign.endDateTime,
            networkSettings: expectedCampaign.networkSettings,
            geoTargetTypeSetting: expectedCampaign.geoTargetTypeSetting,
          }) &&
          subset(s.ads[0].adGroup, {
            resourceName: ids.adGroup,
            cpcBidMicros: "100000",
          }) &&
          s.ads[0].adGroupAd.resourceName === ids.ad &&
          subset(s.ads[0].adGroupAd.ad, expectedAd),
        "provider_effective_material_mismatch",
      );
      const locations = s.targets
        .map((r: any) => r.campaignCriterion.location?.geoTargetConstant)
        .sort();
      const wanted = ops
        .filter((o: any) => o.campaignCriterionOperation)
        .map(
          (o: any) =>
            o.campaignCriterionOperation.create.location.geoTargetConstant,
        )
        .sort();
      requireThat(
        digest(locations) === digest(wanted),
        "provider_targeting_mismatch",
      );
      const keywords = s.keywords
        .map((r: any) => r.adGroupCriterion.keyword)
        .sort((a: any, b: any) => a.text.localeCompare(b.text));
      const expectedKeywords = ops
        .filter((o: any) => o.adGroupCriterionOperation)
        .map((o: any) => o.adGroupCriterionOperation.create.keyword)
        .sort((a: any, b: any) => a.text.localeCompare(b.text));
      requireThat(
        digest(keywords) === digest(expectedKeywords) &&
          s.keywords.every(
            (r: any) => r.adGroupCriterion.status === "ENABLED",
          ) &&
          s.targets.every((r: any) => r.campaignCriterion.negative === false),
        "provider_keyword_or_location_mismatch",
      );
    } else {
      if (plan.capabilityVersion) {
        requireThat(String(s.group.id) === ids.group && String(s.campaign.id) === ids.campaign &&
          String(s.creative.id).replace(/^urn:li:sponsoredCreative:/, "") === ids.creative, "provider_object_identity_mismatch");
        requireThat(s.campaign.optimizationTargetType === plan.campaign.optimizationTargetType &&
          s.campaign.politicalIntent === plan.campaign.politicalIntent && s.campaign.connectedTelevisionOnly === false &&
          exactTargeting(s.campaign.locale, { country: "US", language: "en" }) &&
          exactTargeting(s.campaign.targetingCriteria, plan.campaign.targetingCriteria), "provider_targeting_or_optimization_mismatch");
        requireThat(s.post.contentCallToActionLabel === plan.creative.callToActionLabel &&
          exactTargeting(s.post.distribution, { feedDistribution: "NONE", thirdPartyDistributionChannels: [] }), "creative_distribution_mismatch");
        requireThat(s.image?.id === ids.image && s.image?.owner === `urn:li:organization:${plan.creative.organizationId}` && s.image?.status === "AVAILABLE", "provider_media_owner_unverified");
        if (!plan.conversion) requireThat(Array.isArray(s.associations) && s.associations.length === 0, "unexpected_conversion_associations");
        if (plan.conversion) {
          this.validateLinkedInConversion(s.conversion, plan.conversion, plan.accountId);
          requireThat(s.associations?.length === 1 && s.associations[0].campaign === s.association?.campaign && s.associations[0].conversion === ids.conversion, "unexpected_conversion_associations");
          requireThat(s.association?.campaign === `urn:li:sponsoredCampaign:${ids.campaign}` && s.association?.conversion === ids.conversion, "conversion_association_unverified");
        }
      }
      requireThat(
        s.group.account === s.campaign.account &&
        s.campaign.account === `urn:li:sponsoredAccount:${plan.accountId}` &&
        s.campaign.associatedEntity === `urn:li:organization:${plan.campaign.organizationId}` &&
        linkedInMoney(s.campaign.dailyBudget, (plan.campaign.dailyBudgetCents / 100).toFixed(2), plan.campaign.currencyCode) &&
        linkedInMoney(s.campaign.unitCost, plan.campaign.unitCostAmount, plan.campaign.currencyCode) &&
        s.campaign.objectiveType === plan.campaign.objectiveType &&
        s.campaign.type === plan.campaign.type && s.campaign.costType === plan.campaign.costType &&
        s.campaign.format === plan.campaign.format &&
        linkedInMoney(s.group.totalBudget, (plan.group.totalBudgetCents / 100).toFixed(2), plan.group.currencyCode) &&
          subset(
            s.campaign.targetingCriteria,
            plan.campaign.targetingCriteria,
          ) &&
          subset(s.group.runSchedule, {
            start: plan.group.startAt,
            end: plan.group.endAt,
          }) &&
          subset(s.campaign.runSchedule, {
            start: plan.campaign.startAt,
            end: plan.campaign.endAt,
          }) &&
          s.campaign.campaignGroup ===
            `urn:li:sponsoredCampaignGroup:${ids.group}` &&
          s.creative.campaign === `urn:li:sponsoredCampaign:${ids.campaign}` &&
          subset(s.post, {
            author: `urn:li:organization:${plan.creative.organizationId}`,
            commentary: plan.creative.commentary,
            contentLandingPage: plan.creative.landingPageUrl,
            content: {
              media: {
                id: ids.image,
                title: plan.creative.mediaTitle,
              },
            },
          }) &&
          s.campaign.audienceExpansionEnabled === false &&
          s.campaign.offsiteDeliveryEnabled === false,
        "provider_effective_material_mismatch",
      );
    }
  }
  private async status(
    c: Campaign,
    g: Grant,
    activate: boolean,
    beforeWrite: () => void | Promise<void>,
  ) {
    requireThat(
      c.receipt?.ids.readbackDigest,
      "verified_provider_objects_required",
    );
    const ids = c.receipt.ids;
    if (activate && this.name === "meta") requireThat(ids.readbackVersion === "4", "meta_readback_requalification_required");
    const scopeDigest = digest({ c, g });
    const hostBeforeWrite = beforeWrite;
    beforeWrite = async () => {
      await hostBeforeWrite();
      requireThat(digest({ c, g }) === scopeDigest, "provider_scope_changed");
      if (activate) validateAccountCapability(c, g, true);
    };
    if (activate) validateAccountCapability(c, g, true);
    return await this.use(g, async (client) => {
      if (this.name === "linkedin") client.beforeWrite = beforeWrite;
      if (activate && c.material.settings) await this.verifySettings(client, c, g);
      const before = await this.snapshot(client, g, ids);
      if (activate && this.name === "meta") requireThat(before.material.campaign.is_adset_budget_sharing_enabled === false,
        "meta_budget_sharing_unverified");
      requireThat(
        digest(before.material) === ids.readbackDigest &&
          (!activate || before.paused),
        "external_material_changed",
      );
      if (this.name === "meta") {
        // Parent last on activation; parent first on pause.
        for (const object of activate
          ? [ids.ad, ids.adset, ids.campaign]
          : [ids.campaign, ids.adset, ids.ad]) {
          await beforeWrite();
          await client.updateDeliveryStatus(
            object,
            activate ? "ACTIVE" : "PAUSED",
          );
        }
      } else if (this.name === "linkedin") {
        if (!activate) {
          await beforeWrite();
          await client.updateCampaignGroupStatus(
            g.accountId,
            ids.group,
            "PAUSED",
          );
        }
        await beforeWrite();
        await client.updateCreativeStatus(
          g.accountId,
          ids.creative,
          activate ? "ACTIVE" : "PAUSED",
        );
        await beforeWrite();
        await client.updateCampaignStatus(
          g.accountId,
          ids.campaign,
          activate ? "ACTIVE" : "PAUSED",
        );
        if (activate) {
          await beforeWrite();
          await client.updateCampaignGroupStatus(
            g.accountId,
            ids.group,
            "ACTIVE",
          );
        }
      } else {
        const state = activate ? "ENABLED" : "PAUSED";
        await beforeWrite();
        await client.mutate(
          g.accountId,
          [
            ["campaignOperation", ids.campaign],
            ["adGroupOperation", ids.adGroup],
            ["adGroupAdOperation", ids.ad],
          ].map(([type, resourceName]) => ({
            [type!]: {
              update: {
                resourceName,
                status: state,
              },
              updateMask: "status",
            },
          })),
        );
      }
      const after = await this.snapshot(client, g, ids);
      requireThat(
        (activate ? after.enabled : after.paused) &&
          digest(after.material) === ids.readbackDigest,
        "provider_outcome_unknown",
      );
      return this.receipt(
        ids,
        c.receipt!.payloadDigest,
        activate ? "enabled" : "paused",
      );
    });
  }
  async activate(
    c: Campaign,
    g: Grant,
    beforeWrite: () => void | Promise<void>,
  ) {
    requireThat(this.name !== "linkedin" || c.material.advertisingBudget?.daily, "linkedin_explicit_daily_budget_required");
    if (g.provider !== "google") requireThat(c.material.settings, "explicit_provider_settings_required", 422);
    return await this.status(c, g, true, beforeWrite);
  }
  async pause(c: Campaign, g: Grant, beforeWrite: () => void | Promise<void>) {
    return await this.status(c, g, false, beforeWrite);
  }
  async reconcile(
    c: Campaign,
    g: Grant,
    o: {
      kind: string;
      payloadDigest: string;
      receipt: Receipt | null;
    },
  ) {
    const receipt = o.receipt || c.receipt;
    if (!receipt?.ids.campaign) return null; // incomplete writes need specific native repair, never replay.
    return await this.use(g, async (client) => {
      let s;
      try {
        s = await this.snapshot(client, g, receipt.ids);
      } catch {
        return null;
      }
      if (!(o.kind === "activate" ? s.enabled : s.paused)) return null;
      if (this.name === "meta" && receipt.ids.readbackVersion === "4" && o.kind !== "pause" &&
        s.material.campaign.is_adset_budget_sharing_enabled !== false) return null;
      if (!receipt.ids.readbackDigest) {
        if (o.kind !== "prepare") return null;
        const assets = await Promise.all(
          c.material.assetIds.map(
            async (key) =>
              await this.store.get<Asset>(c.projectId, "asset", key),
          ),
        );
        const plan = this.plan(c, g, assets);
        if (digest(plan) !== o.payloadDigest) return null;
        try {
          this.validateSnapshot(s.material, plan, receipt.ids);
        } catch {
          return null;
        }
        return this.receipt(
          {
            ...receipt.ids,
            readbackDigest: digest(s.material),
          },
          o.payloadDigest,
          "paused",
        );
      }
      if (digest(s.material) !== receipt.ids.readbackDigest) return null;
      return this.receipt(
        receipt.ids,
        o.payloadDigest,
        o.kind === "activate" ? "enabled" : "paused",
      );
    });
  }
  async metrics(
    c: Campaign,
    g: Grant,
    from: string,
    until: string,
  ): Promise<Omit<Metrics, "id" | "projectId" | "campaignId">> {
    requireThat(c.receipt?.ids.campaign, "provider_campaign_not_prepared");
    requireThat(this.name !== "linkedin" || (g.timezone === "UTC" && c.material.timezone === "UTC"), "linkedin_utc_required", 422);
    const reportingBasis = { ...providerDayWindow(from, until, g.timezone),
      ...(this.name === "linkedin" ? { timezoneSource: "provider_reporting_and_budget_policy" as const } : this.name === "meta" ? { timezoneSource: "provider_account" as const } : {}) };
    const since = dateInZone(from, g.timezone).slice(0, 10),
      through = dateInZone(
        new Date(Date.parse(until) - 1).toISOString(),
        g.timezone,
      ).slice(0, 10);
    const values = await this.use(g, async (client) => {
      if (this.name !== "google") await this.accountContext(client, g);
      if (this.name === "google") {
        const key = c.receipt!.ids.campaign!.split("/").at(-1);
        requireThat(/^\d+$/.test(key!), "invalid_campaign_identity");
        const rows = await client.search(
          g.accountId,
          `SELECT metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM campaign WHERE campaign.id = ${key} AND segments.date BETWEEN '${since}' AND '${through}'`,
        );
        return summarizeMetrics(
          rows.map((r: any) => r.metrics),
          {
            impressions: "impressions",
            clicks: "clicks",
            spend: "costMicros",
            conversions: "conversions",
          },
          1 / 10000,
        );
      }
      if (this.name === "meta") {
        const r = await client.getInsights(g.accountId, {
          since,
          until: through,
          level: "campaign",
          objectIds: [c.receipt!.ids.campaign],
        });
        requireThat(Array.isArray(r.data), "provider_metrics_unavailable");
        return summarizeMetrics(
          r.data,
          {
            impressions: "impressions",
            clicks: "clicks",
            spend: "spend",
          },
          100,
        );
      }
      const r = await client.getAnalytics(g.accountId, {
        since,
        until: through,
        campaignUrns: [`urn:li:sponsoredCampaign:${c.receipt!.ids.campaign}`],
      });
      requireThat(Array.isArray(r.elements), "provider_metrics_unavailable");
      const reportDate = (d: any) => {
        requireThat(d && [d.year, d.month, d.day].every(Number.isInteger), "provider_metrics_scope_mismatch");
        const value = `${String(d.year).padStart(4, "0")}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
        requireThat(Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value, "provider_metrics_scope_mismatch");
        return value;
      };
      const days = new Set<string>();
      for (const row of r.elements) {
        const start = reportDate(row.dateRange?.start), end = reportDate(row.dateRange?.end);
        requireThat(start === end && start >= since && end <= through && !days.has(start) &&
          exactTargeting(row.pivotValues, [`urn:li:sponsoredCampaign:${c.receipt!.ids.campaign}`]), "provider_metrics_scope_mismatch");
        days.add(start);
      }
      return summarizeMetrics(
        r.elements,
        {
          impressions: "impressions",
          clicks: "clicks",
          spend: "costInLocalCurrency",
          conversions: "externalWebsiteConversions",
        },
        100,
      );
    });
    return {
      ...values,
      reportingBasis,
      from,
      until,
      timezone: g.timezone,
      currency: g.currency,
      observedAt: new Date().toISOString(),
      source: "provider",
    };
  }
}
export function summarizeMetrics(
  rows: Record<string, unknown>[],
  fields: {
    impressions: string;
    clicks: string;
    spend: string;
    conversions?: string;
  },
  moneyFactor: number,
) {
  const sum = (key: string | undefined) =>
    !key ||
    !rows.length ||
    rows.some(
      (r) =>
        (typeof r[key] !== "number" && typeof r[key] !== "string") ||
        (typeof r[key] === "string" && r[key].trim() === "") ||
        !Number.isFinite(Number(r[key])) ||
        Number(r[key]) < 0,
    )
      ? null
      : rows.reduce((n, r) => n + Number(r[key]), 0);
  const spend = sum(fields.spend);
  return {
    impressions: sum(fields.impressions),
    clicks: sum(fields.clicks),
    spendMinor: spend === null ? null : Math.round(spend * moneyFactor),
    providerConversions: sum(fields.conversions),
  };
}
