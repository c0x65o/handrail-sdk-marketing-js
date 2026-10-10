import {
  MarketingServer, NativeProvider, createConnections, DomainError, handleStudioMedia, handleCampaignMedia, handleTrackingCollector, type TrackingOptions, type StudioOptions,
  type PrivateMutationHeaders, type Store, type HostAgent, type GenerationPort, type Principal, type ConnectionsOptions,
} from "@handrail/marketing/server";
import type { Command } from "@handrail/marketing";

/** Complete Fetch-style host glue. Bind existing auth, policy, custody and generation.
 * No provider mapping, SQL grant seed, Marketing screen, scheduler or secret input.
 * The host's access logger must omit OAuth callback query strings BEFORE this handler.
 */
export function mountMarketingConnections(config: {
  store: Store; custody: HostAgent; generation: GenerationPort;
  accessPolicy: NonNullable<ConnectionsOptions["accessPolicy"]>;
  sessions?: ConnectionsOptions["sessions"];
  sessionAuthority?: ConnectionsOptions["sessionAuthority"];
  creative?: ConnectionsOptions["creative"];
  studio?: Omit<StudioOptions, "sessions">;
  tracking?: TrackingOptions;
  mutationHeaders?: PrivateMutationHeaders;
  authenticate(request: Request): Promise<Principal>;
  evidence?: "provider" | "fixture"; returnPath?: string; loginPath?: string;
}) {
  const { store, custody } = config;
  const connections = createConnections({ store, custody, accessPolicy: config.accessPolicy,
    sessions: config.sessions, sessionAuthority: config.sessionAuthority, evidence: config.evidence, creative: config.creative });
  const marketing = new MarketingServer(store, {
    meta: new NativeProvider("meta", custody, store, custody.fetcher),
    google: new NativeProvider("google", custody, store, custody.fetcher),
    linkedin: new NativeProvider("linkedin", custody, store, custody.fetcher),
  }, config.generation, custody, config.evidence === "fixture" ? "fixture" : "live",
  undefined, undefined, { connections, tracking: config.tracking, studio: { ...config.studio, sessions: config.sessionAuthority } });
  const routes = connections.routes({ origin: custody.origin, authenticate: config.authenticate, returnPath: config.returnPath, loginPath: config.loginPath, mutationHeaders: config.mutationHeaders });
  return {
    marketing, // Existing host executor retains dispatch/recover ownership.
    async handle(request: Request): Promise<Response | null> {
      // Mount after the existing shared rate gate. Collector auth is distinct
      // from browser cookies and resolves project/source independently of the URL.
      const collector = /^\/api\/marketing-collector\/(receipt|coverage)$/.exec(new URL(request.url).pathname);
      if (collector) {
        try { return await handleTrackingCollector(marketing.tracking, request, collector[1] as "receipt" | "coverage"); }
        catch(e) { return Response.json({error:e instanceof DomainError?e.code:"collector_unavailable"},{status:e instanceof DomainError?e.status:503,headers:{"cache-control":"no-store"}}); }
      }
      const secure = await routes(request); if (secure) return secure;
      const url = new URL(request.url);
      const media = /^\/api\/projects\/([^/]+)\/(studio-media|assets)\/([^/]+)$/.exec(url.pathname);
      if (media) {
        try {
          if (url.origin !== custody.origin || request.method === "POST" && request.headers.get("origin") !== custody.origin) throw new DomainError("origin_denied", 403);
          const principal = await config.authenticate(request);
          return await (media[2] === 'assets' ? handleCampaignMedia : handleStudioMedia)(marketing.studio, principal, decodeURIComponent(media[1]!), decodeURIComponent(media[3]!), request);
        } catch (e) {
          return Response.json({ error: e instanceof DomainError ? e.code : "studio_media_unavailable" }, { status: e instanceof DomainError ? e.status : 503, headers: { "cache-control": "no-store" } });
        }
      }
      const match = /^\/api\/projects\/([^/]+)\/([a-zA-Z]+)$/.exec(url.pathname);
      if (!match) return null;
      const headers = { "cache-control": "no-store", "referrer-policy": "no-referrer" };
      try {
        if (request.method !== "POST") throw new DomainError("method_not_allowed", 405);
        if (url.origin !== custody.origin || request.headers.get("origin") !== custody.origin) throw new DomainError("origin_denied", 403);
        if (request.headers.get("content-type")?.split(";")[0] !== "application/json") throw new DomainError("json_required", 415);
        const principal = await config.authenticate(request);
        // Bound the stream before parsing; request.json() alone is not a size guard.
        const reader = request.body?.getReader(); let body = "", length = 0;
        if (reader) {
          const decoder = new TextDecoder();
          try { for (;;) { const part = await reader.read(); if (part.done) break;
            length += part.value.byteLength; if (length > 256 * 1024) throw new DomainError("body_too_large", 413);
            body += decoder.decode(part.value, { stream: true });
          } body += decoder.decode(); } finally { await reader.cancel(); }
        }
        let input: unknown; try { input = JSON.parse(body); } catch { throw new DomainError("invalid_json", 400); }
        const output = await marketing.call(principal, decodeURIComponent(match[1]!), match[2] as Command, input as never);
        return Response.json(output, { headers });
      } catch (e) {
        return Response.json({ error: e instanceof DomainError ? e.code : "marketing_request_unavailable" }, { status: e instanceof DomainError ? e.status : 503, headers });
      }
    },
  };
}
