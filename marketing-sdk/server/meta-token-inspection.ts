import { MetaMarketingClient } from "../support/owner-marketing/meta-client.js";
import { DomainError, requireThat } from "./store.js";

export interface MetaTokenInspection {
  appId: string;
  tokenType: "USER" | "SYSTEM_USER";
  scopes: string[];
  tokenExpiresAt: string | null;
  dataAccessExpiresAt: string | null;
  lifetime: "scheduled_expiry" | "no_scheduled_expiry";
  /** Null means the provider explicitly returned zero for both clocks. It is
   * not a host grant expiry and does not bypass current host authority. */
  earliestExpiresAt: string | null;
  observedAt: string;
}

/** Server-only native custody qualification. App credentials authenticate the
 * debugger; the inspected token is never returned, persisted or included in an
 * error. Provider scopes alone do not prove account access or spending authority. */
export async function inspectMetaToken(
  credentials: { accessToken: string; appId: string; appSecret: string },
  guard: () => Promise<void>, fetcher: typeof fetch = fetch,
): Promise<MetaTokenInspection> {
  const {accessToken, appId, appSecret} = credentials;
  requireThat(typeof accessToken === "string" && accessToken.length > 0 &&
    typeof appId === "string" && /^\d+$/.test(appId) && typeof appSecret === "string" && appSecret.length > 0,
    "meta_token_custody_unavailable", 403);
  await guard();
  const appToken = `${appId}|${appSecret}`;
  const client = new MetaMarketingClient({accessToken: appToken, fetchImpl: async(input, init) => {
    const url = new URL(String(input));
    requireThat(url.origin === "https://graph.facebook.com" && url.pathname === "/v26.0/debug_token" &&
      init?.method === "GET" && init.redirect === "error", "meta_token_inspection_boundary", 403);
    await guard(); const result = await fetcher(input, init); await guard(); return result;
  }});
  let data: any;
  try { data = (await client.request("debug_token", {params:{input_token:accessToken}})).data; }
  catch {
    await guard();
    // The debugger can echo the inspected token, which differs from its app
    // authentication token. Never propagate a provider body/message here.
    throw new DomainError("meta_token_inspection_unavailable", 502);
  }
  await guard();
  requireThat(data?.is_valid === true, "meta_token_inactive", 403);
  requireThat(data.app_id === appId, "meta_token_app_mismatch", 403);
  requireThat(["USER", "SYSTEM_USER"].includes(data.type), "meta_token_type_unverified", 403);
  requireThat(Array.isArray(data.scopes) && data.scopes.length <= 200 && data.scopes.every((s: unknown) => typeof s === "string" && /^[a-z_]{1,150}$/.test(s)) &&
    new Set(data.scopes).size === data.scopes.length, "meta_token_scopes_unverified", 403);
  const clock = (v: unknown) => {
    requireThat(typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 8640000000000,
      "meta_token_expiry_unverified", 403);
    requireThat(v === 0 || (v as number) * 1000 > Date.now(), "meta_token_expired", 403);
    return v === 0 ? null : new Date((v as number) * 1000).toISOString();
  };
  const tokenExpiresAt = clock(data.expires_at), dataAccessExpiresAt = clock(data.data_access_expires_at);
  const finite = [tokenExpiresAt, dataAccessExpiresAt].filter((v): v is string => v !== null).sort((a,b)=>Date.parse(a)-Date.parse(b));
  return {appId, tokenType:data.type, scopes:[...data.scopes].sort(), tokenExpiresAt, dataAccessExpiresAt,
    earliestExpiresAt:finite[0] ?? null, lifetime:finite.length ? "scheduled_expiry" : "no_scheduled_expiry",
    observedAt:new Date().toISOString()};
}
