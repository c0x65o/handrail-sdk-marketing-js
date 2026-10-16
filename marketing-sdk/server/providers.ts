import { materialCurrency, materialEndTime } from "../core/index.js";
import { countryPage, countryCode } from "./countries.js";
import { currentPrerequisite, storedCredentialBinding } from "./preflight.js";
import type { DiscoveredAccount, DiscoveredIdentity } from "./connection-discovery.js";
import { selectedOptions } from "../core/index.js";
import { validateAccountStructure, validateAccountCapability, metaTargeting, linkedInTargeting, metaExpansionOff, metaExpansionMatches, exactTargeting, exactLinkedInTargeting } from "./capabilities.js";
import type {
  Asset,
  Campaign,
  Grant,
  Metrics,
  Permission,
  Receipt,
} from "../core/index.js";
import type { ExistingCampaignInspection, ProviderPort } from "./ports.js";
import { digest, requireThat, Store, DomainError } from "./store.js";
import { collectProviderMeasurement, measurementAccountId } from "./measurement-collectors.js";
import { buildMeasurementEvidence } from "./measurement.js";
import { providerDayWindow } from "./reporting.js";
import { ConnectionDiscovery, connectionScopes } from "./connection-discovery.js";
import { material } from "./validation.js";
import { existingLinkedInMaterial, existingLinkedInChildren, type ExistingLinkedInMaterialSource } from "./existing-linkedin-material.js";
import { existingMetaMaterial, reconcileExistingMetaMaterial, META_EXISTING_FIELDS, type ExistingMetaMaterialSource, type ReconciledMetaMaterialSource } from "./existing-meta-material.js";
import { prepareMetaImageUpload } from "./meta-image.js";
import { existingMetaChildren } from "./existing-meta-children.js";
import { GoogleAdsClient } from "./google.js";
// Existing server-only clients; never imported by core or React.
import { MetaMarketingClient, accountPath } from "../support/owner-marketing/meta-client.js";
import { LinkedInMarketingClient } from "../support/owner-marketing/linkedin-client.js";
// Only structured provider status survives read failures; never raw error text or URLs.
function existingReadFailure(code:string,error:unknown) {
  const e=error as {code?:unknown;httpStatus?:unknown;statusCode?:unknown;providerCode?:unknown;providerSubcode?:unknown;retryAfterMs?:unknown};
  const integer=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:null;
  const reason=typeof e?.code==='string'&&['rate_limited','permission_error','disconnected','provider_unavailable'].includes(e.code)?e.code:'provider_read_failed';
  return Object.assign(new DomainError(code,reason==='rate_limited'?429:409),{providerReadDiagnostic:{reason,
    httpStatus:integer(e?.httpStatus),providerCode:integer(e?.providerCode),providerSubcode:integer(e?.providerSubcode),retryAfterMs:integer(e?.retryAfterMs)}});
}
export interface Credentials {
  accessToken: string;
  appSecret?: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  loginCustomerId?: string;
}
export interface VaultPort {
  /** Trusted host custody: inspect the exact grant's current credential/config
   * revision without returning secrets or doing network I/O. Presence selects
   * native prerequisite evidence for every grant, independent of its ID. Throw
   * on unavailable/revoked access; never fall back to an SDK vault record. */
  prerequisiteBinding?: (grant: Grant) => Promise<string>;
  useReadOnly?<T>(grant: Grant, guard: () => Promise<void>, action: (credentials: Credentials & { expiresAt: number; scopes: string[] }) => Promise<T>): Promise<T>;
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
  validateAccountStructure(c, g);
  const settings = m.settings;
  requireThat(
    g.currency === materialCurrency(m) && g.timezone === m.timezone,
    "account_context_mismatch",
  );
  if (g.provider === "google") {
    requireThat(!m.advertisingBudget?.daily, "google_daily_budget_unsupported");
    requireThat(m.budget && m.endAt, "google_lifetime_schedule_required");
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
      ...(ms ? { capabilityVersion: ms.version, accountId: g.accountId, readbackVersion: ms.creative || ms.attribution || ms.targeting.expansion ? "5" : "4" } : {}),
      imageDigest: image.digest,
      campaign: {
        name: m.name,
        ...(ms ? { is_adset_budget_sharing_enabled: false } : {}),
        objective: ms?.objective ?? "OUTCOME_TRAFFIC",
        special_ad_categories: ms?.delivery === "employment" ? ["EMPLOYMENT"] : [],
        ...(ms?.delivery === "employment" ? { special_ad_category_country: ["US"] } : {}),
        ...(m.advertisingBudget?.daily && m.budget ? { spend_cap: String(m.budget.minor) } : {}),
        status: "PAUSED",
      },
      adset: {
        name: m.name,
        billing_event: "IMPRESSIONS",
        optimization_goal: ms?.optimization ?? "LINK_CLICKS",
        ...(ms ? ms.objective === "OUTCOME_AWARENESS" ? { promoted_object: { page_id: ms.identity.pageId } } : { destination_type: "WEBSITE" } : {}),
        ...(ms?.delivery === "employment" ? { promoted_object: { pixel_id: ms.conversion!.pixelId, custom_conversion_id: ms.conversion && "customConversionId" in ms.conversion ? ms.conversion.customConversionId : undefined, ...(ms.conversion?.smartPseEnabled !== undefined ? {smart_pse_enabled:ms.conversion.smartPseEnabled} : {}) } } : {}),
        ...(ms?.conversion?.event === "Lead" ? { promoted_object: { pixel_id: ms.conversion.pixelId, custom_event_type: "LEAD", ...(ms.conversion.smartPseEnabled !== undefined ? {smart_pse_enabled:ms.conversion.smartPseEnabled} : {}) } } : {}),
        ...(ms?.attribution ? { attribution_spec: ms.attribution.map(x => ({event_type:x.eventType,window_days:x.windowDays})) } : {}),
        ...(ms?.targeting.expansion ? { targeting_optimization_types: { detailed_targeting: ms.targeting.expansion.detailedTargeting, lookalike: ms.targeting.expansion.lookalike } } : {}),
        bid_strategy: "LOWEST_COST_WITHOUT_CAP",
        ...(m.advertisingBudget?.daily ? { daily_budget: String(m.advertisingBudget.daily.minor) } : { lifetime_budget: String(m.budget!.minor) }),
        start_time: m.startAt,
        ...(m.endAt === null ? {} : { end_time: m.endAt }),
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
        ...(ms?.creative?.description !== undefined ? { description: ms.creative.description } : {}),
        ...(ms?.creative?.urlTags !== undefined ? { url_tags: ms.creative.urlTags } : {}),
        ...(ms?.creative?.features ? { degrees_of_freedom_spec: {creative_features_spec: Object.fromEntries(Object.entries(ms.creative.features).map(([k,v])=>[k,{enroll_status:v}]))} } : {}),
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
      // A newly created empty container can be ACTIVE while its campaign and
      // creative remain DRAFT. Campaign execution never changes group status.
      status: "ACTIVE",
      ...(m.budget ? { totalBudgetCents: m.budget.minor } : {}),
      currencyCode: materialCurrency(m),
      startAt: Date.parse(m.startAt),
      ...(m.endAt === null ? {} : { endAt: materialEndTime(m) }),
    },
    campaign: {
      name: m.name,
      organizationId: g.organizationId,
      currencyCode: materialCurrency(m),
      dailyBudgetCents: m.advertisingBudget.daily.minor,
      startAt: Date.parse(m.startAt),
      ...(m.endAt === null ? {} : { endAt: materialEndTime(m) }),
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
  /** Read the original campaign terms for adoption. No provider write, grant
   * persistence or capability approval; complete hierarchy inspection follows. */
  async captureExistingLinkedInMaterial(g: Grant, campaignId: string, source: ExistingLinkedInMaterialSource, guard: () => Promise<void>) {
    requireThat(this.name === "linkedin" && g.provider === "linkedin" && /^\d+$/.test(campaignId) && this.vault.useReadOnly,
      "existing_material_scope_invalid", 403);
    const scope = digest({g,campaignId,source});
    const current = async () => {
      await guard();
      requireThat(digest({g,campaignId,source}) === scope && !g.revokedAt && Date.parse(g.expiresAt) > Date.now(), "existing_campaign_scope_changed", 403);
    };
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      requireThat(url.origin === "https://api.linkedin.com" &&
        url.pathname === `/rest/adAccounts/${g.accountId}/adCampaigns/${campaignId}` &&
        (!init?.method || init.method === "GET") && init?.redirect === "error", "existing_campaign_read_only_boundary", 403);
      await current();
      const response = await this.fetcher(input, init);
      await current(); return response;
    };
    await current();
    return this.vault.useReadOnly!(g, current, async credentials => {
      requireThat(credentials.expiresAt > Date.now(), "provider_access_expired_or_denied", 403);
      const client = new LinkedInMarketingClient({...credentials,apiVersion:"202609",fetchImpl:fetcher});
      const campaign = await client.getCampaign(g.accountId,campaignId);
      requireThat(String(campaign.id) === campaignId && ["PAUSED","DRAFT"].includes(campaign.status), "existing_campaign_not_paused");
      const result = existingLinkedInMaterial(source,g,campaign);
      await current();
      return {...result,providerCampaignDigest:digest(campaign),observedAt:new Date().toISOString(),executionReady:false as const};
    }).catch(async error => {
      await current();
      if (error instanceof DomainError) throw error;
      throw existingReadFailure("existing_campaign_read_unavailable",error);
    });
  }
  /** State/identity evidence for historical effect reconciliation. Material,
   * historical request coverage and authority are deliberately separate facts. */
  async inspectExistingMetaHierarchy(g: Grant, ids: {campaign:string; adset:string; ad:string; creative:string}, guard: () => Promise<void>) {
    requireThat(this.name==="meta" && g.provider==="meta" && this.vault.useReadOnly &&
      Object.keys(ids).length===4 && [ids.campaign,ids.adset,ids.ad,ids.creative].every(x=>typeof x==="string"&&/^\d+$/.test(x)),
      "existing_campaign_identity_invalid",422);
    const scope=digest({g,ids}),account=accountPath(g.accountId);
    const current=async()=>{await guard();requireThat(digest({g,ids})===scope&&!g.revokedAt&&Date.parse(g.expiresAt)>Date.now(),"existing_campaign_scope_changed",403);};
    const allowed=[account,ids.campaign,`${ids.campaign}/adsets`,`${ids.campaign}/ads`].map(x=>`/v26.0/${x}`);
    const fetcher:typeof fetch=async(input,init)=>{
      const url=new URL(String(input));
      requireThat(url.origin==="https://graph.facebook.com"&&allowed.includes(url.pathname)&&
        (!init?.method||init.method==="GET")&&init?.redirect==="error","existing_campaign_read_only_boundary",403);
      await current();const response=await this.fetcher(input,init);await current();return response;
    };
    await current();
    return this.vault.useReadOnly!(g,current,async credentials=>{
      requireThat(credentials.expiresAt>Date.now(),"provider_access_expired_or_denied",403);
      const client=new MetaMarketingClient({...credentials,fetchImpl:fetcher});
      const accountContext=await this.accountContext(client,g);
      const campaign=await client.getObject(ids.campaign,"id,account_id,status,effective_status");
      requireThat(campaign.id===ids.campaign&&campaign.account_id===account.slice(4),"existing_campaign_account_mismatch");
      requireThat(campaign.status==="PAUSED"&&campaign.effective_status==="PAUSED","existing_campaign_not_paused");
      const children=await existingMetaChildren(client,g.accountId,ids);
      const snapshot={account:accountContext,campaign:{id:campaign.id,accountId:campaign.account_id,
        status:campaign.status,effectiveStatus:campaign.effective_status},...children};
      await current();
      return {provider:"meta" as const,source:"provider_api" as const,snapshot,digest:digest(snapshot),
        observedAt:new Date().toISOString(),inventoryComplete:true as const,allPaused:true as const,
        scope:"exact_campaign_and_complete_children" as const,historicalEffectsSettled:false as const,
        materialVerified:false as const,executionTransferred:false as const,spendingAuthorityGranted:false as const};
    }).catch(async error=>{await current();if(error instanceof DomainError)throw error;throw existingReadFailure("existing_campaign_read_unavailable",error);});
  }
  /** Capture original Meta acquisition terms without writes, persistence or authority expansion. */
  async captureExistingMetaMaterial(g: Grant, ids: {campaign:string; adset:string; creative:string; image:string}, source: ExistingMetaMaterialSource, guard: () => Promise<void>) {
    return this.captureMetaMaterial(g,ids,source,guard,observed=>existingMetaMaterial(source,g,ids,observed));
  }
  async reconcileExistingMetaMaterial(g:Grant,ids:{campaign:string;adset:string;creative:string;image?:string},source:ReconciledMetaMaterialSource,guard:()=>Promise<void>){
    return this.captureMetaMaterial(g,ids,source,guard,observed=>reconcileExistingMetaMaterial(source,g,ids,observed));
  }
  private async captureMetaMaterial<T extends object>(g:Grant,ids:{campaign:string;adset:string;creative:string;image?:string},source:unknown,guard:()=>Promise<void>,
    build:(observed:{campaign:any;adset:any;creative:any})=>T){
    requireThat(this.name === "meta" && g.provider === "meta" && this.vault.useReadOnly &&
      [ids.campaign,ids.adset,ids.creative].every(x=>typeof x==="string"&&/^\d+$/.test(x)) &&
      (ids.image===undefined||typeof ids.image==="string"&&/^[a-f0-9]{32}$/.test(ids.image)), "existing_material_scope_invalid", 403);
    const scope=digest({g,ids,source});
    const current=async()=>{await guard();requireThat(digest({g,ids,source})===scope&&!g.revokedAt&&Date.parse(g.expiresAt)>Date.now(),"existing_campaign_scope_changed",403);};
    const paths=[accountPath(g.accountId),ids.campaign,ids.adset,ids.creative].map(x=>`/v26.0/${x}`);
    const fetcher:typeof fetch=async(input,init)=>{
      const url=new URL(String(input));
      requireThat(url.origin==="https://graph.facebook.com"&&paths.includes(url.pathname)&&
        (!init?.method||init.method==="GET")&&init?.redirect==="error","existing_campaign_read_only_boundary",403);
      await current();const response=await this.fetcher(input,init);await current();return response;
    };
    await current();
    return this.vault.useReadOnly!(g,current,async credentials=>{
      requireThat(credentials.expiresAt>Date.now(),"provider_access_expired_or_denied",403);
      const client=new MetaMarketingClient({...credentials,fetchImpl:fetcher});
      await this.accountContext(client,g);
      const observed={campaign:await client.getObject(ids.campaign,META_EXISTING_FIELDS.campaign),
        adset:await client.getObject(ids.adset,META_EXISTING_FIELDS.adset),
        creative:await client.getObject(ids.creative,META_EXISTING_FIELDS.creative)};
      const result=build(observed);await current();
      return {...result,providerMaterialDigest:digest(observed),observedAt:new Date().toISOString(),executionReady:false as const,
        missingReasons:["original_media_content_binding_unverified","execution_ownership_not_transferred"]};
    }).catch(async error=>{await current();if(error instanceof DomainError)throw error;throw existingReadFailure("existing_campaign_read_unavailable",error);});
  }
  /** Account-scoped current provider image metadata. Never claims original binary
   * upload bytes from a provider hash/name, and never retrieves a signed CDN URL. */
  async inspectExistingMetaImage(g: Grant, imageId: string, guard: () => Promise<void>) {
    requireThat(this.name==="meta"&&g.provider==="meta"&&this.vault.useReadOnly&&/^[a-f0-9]{32}$/.test(imageId),"existing_media_scope_invalid",403);
    const scope=digest({g,imageId}),account=accountPath(g.accountId);
    const current=async()=>{await guard();requireThat(digest({g,imageId})===scope&&!g.revokedAt&&Date.parse(g.expiresAt)>Date.now(),"existing_campaign_scope_changed",403);};
    const fetcher:typeof fetch=async(input,init)=>{
      const url=new URL(String(input));
      requireThat(url.origin==="https://graph.facebook.com"&&[`/v26.0/${account}`,`/v26.0/${account}/adimages`].includes(url.pathname)&&
        (!init?.method||init.method==="GET")&&init?.redirect==="error","existing_campaign_read_only_boundary",403);
      if(url.pathname.endsWith('/adimages'))requireThat(url.searchParams.get('hashes')===JSON.stringify([imageId]),"existing_media_scope_invalid",403);
      await current();const response=await this.fetcher(input,init);await current();return response;
    };
    await current();
    return this.vault.useReadOnly!(g,current,async credentials=>{
      requireThat(credentials.expiresAt>Date.now(),"provider_access_expired_or_denied",403);
      const client=new MetaMarketingClient({...credentials,fetchImpl:fetcher});await this.accountContext(client,g);
      const result=await client.readAllPages(`${account}/adimages`,{hashes:JSON.stringify([imageId]),fields:"id,account_id,hash,name,original_width,original_height,status,updated_time",limit:200});
      requireThat(result.data.length===1,"existing_media_identity_ambiguous");const row=result.data[0];
      requireThat(row.hash===imageId&&String(row.account_id)===account.replace(/^act_/,""),"existing_media_identity_mismatch");
      requireThat(Number.isSafeInteger(row.original_width)&&row.original_width>0&&Number.isSafeInteger(row.original_height)&&row.original_height>0&&
        typeof row.name==="string"&&typeof row.status==="string","existing_media_metadata_incomplete");
      const image={accountId:String(row.account_id),hash:row.hash,name:row.name,width:row.original_width,height:row.original_height,status:row.status,updatedAt:row.updated_time??null};
      await current();return {image,providerSnapshotDigest:digest(image),observedAt:new Date().toISOString(),
        originalUploadBytesVerified:false as const,providerImageReadbackVerified:true as const,executionTransferred:false as const,spendingAuthorityGranted:false as const};
    }).catch(async error=>{await current();if(error instanceof DomainError)throw error;throw existingReadFailure("existing_media_read_unavailable",error);});
  }
  private async use<T>(g: Grant, fn: (client: any) => Promise<T>) {
    requireThat(g.provider === this.name, "provider_mismatch");
    try {
      // A newer check cannot authorize a client that captured older credentials.
      // Keep the envelope fingerprint private and fixed for this entire use.
      const sealed = this.vault.prerequisiteBinding || this.name === "meta" && g.id.startsWith("connection:")
        ? await this.credentialBinding(g) : null;
      const assertCustody = async () => {
        if (!sealed) return;
        requireThat(await this.credentialBinding(g) === sealed &&
          digest(await this.store.get(g.projectId, "grant", g.id)) === digest(g) &&
          !g.revokedAt && Date.parse(g.expiresAt) > Date.now(), "provider_custody_changed");
      };
      const fetcher: typeof fetch = async (input, init) => {
        await assertCustody();
        const response = await this.fetcher(input, init);
        // A write may have succeeded: let its caller retain returned object IDs
        // before fencing the next request or final readback.
        if (!init?.method || init.method === "GET") await assertCustody();
        return response;
      };
      return await this.vault.use(g, async (credentials) => {
        await assertCustody();
        const result = await fn(
          this.name === "meta"
            ? new MetaMarketingClient({
                ...credentials,
                fetchImpl: fetcher,
              })
            : this.name === "linkedin"
              ? new LinkedInMarketingClient({
                  ...credentials,
                  apiVersion: "202609",
                  fetchImpl: fetcher,
                })
              : new GoogleAdsClient(
                  async () => credentials.accessToken,
                  credentials.loginCustomerId,
                  fetcher,
                ),
        );
        await assertCustody();
        return result;
      });
    } catch (error) {
      // Never expose provider bodies, request configuration or credential resolver errors.
      // Partial object IDs have already been retained inside prepare's write boundary.
      if (error instanceof DomainError) throw error;
      const failure = error as { code?: unknown; verificationReason?: unknown; providerStatus?: unknown };
      const tokenReasons = ["token_inactive", "token_active_unverified", "token_changed", "token_status_unverified", "token_client_mismatch", "token_auth_type_unverified", "token_expiry_unverified"];
      if (failure?.code === "verification_failed" && typeof failure.verificationReason === "string" && tokenReasons.includes(failure.verificationReason))
        throw new DomainError(`provider_${failure.verificationReason}`, 403);
      throw new DomainError("provider_request_failed", 502);
    }
  }
  async searchCountries(g: Grant, query: string, after: string | undefined, guard: () => Promise<void>) {
    requireThat(this.name === "meta" && g.provider === "meta" && this.vault.useReadOnly, "country_search_unsupported");
    const sealed = await this.credentialBinding(g);
    const current = async () => {
      await guard();
      requireThat(await this.credentialBinding(g) === sealed &&
        digest(await this.store.get(g.projectId, "grant", g.id)) === digest(g), "provider_custody_changed");
    };
    try {
      return await this.vault.useReadOnly(g, current, async credentials => {
        requireThat(connectionScopes("meta", ["prepare"]).every(x => credentials.scopes.includes(x)), "provider_scope_missing");
        const fetcher: typeof fetch = async (input, init) => {
          const url = new URL(String(input));
          requireThat(url.origin === "https://graph.facebook.com" && url.pathname === "/v26.0/search" &&
            init?.method === "GET" && init.redirect === "error", "country_search_read_only_boundary");
          await current(); const response = await this.fetcher(input, init); await current(); return response;
        };
        const result = countryPage(await new MetaMarketingClient({ ...credentials, fetchImpl: fetcher }).searchCountries(query, after));
        await current(); return result;
      });
    } catch (error) { if (error instanceof DomainError) throw error; throw new DomainError("country_search_unavailable", 502); }
  }
  /** Search observations cannot substitute for this fresh exact selected-key proof. */
  async resolveCountries(g: Grant, codes: string[], guard: () => Promise<void>) {
    requireThat(codes.length > 0 && codes.length <= 20 && new Set(codes).size === codes.length && codes.every(countryCode), "selected_country_unresolved");
    const result: { code: string; label: string }[] = [];
    const began = Date.now();
    for (const code of codes) {
      requireThat(Date.now() - began < 30000, "country_resolution_deadline");
      const page = await this.searchCountries(g, code, undefined, guard);
      requireThat(Date.now() - began < 30000, "country_resolution_deadline");
      const exact = page.countries.find(c => c.code === code);
      // Absence in even a partial result is unresolved, never permission to delete.
      requireThat(exact, "selected_country_unresolved"); result.push(exact);
    }
    return result;
  }
  /** SDK-owned read-only producer. It does not call verify(), which consumes
   * existing proof. Each provider verifies its supported material and authority. */
  /** Current account membership for host-owned custody. This read does not issue
   * a grant, qualify publishing identities, or authorize any provider effect.
   * Hosts retain the observed member/role facts for the later exact-plan check. */
  async discoverCampaignAccount(g: Grant, guard: () => Promise<void>): Promise<DiscoveredAccount> {
    requireThat(this.name === g.provider && ["meta", "linkedin"].includes(g.provider), "provider_account_context_changed");
    requireThat(this.vault.useReadOnly, "read_only_credential_custody_required");
    return this.vault.useReadOnly(g, guard, async credentials => {
      const discovery = new ConnectionDiscovery(this.fetcher);
      const accounts: DiscoveredAccount[] = [], cursors = new Set<string>(), observed = new Set<string>();
      let cursor: string | undefined;
      for (let n = 0; n < 40; n++) {
        const page = await discovery.accounts(g.provider, credentials, cursor, guard, observed);
        accounts.push(...page.rows);
        if (!page.next) { cursor = undefined; break; }
        requireThat(!cursors.has(page.next), "provider_discovery_incomplete");
        cursors.add(page.next); cursor = page.next;
      }
      requireThat(!cursor, "provider_discovery_incomplete");
      requireThat(new Set(accounts.map(a => a.id)).size === accounts.length, "provider_discovery_conflict");
      const account = accounts.find(a => a.id === g.accountId);
      requireThat(account && account.currency === g.currency && account.timezone === g.timezone &&
        (g.provider !== "linkedin" || account.organizationId === g.organizationId), "provider_account_context_changed");
      await guard();
      return account;
    });
  }

  async inspectPrerequisites(c: Campaign, g: Grant, assets: Asset[], account: DiscoveredAccount,
    identities: DiscoveredIdentity[], guard: () => Promise<void>) {
    this.plan(c, g, assets);
    const s = c.material.settings;
    if (s?.provider === "linkedin") return this.inspectLinkedInPrerequisites(c, g, account, identities, guard);
    requireThat(s?.provider === "meta" && s.delivery === "ordinary" && s.objective === "OUTCOME_TRAFFIC" && s.optimization === "LINK_CLICKS",
      "campaign_prerequisite_tuple_unqualified", 422);
    requireThat(!s.targeting.languages.length, "targeting_catalogue_required", 422);
    requireThat(this.vault.useReadOnly, "read_only_credential_custody_required");
    const guardedFetch: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      requireThat(url.origin === "https://graph.facebook.com" && url.pathname.startsWith("/v26.0/") &&
        (!init?.method || init.method === "GET") && init?.redirect === "error", "prerequisite_read_only_boundary");
      await guard(); const response = await this.fetcher(input, init); await guard(); return response;
    };
    const countries = await this.resolveCountries(g, c.material.audience.locations, guard);
    try {
      return await this.vault.useReadOnly(g, guard, async credentials => {
        requireThat(connectionScopes("meta", ["prepare"]).every(x => credentials.scopes.includes(x)), "provider_scope_missing");
        const discovered = await new ConnectionDiscovery(guardedFetch).verify("meta", credentials, account, identities, ["prepare"], guard);
        const client = new MetaMarketingClient({ ...credentials, fetchImpl: guardedFetch });
        await this.verifySettings(client, c, g);
        const v = await client.verifyConnection({ adAccountId: g.accountId, pageId: g.pageId, pixelId: undefined });
        requireThat(v.account.id === accountPath(g.accountId) && v.account.currency === g.currency && v.account.timezoneName === g.timezone,
          "provider_account_context_changed");
        requireThat(v.account.accountStatus === 1 && v.account.disableReason === 0 && v.paymentReady && v.fundingSourceObserved,
          "provider_account_status_or_billing_unverified");
        requireThat(v.permissions.adsManagement && v.assets.page.accessible && v.assets.page.id === g.pageId,
          "provider_page_or_scope_unverified");
        await guard();
        return { expiresAt: credentials.expiresAt, facts: ["Current account membership and advertising role checked", "Current required scopes checked",
          "Active account and billing signal observed", "Exact account currency and timezone checked", "Selected Page and Instagram relationship checked",
          "Exact material, destination, media bytes and requested budget terms checked", `Selected countries freshly resolved: ${countries.map(c => c.label).join(", ")}`],
          checkedFacts: { provider: "meta", apiVersion: "v26.0", countries, accountId: discovered.id, currency: discovered.currency,
            timezone: discovered.timezone, role: discovered.roleSummary, permissions: discovered.permissions,
            requiredScopes: connectionScopes("meta", ["prepare"]), accountStatus: v.account.accountStatus, disableReason: v.account.disableReason,
            fundingSourceObserved: v.fundingSourceObserved, pageId: v.assets.page.id, instagramUserId: s.identity.instagramUserId ?? null,
            acceptance: "prerequisites_only", uploads: 0, advertisingWrites: 0 }, account: discovered };
      });
    } catch (error) { if (error instanceof DomainError) throw error; throw new DomainError("provider_prerequisite_read_unavailable", 502); }
  }
  private async inspectLinkedInPrerequisites(c: Campaign, g: Grant, account: DiscoveredAccount,
    identities: DiscoveredIdentity[], guard: () => Promise<void>) {
    requireThat(this.name === "linkedin" && g.provider === "linkedin" && g.timezone === "UTC", "linkedin_utc_required", 422);
    requireThat(this.vault.useReadOnly, "read_only_credential_custody_required");
    const guardedFetch: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      const read = url.origin === "https://api.linkedin.com" && url.pathname.startsWith("/rest/") &&
        (!init?.method || init.method === "GET");
      const introspection = url.origin === "https://www.linkedin.com" && url.pathname === "/oauth/v2/introspectToken" && init?.method === "POST";
      requireThat((read || introspection) && init?.redirect === "error", "prerequisite_read_only_boundary");
      await guard(); const response = await this.fetcher(input, init); await guard(); return response;
    };
    try {
      return await this.vault.useReadOnly(g, guard, async credentials => {
        requireThat(connectionScopes("linkedin", ["prepare"]).every(x => credentials.scopes.includes(x)), "provider_scope_missing");
        const discovered = await new ConnectionDiscovery(guardedFetch).verify("linkedin", credentials, account, identities, ["prepare"], guard);
        const client = new LinkedInMarketingClient({ ...credentials, apiVersion: "202609", fetchImpl: guardedFetch });
        await this.verifySettings(client, c, g);
        const v = await client.verifyConnection({ adAccountId: g.accountId, organizationId: g.organizationId });
        requireThat(v.account.id === g.accountId && v.account.currency === g.currency && v.account.timezoneName === g.timezone,
          "provider_account_context_changed");
        requireThat(v.paymentReady && v.permissions.adsManagement && v.assets.organization.matchesAccountReference,
          "provider_account_status_or_billing_unverified");
        await guard();
        return { expiresAt: credentials.expiresAt, facts: ["Current account membership and campaign role checked", "Current token scopes checked",
          "Selected account-associated Page and member role checked", "Account status and serving readiness checked",
          "Account currency and UTC reporting policy checked", "Selected targeting and exact campaign material checked"],
          checkedFacts: { provider: "linkedin", apiVersion: "202609", accountId: discovered.id, currency: discovered.currency,
            timezone: discovered.timezone, role: discovered.roleSummary, permissions: discovered.permissions,
            requiredScopes: connectionScopes("linkedin", ["prepare"]), accountStatus: v.account.status,
            servingStatuses: v.account.servingStatuses, organizationId: g.organizationId,
            acceptance: "prerequisites_only", uploads: 0, advertisingWrites: 0 }, account: discovered };
      });
    } catch (error) { if (error instanceof DomainError) throw error; throw new DomainError("provider_prerequisite_read_unavailable", 502); }
  }
  async credentialBinding(g: Grant): Promise<string> {
    const binding = this.vault.prerequisiteBinding
      ? await this.vault.prerequisiteBinding(g) : await storedCredentialBinding(this.store, g);
    requireThat(typeof binding === 'string' && binding.length > 0 && binding.length <= 500, 'credential_binding_invalid');
    return binding;
  }
  private async prerequisite(c: Campaign, g: Grant) {
    if (!this.vault.prerequisiteBinding && !g.id.startsWith("connection:")) { validateAccountCapability(c, g, true); return; }
    validateAccountCapability(c, g);
    const assets = await Promise.all(c.material.assetIds.map(id => this.store.get<Asset>(c.projectId, "asset", id)));
    await currentPrerequisite(this.store, c, g, this.plan(c, g, assets), Date.now(), await this.credentialBinding(g));
  }
  async verify(
    g: Grant,
    campaign?: Campaign,
    assets: Asset[] = [],
    intent?: Permission,
  ): ReturnType<ProviderPort["verify"]> {
    requireThat(intent === "pause" || this.name !== "linkedin" || g.timezone === "UTC", "linkedin_utc_required", 422);
    if (campaign && intent !== "pause") await this.prerequisite(campaign, g);
    return await this.use(g, async (client) => {
      if (campaign?.material.settings && intent !== "pause") await this.verifySettings(client, campaign, g);
      if (this.name === "meta" && intent === "pause") {
        // Safety pause requires current account advertising custody, not billing
        // or publication Page readiness. Re-enumerate all pages and roles under
        // the same credential before admitting the existing SDK pause executor.
        const expected: DiscoveredAccount = {id:accountPath(g.accountId),label:g.label ?? g.accountId,
          businessLabel:null,currency:g.currency,timezone:g.timezone,timezoneSource:"provider_account",
          roleSummary:"",limitations:[],permissions:[]};
        const actual=await new ConnectionDiscovery(this.fetcher).verify("meta",
          {accessToken:client.accessToken,appSecret:client.appSecret},expected,[],["pause"],async()=>{});
        return {accountId:g.accountId,currency:actual.currency,timezone:actual.timezone,
          timezoneSource:"provider_account" as const,permissions:["pause","report"] as Permission[]};
      }
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
      if (this.name === "linkedin") return {
        accountId: g.accountId, currency: v.account.currency, timezone: v.account.timezoneName,
        timezoneSource: "provider_reporting_and_budget_policy",
        permissions: await this.linkedInPermissions(client, g, v, undefined, intent),
      };
      const permissions: Permission[] = ["setup"];
      if (v.permissions.adsRead) permissions.push("report");
      if (
        v.permissions.adsManagement &&
        v.paymentReady &&
        v.assets.page.accessible
      )
        permissions.push("prepare", "activate", "pause");
      return {
        accountId: g.accountId, // Return the grant spelling only after observed identity comparison.
        timezoneSource: "provider_account",
        currency: v.account.currency,
        timezone: v.account.timezoneName,
        permissions,
      };
    });
  }
  /** Reuse the Connections finder/ACL contract at the native operation boundary.
   * Scopes alone never establish account/Page roles. Page denial leaves separately
   * verified reporting and safety-pause access available. */
  private async linkedInPermissions(client: any, g: Grant, verified?: any, guard: () => Promise<void> = async () => {}, intent?: Permission) {
    await guard();
    const v = verified ?? await client.verifyConnection({ adAccountId: g.accountId, organizationId: g.organizationId });
    await guard();
    requireThat(v.account.id === g.accountId && v.account.currency === g.currency, "provider_account_context_changed");
    const credentials = { accessToken: client.accessToken, clientId: client.clientId, clientSecret: client.clientSecret };
    // Keep discovery on the client's sealed credential transport as well as
    // the actor read guard. Raw discovery must not escape custody rechecks.
    const discovery = new ConnectionDiscovery(client.fetchImpl);
    const accounts = await discovery.accounts("linkedin", credentials, undefined, guard);
    const account = accounts.rows.find(a => a.id === g.accountId);
    requireThat(account && account.currency === g.currency, "provider_account_role_missing");
    const permissions: Permission[] = ["setup"];
    const scopes = await discovery.linkedinScopes(credentials, [], guard);
    if (scopes.includes("r_ads_reporting") && (scopes.includes("r_ads") || scopes.includes("rw_ads"))) permissions.push("report");
    if (scopes.includes("rw_ads") && account.permissions.includes("pause")) permissions.push("pause");
    if (intent !== "report" && intent !== "pause" && g.organizationId && account.organizationId === g.organizationId && v.assets.organization.matchesAccountReference &&
        v.paymentReady && account.permissions.includes("prepare") && connectionScopes("linkedin", ["prepare"]).every(s => scopes.includes(s))) {
      try {
        await discovery.identities("linkedin", credentials, account, undefined, guard);
        await discovery.linkedinScopes(credentials, connectionScopes("linkedin", ["prepare"]), guard);
        permissions.push("prepare", "activate");
      } catch (error) {
        if (!(error instanceof DomainError) || !["provider_page_role_missing", "provider_member_mismatch", "provider_identity_mismatch", "provider_access_expired_or_denied", "provider_scope_missing"].includes(error.code)) throw error;
      }
    }
    // Recheck even after Page denial; cached exchange scope cannot override loss.
    const finalScopes = await discovery.linkedinScopes(credentials, [], guard);
    await guard();
    return permissions.filter(p => p === "setup" || (p === "report"
      ? finalScopes.includes("r_ads_reporting") && (finalScopes.includes("r_ads") || finalScopes.includes("rw_ads"))
      : connectionScopes("linkedin", [p]).every(s => finalScopes.includes(s))));
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
      if (s.conversion?.event === "ApplicantRequestMOU") {
        const conversion = await client.getObject(s.conversion.customConversionId, "id,account_id,pixel,rule");
        let rule; try { rule = typeof conversion.rule === "string" ? JSON.parse(conversion.rule) : conversion.rule; } catch { rule = null; }
        requireThat(String(conversion.id) === s.conversion.customConversionId && String(conversion.account_id) === g.accountId.replace(/^act_/, "") &&
          String(conversion.pixel?.id) === s.conversion.pixelId && exactTargeting(rule, { and: [{ event: { eq: "ApplicantRequestMOU" } }] }), "applicant_event_binding_unverified");
      }
      if (s.conversion?.event === "Lead") {
        const pixel = await client.getObject(s.conversion.pixelId, "id,owner_ad_account");
        requireThat(String(pixel.id) === s.conversion.pixelId && String(pixel.owner_ad_account?.id) === g.accountId.replace(/^act_/, ""), "lead_pixel_ownership_unverified");
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
  validateUpdate(c: Campaign, g: Grant, assets: Asset[]) {
    requireThat(this.name === "meta" || this.name === "linkedin", "existing_campaign_update_unavailable");
    requireThat(c.receipt?.intent === "paused" && c.receipt.ids.readbackDigest && c.preparedMaterial,
      "paused_verified_material_required");
    const previous = c.preparedMaterial;
    const oldPlan = this.plan({ ...c, material: previous }, g, assets);
    requireThat(digest(oldPlan) === c.receipt.payloadDigest, "prepared_material_binding_changed");
    const normalized = structuredClone(c.material);
    // Only qualified budget fields are mutable in this update contract. Shared
    // group budgets, creatives, targeting and schedules cannot be recreated.
    if (this.name === "meta") {
      requireThat(!previous.advertisingBudget?.daily && !normalized.advertisingBudget?.daily,
        "meta_daily_budget_update_unqualified");
      requireThat(normalized.budget && previous.budget, "lifetime_budget_required");
      normalized.budget.minor = previous.budget.minor;
      if (normalized.advertisingBudget?.lifetime && previous.advertisingBudget?.lifetime)
        normalized.advertisingBudget.lifetime.minor = previous.advertisingBudget.lifetime.minor;
    } else {
      requireThat(previous.advertisingBudget?.daily && normalized.advertisingBudget?.daily,
        "linkedin_explicit_daily_budget_required");
      normalized.advertisingBudget.daily.minor = previous.advertisingBudget.daily.minor;
    }
    requireThat(digest(normalized) === digest(previous), "existing_campaign_edit_unqualified");
    this.plan(c, g, assets);
  }
  async update(c: Campaign, g: Grant, assets: Asset[],
    retain: (ids: Record<string, string>) => void | Promise<void>, beforeWrite: () => void | Promise<void>,
    beforeRead: () => void | Promise<void> = beforeWrite) {
    this.validateUpdate(c, g, assets);
    const plan: any = this.plan(c, g, assets);
    const scope = digest({ c, g, assets });
    const readGuard = async () => {
      await beforeRead();
      requireThat(digest({ c, g, assets }) === scope, "provider_scope_changed");
    };
    const guard = async () => {
      await beforeWrite();
      requireThat(digest({ c, g, assets }) === scope, "provider_scope_changed");
      await this.prerequisite(c, g);
    };
    await guard();
    const { readbackDigest: previousDigest, ...ids } = c.receipt!.ids;
    return this.use(g, async client => {
      if (this.name === "linkedin") client.beforeWrite = async () => {
        requireThat((await this.linkedInPermissions(client, g, undefined, readGuard, "prepare")).includes("prepare"), "provider_capability_missing");
        await guard();
      };
      await this.verifySettings(client, c, g);
      const before = await this.snapshot(client, g, ids);
      requireThat(before.paused, "existing_campaign_not_paused");
      requireThat(digest(before.material) === previousDigest, "external_material_changed");
      // Persist original identities without claiming the new material has been
      // observed. A lost acknowledgment is resolved by reads, never replay.
      await retain({ ...ids });
      await guard();
      if (c.receipt!.payloadDigest !== digest(plan)) {
        if (this.name === "meta") await client.request(ids.adset, {
          method: "POST", body: { lifetime_budget: plan.adset.lifetime_budget },
        });
        else await client.updateCampaignBudget(g.accountId, ids.campaign, plan.campaign.dailyBudgetCents, g.currency);
      }
      const after = await this.snapshot(client, g, ids);
      requireThat(after.paused, "existing_campaign_not_paused");
      this.validateSnapshot(after.material, plan, ids);
      await guard();
      const observed = { ...ids, readbackDigest: digest(after.material) };
      await retain(observed);
      return { ...this.receipt(observed, digest(plan), "paused"), providerRequestId: client.lastRequestId || null };
    });
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
    beforeRead: () => void | Promise<void> = beforeWrite,
  ) {
    requireThat(!c.receipt, "existing_campaign_requires_update");
    if (g.provider !== "google") requireThat(c.material.settings, "explicit_provider_settings_required", 422);
    const plan: any = this.plan(c, g, assets);
    await this.prerequisite(c, g);
    const hostBeforeWrite = beforeWrite;
    const scopeDigest = digest({ c, g });
    const readGuard = async () => {
      await beforeRead();
      requireThat(digest({ c, g }) === scopeDigest, "provider_scope_changed");
    };
    beforeWrite = async () => {
      await hostBeforeWrite();
      requireThat(digest({ c, g }) === scopeDigest, "provider_scope_changed");
      await this.prerequisite(c, g);
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
        client.beforeWrite = async () => {
          requireThat((await this.linkedInPermissions(client, g, undefined, readGuard, "prepare")).includes("prepare"), "provider_capability_missing");
          await beforeWrite();
        };
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
        const prepared = await prepareMetaImageUpload({bytes,mime:assets[0]!.mime,filename:`${key}.${assets[0]!.mime === "image/png" ? "png" : "jpg"}`});
        ids.imageUploadDigest = prepared.uploadDigest;
        await retain(ids);
        await beforeWrite();
        const image = await client.uploadImage(g.accountId, {
          bytesBase64: prepared.bytes.toString("base64"),
          filename: prepared.filename,
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
            ...(plan.creative.url_tags !== undefined ? {url_tags:plan.creative.url_tags} : {}),
            ...(plan.creative.degrees_of_freedom_spec ? {degrees_of_freedom_spec:plan.creative.degrees_of_freedom_spec} : {}),
            object_story_spec: {
              page_id: plan.creative.pageId,
              ...(plan.creative.instagramUserId ? { instagram_user_id: plan.creative.instagramUserId } : {}),
              link_data: {
                image_hash: ids.image,
                link: plan.creative.link,
                message: plan.creative.message,
                name: plan.creative.name,
                ...(plan.creative.description !== undefined ? {description:plan.creative.description} : {}),
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
  async inspectExistingCampaign(c: Campaign, g: Grant, assets: Asset[], providerIds: Record<string, string>, guard: () => Promise<void>): Promise<ExistingCampaignInspection> {
    requireThat(["meta", "linkedin"].includes(this.name) && g.provider === this.name && c.projectId === g.projectId && c.grantId === g.id,
      "existing_campaign_scope_mismatch", 403);
    requireThat(this.vault.useReadOnly, "read_only_credential_custody_required");
    const required = this.name === "meta" ? ["campaign", "adset", "creative", "ad", "image"] : ["group", "campaign", "creative", "image"];
    const allowed = this.name === "linkedin" ? [...required, "conversion"] : required;
    requireThat(providerIds && Object.keys(providerIds).every(k => allowed.includes(k)) && required.every(k => typeof providerIds[k] === "string" && providerIds[k]!.length > 0) &&
      Object.values(providerIds).every(v => typeof v === "string" && v.length > 0), "existing_campaign_identity_invalid", 422);
    // Readback versions/digests come from this SDK read, never supplied history.
    const ids: Record<string,string> = { ...providerIds, readbackVersion: this.name === "meta" ? "4" : "3",
      ...(this.name === "linkedin" ? { groupOwnership: "shared" } : {}) };
    const plan = this.plan(c, g, assets), scope = digest({c,g,assets,providerIds});
    if (this.name === "meta") ids.readbackVersion = (plan as any).readbackVersion ?? "4";
    const current = async () => {
      await guard();
      requireThat(digest({c,g,assets,providerIds}) === scope && !g.revokedAt && Date.parse(g.expiresAt) > Date.now(), "existing_campaign_scope_changed", 403);
    };
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      requireThat(url.origin === (this.name === "meta" ? "https://graph.facebook.com" : "https://api.linkedin.com") &&
        (!init?.method || init.method === "GET") && init?.redirect === "error", "existing_campaign_read_only_boundary", 403);
      await current();
      let response: Response;
      try { response = await this.fetcher(input, init); }
      catch(error) { throw existingReadFailure("existing_campaign_read_unavailable",error); }
      await current(); return response;
    };
    await current();
    return this.vault.useReadOnly<ExistingCampaignInspection>(g, current, async credentials => {
      requireThat(credentials.expiresAt > Date.now(), "provider_access_expired_or_denied", 403);
      const client = this.name === "meta" ? new MetaMarketingClient({...credentials,fetchImpl:fetcher})
        : new LinkedInMarketingClient({...credentials,apiVersion:"202609",fetchImpl:fetcher});
      const snapshot = await this.snapshot(client,g,ids);
      requireThat(snapshot.paused, "existing_campaign_not_paused");
      this.validateSnapshot(snapshot.material,plan,ids);
      const inventory=this.name==="linkedin" ? await existingLinkedInChildren(client,g.accountId,ids.campaign!,ids.creative!)
        : await existingMetaChildren(client as MetaMarketingClient,g.accountId,
          {campaign:ids.campaign!,adset:ids.adset!,ad:ids.ad!,creative:ids.creative!});
      await current();
      return {candidateReceipt:{...this.receipt({...ids,readbackDigest:digest(snapshot.material),...(inventory?{inventoryDigest:digest(inventory)}:{})},digest(plan),"paused"),
        providerRequestId:"lastRequestId" in client && typeof client.lastRequestId === "string" ? client.lastRequestId : null},
        originalMediaContentVerified:false,executionReady:false,
        missingReasons:["original_media_content_binding_unverified","execution_ownership_not_transferred"]};
    }).catch(async error => {
      // Client wrappers may translate a revoked guard into a transport error.
      // Recheck authority and never expose transport/credential error text.
      await current();
      if (error instanceof DomainError) throw error;
      throw existingReadFailure("existing_campaign_read_unavailable",error);
    });
  }
  private async snapshot(
    client: any,
    g: Grant,
    ids: Record<string, string>,
  ): Promise<{
    material: any;
    paused: boolean;
    enabled: boolean;
    groupStatus?: string;
  }> {
    requireThat(ids.campaign, "incomplete_provider_identity");
    requireThat(ids.readbackVersion === undefined || ["1", "2", "3"].includes(ids.readbackVersion) ||
      (this.name === "meta" && ["4", "5"].includes(ids.readbackVersion!)), "unsupported_readback_version");
    if (this.name === "meta") {
      // v4 extends every v3 identity/material check; historical field sets stay exact.
      const explicit = ["3", "4", "5"].includes(ids.readbackVersion!);
      const budgets = ["2", "3", "4", "5"].includes(ids.readbackVersion!);
      requireThat(
        ids.adset && ids.creative && ids.ad,
        "incomplete_provider_identity",
      );
      const campaign = await client.getObject(
        ids.campaign,
        budgets ? `id,objective,special_ad_categories,spend_cap,status${explicit ? ",account_id,special_ad_category_country" : ""}${["4", "5"].includes(ids.readbackVersion!) ? ",is_adset_budget_sharing_enabled" : ""}` : "id,objective,special_ad_categories,status",
      );
      const adset = await client.getObject(
        ids.adset,
        `id,campaign_id,billing_event,optimization_goal,bid_strategy,lifetime_budget,${budgets ? "daily_budget," : ""}start_time,end_time,targeting,status${explicit ? ",account_id,destination_type,promoted_object,targeting_optimization_types" : ""}${ids.readbackVersion === "5" ? ",attribution_spec" : ""}`,
      );
      const creative = await client.getObject(
        ids.creative,
        explicit ? `id,account_id,object_story_spec,asset_feed_spec${ids.readbackVersion === "5" ? ",url_tags,degrees_of_freedom_spec" : ""}` : "id,object_story_spec",
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
      const statuses = [campaign.status, creative.intendedStatus];
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
            ...(ids.groupOwnership === "shared" ? ["totalBudget"] : []),
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
        enabled: group.status === "ACTIVE" && statuses.every((x) => x === "ACTIVE"),
        groupStatus: group.status,
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
      if (["4", "5"].includes(plan.readbackVersion)) requireThat(ids.readbackVersion === plan.readbackVersion &&
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
        requireThat(s.creative.asset_feed_spec==null,"provider_asset_feed_unsupported");
        requireThat(exactTargeting(s.creative.object_story_spec, {
          page_id: plan.creative.pageId, ...(plan.creative.instagramUserId ? { instagram_user_id: plan.creative.instagramUserId } : {}),
          link_data: { image_hash: ids.image, link: plan.creative.link, message: plan.creative.message, name: plan.creative.name,
            ...(plan.creative.description !== undefined ? {description:plan.creative.description} : {}),
            call_to_action: { type: "LEARN_MORE", value: { link: plan.creative.link } } },
        }), "creative_identity_or_content_mismatch");
        if (plan.readbackVersion === "5") {
          requireThat(exactTargeting(s.creative.url_tags, plan.creative.url_tags) &&
            exactTargeting(s.creative.degrees_of_freedom_spec, plan.creative.degrees_of_freedom_spec), "creative_tracking_or_features_mismatch");
          if (plan.adset.targeting_optimization_types) requireThat(metaExpansionMatches(s.adset.targeting_optimization_types, plan.adset.targeting_optimization_types), "meta_expansion_settings_mismatch");
        }
        if (plan.adset.targeting.targeting_optimization === "none") requireThat(metaExpansionOff(s.adset.targeting_optimization_types), "meta_expansion_off_unverified");
      }
      const { name: _name, status: _status, targeting_optimization_types: _expansion, ...expected } = plan.adset;
      expected.start_time = new Date(expected.start_time).getTime();
      if (expected.end_time !== undefined) expected.end_time = new Date(expected.end_time).getTime();
      else requireThat(s.adset.end_time == null, "unexpected_provider_end_time");
      if (!plan.campaign.spend_cap) requireThat(s.campaign.spend_cap == null || s.campaign.spend_cap === 0 || s.campaign.spend_cap === "0", "unexpected_provider_spend_cap");
      const unusedBudget = plan.adset.daily_budget ? s.adset.lifetime_budget : s.adset.daily_budget;
      requireThat(unusedBudget == null || unusedBudget === 0 || unusedBudget === "0", "unexpected_provider_budget_mode");
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
          exactLinkedInTargeting(s.campaign.targetingCriteria, plan.campaign.targetingCriteria), "provider_targeting_or_optimization_mismatch");
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
        (ids.groupOwnership !== "shared" || (plan.group.totalBudgetCents === undefined ? s.campaign.totalBudget == null :
          linkedInMoney(s.campaign.totalBudget, (plan.group.totalBudgetCents / 100).toFixed(2), plan.campaign.currencyCode))) &&
        linkedInMoney(s.campaign.unitCost, plan.campaign.unitCostAmount, plan.campaign.currencyCode) &&
        s.campaign.objectiveType === plan.campaign.objectiveType &&
        s.campaign.type === plan.campaign.type && s.campaign.costType === plan.campaign.costType &&
        s.campaign.format === plan.campaign.format &&
        (ids.groupOwnership === "shared" || (plan.group.totalBudgetCents === undefined ? s.group.totalBudget == null :
          linkedInMoney(s.group.totalBudget, (plan.group.totalBudgetCents / 100).toFixed(2), plan.group.currencyCode))) &&
        (ids.groupOwnership === "shared" || plan.group.endAt !== undefined || s.group.runSchedule?.end == null) &&
        (plan.campaign.endAt !== undefined || s.campaign.runSchedule?.end == null) &&
          exactLinkedInTargeting(s.campaign.targetingCriteria, plan.campaign.targetingCriteria) &&
          (ids.groupOwnership === "shared" || subset(s.group.runSchedule, {
            start: plan.group.startAt,
            ...(plan.group.endAt === undefined ? {} : { end: plan.group.endAt }),
          })) &&
          subset(s.campaign.runSchedule, {
            start: plan.campaign.startAt,
            ...(plan.campaign.endAt === undefined ? {} : { end: plan.campaign.endAt }),
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
    if (activate && this.name === "meta") requireThat(["4", "5"].includes(ids.readbackVersion!), "meta_readback_requalification_required");
    const scopeDigest = digest({ c, g });
    const hostBeforeWrite = beforeWrite;
    beforeWrite = async () => {
      await hostBeforeWrite();
      requireThat(digest({ c, g }) === scopeDigest, "provider_scope_changed");
      if (activate) await this.prerequisite(c, g);
    };
    if (activate) await this.prerequisite(c, g);
    return await this.use(g, async (client) => {
      if (this.name === "linkedin") client.beforeWrite = async () => {
        const guard = async () => { await beforeWrite(); };
        const intent = activate ? "activate" : "pause";
        requireThat((await this.linkedInPermissions(client, g, undefined, guard, intent)).includes(intent), "provider_capability_missing");
        await beforeWrite();
      };
      if (activate && c.material.settings) await this.verifySettings(client, c, g);
      const before = await this.snapshot(client, g, ids);
      if (activate && this.name === "linkedin") requireThat(before.groupStatus === "ACTIVE", "linkedin_campaign_group_not_active");
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
        // A campaign-scoped action has no authority over a shared group. Stop
        // the campaign first; on activation, enable its creative before it.
        if (!activate) {
          await beforeWrite();
          await client.updateCampaignStatus(
            g.accountId,
            ids.campaign,
            "PAUSED",
          );
        }
        await beforeWrite();
        await client.updateCreativeStatus(
          g.accountId,
          ids.creative,
          activate ? "ACTIVE" : "PAUSED",
        );
        if (activate) {
          await beforeWrite();
          await client.updateCampaignStatus(
            g.accountId,
            ids.campaign,
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
      if (this.name === "meta" && ["4", "5"].includes(receipt.ids.readbackVersion!) && o.kind !== "pause" &&
        s.material.campaign.is_adset_budget_sharing_enabled !== false) return null;
      if (!receipt.ids.readbackDigest || receipt.payloadDigest !== o.payloadDigest) {
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
      if (!receipt.ids.readbackDigest || receipt.payloadDigest !== o.payloadDigest) return null;
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
      if (this.name === "linkedin") requireThat((await this.linkedInPermissions(client, g, undefined, undefined, "report")).includes("report"), "provider_capability_missing");
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
      const accountId = measurementAccountId(this.name, g.accountId);
      const measurement = await collectProviderMeasurement({
        client: this.name === "meta" ? { provider: "meta", client } : { provider: "linkedin", client },
        identity: { projectId: c.projectId, nativeCampaignId: c.id, sdkCampaignId: c.id, provider: this.name,
          accountId, campaignIds: [c.receipt!.ids.campaign!], materialVersion: String(c.revision), purpose: c.material.purpose || "unknown" },
        window: { from, until, timezone: g.timezone, currency: g.currency, minorUnitsPerMajor: 100 },
        verifiedScope: { accountId, campaignIds: [c.receipt!.ids.campaign!], currency: g.currency, timezone: g.timezone,
          evidenceRefs: [g.id, c.receipt!.payloadDigest] },
        delivery: { configuredStatus: c.state, effectiveStatus: null, evidenceRefs: [c.receipt!.payloadDigest] },
        outcomes: null,
        maturity: { state: "unknown", reason: "attribution_coverage_unverified", evidenceRefs: [], reportingLagEndsAt: null,
          attributionEndsAt: null, rereadAt: null, coverageVerified: false },
      });
      const evidence = buildMeasurementEvidence(measurement);
      return { spendMinor: evidence.metrics.spendMinor.value, impressions: evidence.metrics.impressions.value,
        clicks: evidence.metrics.clicks.value, providerConversions: evidence.metrics.providerConversions.value, measurement };
    });
    return {
      ...values,
      reportingBasis: "measurement" in values && values.measurement
        ? { ...reportingBasis, completeThrough: buildMeasurementEvidence(values.measurement).coverage.complete ? until : null }
        : reportingBasis,
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
