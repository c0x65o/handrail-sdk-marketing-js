import type { AccountChoice, IdentityChoice, Permission, Provider } from "../core/index.js";
import type { Credentials } from "./providers.js";
import { requireThat, DomainError } from "./store.js";

/** Native reads only. Cursors and provider IDs stay behind opaque, session-bound choices. */
export interface DiscoveredAccount {
  id: string; label: string; businessLabel: string | null; currency: string; timezone: string;
  timezoneSource: AccountChoice["timezoneSource"]; roleSummary: string; limitations: string[];
  managerId?: string; managerLabel?: string; organizationId?: string; organizationLabel?: string; memberUrn?: string; accountUrn?: string; accountRole?: string; permissions: Permission[];
}
export interface DiscoveredIdentity { id: string; kind: IdentityChoice["kind"]; label: string; pageId?: string; }
export interface NativePage<T> { rows: T[]; next: string | null; }
const numeric = (value: unknown): string => {
  const s = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
  requireThat(typeof s === "string" && /^\d+$/.test(s), "invalid_discovery_response"); return s;
};
const label = (value: unknown, fallback: string): string => typeof value === "string" && value.trim() ? value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "").slice(0, 180) || fallback : fallback;
const list = (value: unknown): any[] => { requireThat(Array.isArray(value) && value.length <= 10000, "invalid_discovery_response"); return value; };
export const needsPublishingIdentity = (operations: Permission[]) => operations.some(p => ["prepare", "activate"].includes(p));
export function connectionScopes(provider: Provider, operations: Permission[]) {
  const writes = operations.some(p => ["prepare", "activate", "pause"].includes(p));
  if (provider === "meta") return ["ads_read", ...(writes ? ["ads_management"] : []), ...(needsPublishingIdentity(operations) ? ["pages_read_engagement"] : [])];
  if (provider === "google") return ["https://www.googleapis.com/auth/adwords"];
  return [writes ? "rw_ads" : "r_ads", ...(operations.includes("report") ? ["r_ads_reporting"] : []), ...(needsPublishingIdentity(operations) ? ["r_organization_admin", "w_organization_social", "r_organization_social"] : [])];
}
export class ConnectionDiscovery {
  constructor(readonly fetcher: typeof fetch = fetch) {}
  private async read(provider: Provider, credentials: Credentials, path: string, query: Record<string, string>, guard: () => Promise<void>, body?: unknown, manager?: string): Promise<any> {
    const root = provider === "meta" ? "https://graph.facebook.com/v26.0/" : provider === "linkedin" ? "https://api.linkedin.com/rest/" : "https://googleads.googleapis.com/v25/";
    // No caller URLs or provider next links are followed. Redirects never receive credentials.
    requireThat(/^[a-zA-Z0-9_/:]+$/.test(path), "invalid_discovery_path");
    const url = new URL(`./${path}`, root); url.search = new URLSearchParams(query).toString();
    await guard();
    try {
      const response = await this.fetcher(url, { method: body ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(20000),
        headers: { authorization: `Bearer ${credentials.accessToken}`, "content-type": "application/json",
          ...(provider === "linkedin" ? { "linkedin-version": "202609", "x-restli-protocol-version": "2.0.0" } : {}),
          ...(manager ? { "login-customer-id": numeric(manager) } : {}) }, body: body ? JSON.stringify(body) : undefined });
      await guard();
      requireThat(response.ok, response.status === 401 || response.status === 403 ? "provider_access_expired_or_denied" : "provider_read_unavailable", 502);
      const data = await response.json(); await guard();
      const secrets = [credentials.accessToken, credentials.refreshToken, credentials.clientSecret, credentials.appSecret].filter((s): s is string => !!s);
      const redact = (v: any): any => typeof v === "string" ? secrets.reduce((s, secret) => s.split(secret).join("[redacted]"), v)
        : Array.isArray(v) ? v.map(redact) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redact(x)])) : v;
      return redact(data);
    } catch (error) { if (error instanceof DomainError) throw error; throw new DomainError("provider_read_unavailable", 502); }
  }
  private metaAccount(a: any): DiscoveredAccount {
    requireThat(typeof a.id === "string" && /^act_\d+$/.test(a.id) && a.account_status === 1, "provider_account_unavailable");
    const tasks = list(a.user_tasks);
    requireThat(tasks.includes("ANALYZE") || tasks.includes("MANAGE"), "provider_account_role_missing");
    return this.account({ id: a.id, label: label(a.name, "Meta advertising account"), businessLabel: a.business ? label(a.business.name, "Business") : null,
      currency: a.currency, timezone: a.timezone_name, timezoneSource: "provider_account", roleSummary: tasks.includes("MANAGE") ? "Account management and reporting" : tasks.includes("ADVERTISE") ? "Reporting and advertising access" : "Reporting access",
      permissions: ["setup", "report", ...(tasks.includes("ADVERTISE") || tasks.includes("MANAGE") ? ["prepare", "activate", "pause"] as Permission[] : [])],
      limitations: ["Single-image feed ads only. Meta daily native preparation and activation remain denied."] });
  }
  private account(a: DiscoveredAccount) {
    requireThat(typeof a.currency === "string" && /^[A-Z]{3}$/.test(a.currency) && typeof a.timezone === "string", "provider_account_context_missing");
    try { new Intl.DateTimeFormat("en", { timeZone: a.timezone }); } catch { throw new DomainError("provider_account_context_missing"); }
    return a;
  }
  private nextMeta(v: any) {
    if (!v.paging?.next) return null;
    requireThat(typeof v.paging?.cursors?.after === "string" && v.paging.cursors.after.length <= 4096, "invalid_discovery_cursor");
    return v.paging.cursors.after as string;
  }
  /** Only the two documented offset finders use this helper (not adAccounts search).
   * Consume every page before exposing choices: a later conflict cannot qualify an
   * earlier role. Continuation beats an empty page; limits mean incomplete. */
  private async linkedRows(credentials: Credentials, path: string, query: Record<string, string>, guard: () => Promise<void>) {
    const rows: any[] = []; let start = 0;
    for (let page = 0; page < 40; page++) {
      const v = await this.read("linkedin", credentials, path, { ...query, start: String(start), count: "25" }, guard);
      const elements = list(v.elements), paging = v.paging;
      requireThat(paging && paging.start === start && Number.isSafeInteger(paging.count) && paging.count > 0 && paging.count <= 25 && elements.length <= paging.count, "provider_discovery_incomplete");
      const count = paging.count, nextStart = start + count;
      const links = paging.links === undefined ? [] : list(paging.links);
      const next = links.filter(l => l.rel === "next");
      requireThat(next.length <= 1, "provider_discovery_incomplete");
      if (next.length) {
        requireThat(typeof next[0].href === "string" && next[0].href.length <= 4096, "provider_discovery_incomplete");
        const url = new URL(next[0].href, "https://api.linkedin.com");
        const expected = { ...query, count: String(count), start: String(nextStart) };
        requireThat(url.origin === "https://api.linkedin.com" && !url.username && !url.password && !url.hash && url.pathname === `/rest/${path}` &&
          [...url.searchParams].length === Object.keys(expected).length && Object.entries(expected).every(([k, value]) => url.searchParams.get(k) === value), "provider_discovery_incomplete");
      }
      if (paging.total !== undefined) requireThat(Number.isSafeInteger(paging.total) && paging.total >= 0 && (!next.length || nextStart < paging.total), "provider_discovery_incomplete");
      rows.push(...elements); requireThat(rows.length <= 1000, "provider_discovery_incomplete");
      const more = next.length > 0 || (paging.total !== undefined ? nextStart < paging.total : elements.length === count);
      if (!more) return rows;
      start = nextStart;
    }
    throw new DomainError("provider_discovery_incomplete");
  }
  /** Requested scopes are not provider evidence. Check actual token scope before
   * any finder, and reject contradictory optional introspection metadata. */
  async linkedinScopes(credentials: Credentials & { scopes?: string[] }, required: string[], guard: () => Promise<void>) {
    await guard();
    let response: Response;
    try { response = await this.fetcher("https://www.linkedin.com/oauth/v2/introspectToken", {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(20000),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: credentials.accessToken, client_id: credentials.clientId ?? "", client_secret: credentials.clientSecret ?? "" }),
    }); } catch { throw new DomainError("provider_read_unavailable", 502); }
    await guard(); requireThat(response.ok, "provider_access_expired_or_denied");
    let token: any; try { token = await response.json(); } catch { throw new DomainError("provider_read_unavailable", 502); }
    await guard();
    const scopes: string[] = typeof token.scope === "string" ? token.scope.split(/[ ,]+/).filter(Boolean) : [];
    requireThat(token.active === true && (token.status === undefined || token.status === "active") &&
      (token.client_id === undefined || token.client_id === credentials.clientId) &&
      (token.auth_type === undefined || token.auth_type === "3L") &&
      (token.expires_at === undefined || Number.isFinite(token.expires_at) && token.expires_at * 1000 > Date.now()), "provider_access_expired_or_denied");
    // Pre-grant custody carries the exact reviewed scope envelope, including
    // when the exchange omitted scope. Only this fresh provider observation can
    // qualify it; extra authority also requires another exact human review.
    if (credentials.scopes !== undefined) requireThat(Array.isArray(credentials.scopes) &&
      credentials.scopes.every(s => scopes.includes(s)) && scopes.every(s => credentials.scopes!.includes(s)), "provider_scope_missing");
    requireThat(required.every(s => scopes.includes(s)), "provider_scope_missing");
    return scopes;
  }
  async accounts(provider: Provider, credentials: Credentials, cursor: string | undefined, guard: () => Promise<void>): Promise<NativePage<DiscoveredAccount>> {
    if (provider === "meta") {
      const granted = await this.read(provider, credentials, "me/permissions", {}, guard);
      requireThat(list(granted.data).some(p => p.permission === "ads_read" && p.status === "granted"), "provider_access_expired_or_denied");
    }
    if (provider === "meta") {
      const v = await this.read(provider, credentials, "me/adaccounts", { fields: "id,name,currency,timezone_name,account_status,business{name},user_tasks", limit: "25", ...(cursor ? { after: cursor } : {}) }, guard);
      return { rows: list(v.data).filter(a => a.account_status === 1).map(a => this.metaAccount(a)), next: this.nextMeta(v) };
    }
    if (provider === "linkedin") {
      requireThat(!cursor, "invalid_discovery_cursor");
      const scopes = await this.linkedinScopes(credentials, [], guard);
      requireThat(scopes.includes("r_ads") || scopes.includes("rw_ads"), "provider_scope_missing");
      const users = await this.linkedRows(credentials, "adAccountUsers", { q: "authenticatedUser" }, guard);
      const rows: DiscoveredAccount[] = []; let member: string | undefined;
      const seen = new Set<string>();
      for (const u of users) {
        const accountId = typeof u.account === "string" && /^urn:li:sponsoredAccount:(\d+)$/.exec(u.account)?.[1]; requireThat(accountId, "provider_account_context_changed");
        requireThat(typeof u.user === "string" && /^urn:li:person:[A-Za-z0-9_-]+$/.test(u.user) && (!member || member === u.user), "provider_member_mismatch");
        member = u.user;
        requireThat(!seen.has(u.account), "provider_account_context_changed"); seen.add(u.account);
        const role = u.role;
        requireThat(["ACCOUNT_MANAGER", "CAMPAIGN_MANAGER", "CREATIVE_MANAGER", "VIEWER", "ACCOUNT_BILLING_ADMIN"].includes(role), "provider_account_role_missing");
        const a = await this.read(provider, credentials, `adAccounts/${accountId}`, { fields: "id,name,reference,referenceInfo,currency,status" }, guard);
        requireThat(numeric(a.id) === accountId, "provider_account_context_changed");
        if (a.status !== "ACTIVE") continue;
        const organizationId = typeof a.reference === "string" ? /^urn:li:organization:(\d+)$/.exec(a.reference)?.[1] : undefined;
        const info = a.referenceInfo?.organization;
        if (info) requireThat(organizationId && numeric(info.id) === organizationId && !a.referenceInfo.person, "provider_identity_mismatch");
        const organizationLabel = organizationId ? label(info?.localizedName, `LinkedIn Page urn:li:organization:${organizationId} (name unavailable)`) : undefined;
        rows.push(this.account({ id: accountId, label: label(a.name, `LinkedIn advertising account ${accountId} (name unavailable)`), businessLabel: null,
          currency: a.currency, timezone: "UTC", timezoneSource: "provider_reporting_and_budget_policy", roleSummary: role.toLowerCase().replaceAll("_", " "),
          organizationId, organizationLabel, memberUrn: member, accountUrn: u.account, accountRole: role,
          permissions: ["setup", "report", ...(["ACCOUNT_MANAGER", "CAMPAIGN_MANAGER", "ACCOUNT_BILLING_ADMIN"].includes(role) ? ["prepare", "activate", "pause"] as Permission[] : [])],
          limitations: ["Single-image STANDARD_UPDATE only. UTC reporting and budget policy. Publishing requires separate Page access verification.",
            ...(organizationId && !info?.localizedName ? ["Page name unavailable; confirm the full organization identifier. No broader permission is requested for a label."] : [])] }));
      }
      return { rows, next: null };
    }
    let state: { roots: string[]; index: number; token?: string };
    if (cursor) state = JSON.parse(cursor);
    else {
      const accessible = await this.read(provider, credentials, "customers:listAccessibleCustomers", {}, guard);
      state = { roots: list(accessible.resourceNames).map(r => { const n = /^customers\/(\d+)$/.exec(r)?.[1]; requireThat(n, "invalid_discovery_response"); return n; }), index: 0 };
    }
    const root = state.roots[state.index]; if (!root) return { rows: [], next: null };
    const v = await this.read(provider, credentials, `customers/${numeric(root)}/googleAds:search`, {}, guard, {
      query: "SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, customer_client.time_zone, customer_client.manager, customer_client.status, customer_client.level FROM customer_client WHERE customer_client.status = 'ENABLED'",
      ...(state.token ? { pageToken: state.token } : {}),
    }, root);
    const rows = list(v.results ?? []).filter(r => r.customerClient?.manager === false).map(r => {
      const a = r.customerClient, accountId = numeric(a.id);
      return this.account({ id: accountId, label: label(a.descriptiveName, "Google Ads account"), businessLabel: root === accountId ? null : `Manager …${root.slice(-4)}`,
        currency: a.currencyCode, timezone: a.timeZone, timezoneSource: "provider_account", roleSummary: "Accessible through authenticated customer hierarchy; exact-plan write validation required",
        ...(root === accountId ? {} : { managerId: root, managerLabel: `Google Ads manager …${root.slice(-4)}` }),
        permissions: ["setup", "report"], limitations: ["Search text only. Reading an account does not qualify campaign writes."] });
    });
    if (v.nextPageToken) { requireThat(typeof v.nextPageToken === "string", "invalid_discovery_cursor"); state.token = v.nextPageToken; }
    else { state.index++; delete state.token; }
    return { rows, next: state.index < state.roots.length ? JSON.stringify(state) : null };
  }
  async identities(provider: Provider, credentials: Credentials, account: DiscoveredAccount, cursor: string | undefined, guard: () => Promise<void>): Promise<NativePage<DiscoveredIdentity>> {
    if (provider === "google") return { rows: account.managerId ? [{ id: account.managerId, kind: "google_manager", label: account.managerLabel! }] : [], next: null };
    if (provider === "meta") {
      requireThat(/^act_\d+$/.test(account.id), "invalid_discovery_response");
      const v = await this.read(provider, credentials, `${account.id}/promote_pages`, { fields: "id,name,instagram_business_account{id,username}", limit: "25", ...(cursor ? { after: cursor } : {}) }, guard);
      return { rows: list(v.data).flatMap(p => [{ id: numeric(p.id), kind: "meta_page" as const, label: label(p.name, "Facebook Page") },
        ...(p.instagram_business_account ? [{ id: numeric(p.instagram_business_account.id), kind: "instagram" as const, label: label(p.instagram_business_account.username, "Instagram identity"), pageId: numeric(p.id) }] : [])]), next: this.nextMeta(v) };
    }
    requireThat(!cursor, "invalid_discovery_cursor");
    await this.linkedinScopes(credentials, ["rw_ads", "r_organization_admin", "w_organization_social", "r_organization_social"], guard);
    requireThat(account.memberUrn && account.accountUrn === `urn:li:sponsoredAccount:${account.id}` && account.organizationId, "provider_identity_mismatch");
    requireThat(["ACCOUNT_MANAGER", "CAMPAIGN_MANAGER", "ACCOUNT_BILLING_ADMIN"].includes(account.accountRole ?? ""), "provider_account_role_missing");
    const acls = await this.linkedRows(credentials, "organizationAcls", { q: "roleAssignee", state: "APPROVED" }, guard);
    let eligible = false;
    for (const acl of acls) {
      requireThat(acl.roleAssignee === account.memberUrn, "provider_member_mismatch");
      requireThat(acl.organization === undefined || acl.organizationTarget === undefined || acl.organization === acl.organizationTarget, "provider_identity_mismatch");
      const org = acl.organization ?? acl.organizationTarget;
      requireThat(typeof org === "string" && /^urn:li:organization:\d+$/.test(org), "provider_identity_mismatch");
      if (org !== `urn:li:organization:${account.organizationId}`) continue;
      requireThat(acl.state === "APPROVED", "provider_page_role_missing");
      // No CONTENT_ADMIN/CONTENT_ADMINISTRATOR alias is qualified.
      if (["ADMINISTRATOR", "DIRECT_SPONSORED_CONTENT_POSTER"].includes(acl.role)) {
        requireThat(acl.state === "APPROVED", "provider_page_role_missing"); eligible = true;
      }
    }
    requireThat(eligible, "provider_page_role_missing");
    return { rows: [{ id: account.organizationId, kind: "linkedin_organization", label: account.organizationLabel ?? `LinkedIn Page urn:li:organization:${account.organizationId} (name unavailable)` }], next: null };
  }
  async verify(provider: Provider, credentials: Credentials, account: DiscoveredAccount, identities: DiscoveredIdentity[], operations: Permission[], guard: () => Promise<void>) {
    if (provider === "meta") {
      const granted = await this.read(provider, credentials, "me/permissions", {}, guard);
      requireThat(connectionScopes(provider, operations).every(scope => list(granted.data).some(p => p.permission === scope && p.status === "granted")), "provider_access_expired_or_denied");
    }
    if (provider === "linkedin") {
      await this.linkedinScopes(credentials, connectionScopes(provider, operations), guard);
      if (needsPublishingIdentity(operations)) requireThat(identities.length === 1 && identities[0]!.kind === "linkedin_organization" && identities[0]!.id === account.organizationId, "provider_identity_mismatch");
    }
    // Re-enumerate under the same credential and current actor. No fabricated Grant.
    let cursor: string | undefined, found: DiscoveredAccount | undefined;
    for (let n = 0; n < 40; n++) {
      const page = await this.accounts(provider, credentials, cursor, guard);
      found = page.rows.find(a => a.id === account.id && a.managerId === account.managerId);
      if (found || !page.next) break; cursor = page.next;
    }
    requireThat(found && found.currency === account.currency && found.timezone === account.timezone && found.organizationId === account.organizationId, "provider_account_context_changed");
    if (provider === "linkedin") requireThat(found.memberUrn === account.memberUrn && found.accountUrn === account.accountUrn && found.accountRole === account.accountRole, "provider_member_or_role_changed");
    requireThat(operations.every(p => found!.permissions.includes(p) || provider === "google"), "provider_account_role_missing");
    if (identities.length) {
      const actual: DiscoveredIdentity[] = []; cursor = undefined;
      for (let n = 0; n < 40; n++) { const page = await this.identities(provider, credentials, found, cursor, guard); actual.push(...page.rows); if (!page.next) { cursor = undefined; break; } cursor = page.next; }
      requireThat(!cursor, "provider_discovery_incomplete");
      requireThat(identities.every(i => actual.some(a => a.id === i.id && a.kind === i.kind && a.pageId === i.pageId)), "provider_identity_mismatch");
    }
    if (provider === "linkedin") await this.linkedinScopes(credentials, connectionScopes(provider, operations), guard);
    await guard();
    return found;
  }
}
