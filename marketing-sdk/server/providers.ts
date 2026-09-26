import type {
  Asset,
  Campaign,
  Grant,
  Metrics,
  Permission,
  Receipt,
} from "../core/index.js";
import type { ProviderPort } from "./ports.js";
import { digest, requireThat, Store } from "./store.js";
import { material } from "./validation.js";
import { GoogleAdsClient } from "./google.js";
// Existing server-only clients; never imported by core or React.
import { MetaMarketingClient } from "../support/owner-marketing/meta-client.js";
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
  requireThat(
    g.currency === m.budget.currency && g.timezone === m.timezone,
    "account_context_mismatch",
  );
  if (g.provider === "google") {
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
  if (g.provider === "meta") {
    requireThat(g.pageId && /^\d+$/.test(g.pageId), "meta_page_required");
    return {
      provider: g.provider,
      imageDigest: image.digest,
      campaign: {
        name: m.name,
        objective: "OUTCOME_TRAFFIC",
        special_ad_categories: [],
        status: "PAUSED",
      },
      adset: {
        name: m.name,
        billing_event: "IMPRESSIONS",
        optimization_goal: "LINK_CLICKS",
        bid_strategy: "LOWEST_COST_WITHOUT_CAP",
        lifetime_budget: String(m.budget.minor),
        start_time: m.startAt,
        end_time: m.endAt,
        status: "PAUSED",
        targeting: {
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
        pageId: g.pageId,
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
  return {
    provider: g.provider,
    imageDigest: image.digest,
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
      dailyBudgetCents: m.budget.minor,
      startAt: Date.parse(m.startAt),
      endAt: Date.parse(m.endAt),
      objectiveType: "WEBSITE_VISITS",
      format: "SINGLE_IMAGE",
      unitCostAmount: "0.10",
      audienceExpansionEnabled: false,
      offsiteDeliveryEnabled: false,
      targetingCriteria: {
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
  }
  async verify(
    g: Grant,
    campaign?: Campaign,
    assets: Asset[] = [],
  ): ReturnType<ProviderPort["verify"]> {
    return await this.use(g, async (client) => {
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
        accountId: v.account.id,
        currency: v.account.currency,
        timezone: v.account.timezoneName,
        permissions,
      };
    });
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
    const plan: any = this.plan(c, g, assets);
    const ids: Record<string, string> = {};
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
        await beforeWrite();
        const image = await client.uploadImage(g.accountId, {
          bytesBase64: (await this.bytes(c.projectId, assets[0]!)).toString(
            "base64",
          ),
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
        const creative = await client.request(`${g.accountId}/adcreatives`, {
          method: "POST",
          body: {
            name: c.material.name,
            object_story_spec: {
              page_id: g.pageId,
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
    if (this.name === "meta") {
      requireThat(
        ids.adset && ids.creative && ids.ad,
        "incomplete_provider_identity",
      );
      const campaign = await client.getObject(
        ids.campaign,
        "id,objective,special_ad_categories,status",
      );
      const adset = await client.getObject(
        ids.adset,
        "id,campaign_id,billing_event,optimization_goal,bid_strategy,lifetime_budget,start_time,end_time,targeting,status",
      );
      const creative = await client.getObject(
        ids.creative,
        "id,object_story_spec",
      );
      const ad = await client.getObject(ids.ad, "id,adset_id,creative,status");
      const statuses = [campaign.status, adset.status, ad.status];
      delete campaign.status;
      delete adset.status;
      delete ad.status;
      return {
        material: {
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
      const rawPost = expanded.inlineContent?.post;
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
          group: pick(group, ["totalBudget", "runSchedule"]),
          campaign: pick(campaign, [
            "account",
            "campaignGroup",
            "associatedEntity",
            "targetingCriteria",
            "dailyBudget",
            "runSchedule",
            "audienceExpansionEnabled",
            "offsiteDeliveryEnabled",
            "unitCost",
            "objectiveType",
            "type",
          ]),
          creative: pick(creative, ["campaign", "content"]),
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
          }) &&
          s.adset.campaign_id === ids.campaign &&
          s.ad.adset_id === ids.adset &&
          s.ad.creative?.id === ids.creative &&
          subset(s.creative.object_story_spec, {
            page_id: plan.creative.pageId,
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
      requireThat(
        subset(s.group.totalBudget, {
          amount: (plan.group.totalBudgetCents / 100).toFixed(2),
          currencyCode: plan.group.currencyCode,
        }) &&
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
    return await this.use(g, async (client) => {
      const before = await this.snapshot(client, g, ids);
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
    // Provider reporting is date-based. Reject partial local days rather than
    // silently widening requested windows or mixing account timezones.
    requireThat(
      dateInZone(from, g.timezone).endsWith("00:00:00") &&
        dateInZone(until, g.timezone).endsWith("00:00:00"),
      "provider_report_requires_local_midnights",
    );
    const since = dateInZone(from, g.timezone).slice(0, 10),
      through = dateInZone(
        new Date(Date.parse(until) - 1).toISOString(),
        g.timezone,
      ).slice(0, 10);
    const values = await this.use(g, async (client) => {
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
        r[key] === null ||
        r[key] === undefined ||
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
