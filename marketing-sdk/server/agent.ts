import { EncryptedCredentialCustody } from "./credential-custody.js";
import { randomBytes, createHash } from "node:crypto";
import type { Grant, Setup } from "../core/index.js";
import type { AgentPort } from "./ports.js";
import type { Credentials, VaultPort } from "./providers.js";
import { Store, type Principal, byteDigest, digest, requireThat } from "./store.js";
import type { CredentialCipher } from "../support/vault-crypto.js";
export interface ConnectionCredentials extends Credentials { expiresAt: number; scopes: string[]; }
export interface OAuthApp {
  clientId: string;
  clientSecret: string;
  /** Trusted server configuration for paid-ad publishing discovery. Not provider
   * permission evidence, and never supplied by browser commands. */
  linkedinAdvertising?: {
    appId: string; clientId: string; revision: string;
    tier: "development" | "standard"; supportedScopes: string[];
  };
}
const endpoints = {
  google: {
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    scope: "https://www.googleapis.com/auth/adwords",
  },
  meta: {
    authorize: "https://www.facebook.com/v26.0/dialog/oauth",
    token: "https://graph.facebook.com/v26.0/oauth/access_token",
    scope: "ads_read,ads_management,pages_read_engagement",
  },
  linkedin: {
    authorize: "https://www.linkedin.com/oauth/v2/authorization",
    token: "https://www.linkedin.com/oauth/v2/accessToken",
    scope: "rw_ads r_ads_reporting w_organization_social r_organization_social",
  },
};
/** Native verification plus provider-hosted browser takeover. Human secrets are
 * entered only on the provider origin. No DOM/screenshot/shell access to secrets.
 * The future Agent runtime can replace inspect without changing authority.
 */
export class HostAgent implements AgentPort, VaultPort {
  constructor(
    readonly store: Store,
    readonly origin: string,
    readonly apps: Partial<Record<Grant["provider"], OAuthApp>>,
    readonly cipher: CredentialCipher,
    readonly fetcher: typeof fetch = fetch,
  ) {}
  /** Server-only pre-grant custody. Uses the same cipher and vault records as Grants.
   * Callers must journal the effect and supply a fresh authority guard; no refresh
   * or OAuth retry is implicit on this path. */
  connectionCallbackUri(provider: Grant["provider"]) {
    return `${this.origin}/api/marketing/oauth/${provider}/callback`;
  }
  connectionAuthorization(provider: Grant["provider"], _project: string, scopes: string[], offline: boolean) {
    const app = this.apps[provider]; requireThat(app, "oauth_application_not_configured");
    const state = randomBytes(32).toString("base64url"), verifier = randomBytes(32).toString("base64url");
    const url = new URL(endpoints[provider].authorize);
    url.search = new URLSearchParams({ client_id: app.clientId,
      redirect_uri: this.connectionCallbackUri(provider), response_type: "code", state,
      scope: scopes.join(provider === "meta" ? "," : " "),
      ...(provider === "google" ? { code_challenge: createHash("sha256").update(verifier).digest("base64url"),
        code_challenge_method: "S256", access_type: offline ? "offline" : "online", prompt: "consent" } : {}),
    }).toString();
    return { stateHash: byteDigest(Buffer.from(state)), callbackUri: this.connectionCallbackUri(provider), appBinding: digest([provider, app.clientId, app.clientSecret]), encrypted: this.cipher.encryptPayload(JSON.stringify({ url: url.toString(), verifier })) };
  }
  connectionAuthorizationUrl(encrypted: { encrypted: string; keyId: string }) {
    return JSON.parse(this.cipher.decryptPayloadAsString(encrypted.encrypted, encrypted.keyId)).url as string;
  }
  async exchangeConnection(provider: Grant["provider"], project: string, code: string,
    sealed: { encrypted: string; keyId: string }, scopes: string[], offline: boolean, guard: () => Promise<void>): Promise<ConnectionCredentials> {
    const app = this.apps[provider]; requireThat(app, "oauth_application_not_configured");
    const { verifier, url: issuedUrl } = JSON.parse(this.cipher.decryptPayloadAsString(sealed.encrypted, sealed.keyId));
    const issued = new URL(issuedUrl), callbackUri = issued.searchParams.get("redirect_uri");
    // Historical attempts carry their exact original project-path URI in the
    // encrypted authorization URL. Never recompute it into a new callback.
    requireThat(issued.origin + issued.pathname === endpoints[provider].authorize && issued.searchParams.get("client_id") === app.clientId &&
      (callbackUri === this.connectionCallbackUri(provider) || callbackUri === `${this.origin}/api/oauth/${encodeURIComponent(project)}/${provider}/callback`), "oauth_application_changed");
    await guard();
    const response = await this.fetcher(endpoints[provider].token, { method: "POST", redirect: "error", signal: AbortSignal.timeout(20000),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: app.clientId, client_secret: app.clientSecret,
        redirect_uri: callbackUri!,
        ...(provider === "google" ? { code_verifier: verifier } : {}),
      }) });
    // Reinspect after each remote boundary. Revocation does not discard a token
    // already issued: only restricted encrypted receipt retention may follow;
    // the manager's guarded promotion still fails closed.
    await guard().catch(() => {});
    // Read and retain restricted encrypted outcome even if authority changed in flight.
    // The manager reauthorizes before promoting this receipt or revealing any result.
    requireThat(response.ok, "oauth_exchange_outcome_unknown");
    const token = await response.json();
    await guard().catch(() => {});
    requireThat(typeof token.access_token === "string" && token.access_token.length > 0 && Number.isFinite(Number(token.expires_in)) && Number(token.expires_in) > 0, "oauth_exchange_outcome_unknown");
    // Missing exchange scope is only the expected consent envelope, never grant
    // proof. LinkedIn discovery requires fresh active introspection matching this
    // exact envelope before its first finder and again before promotion.
    const actual: string[] = typeof token.scope === "string" ? token.scope.split(/[ ,]+/).filter(Boolean) : scopes;
    requireThat(scopes.every(s => actual.includes(s)) && actual.every(s => scopes.includes(s)), "oauth_scope_mismatch");
    return { accessToken: token.access_token, ...(offline && typeof token.refresh_token === "string" ? { refreshToken: token.refresh_token } : {}),
      clientId: app.clientId, clientSecret: app.clientSecret, ...(provider === "meta" ? { appSecret: app.clientSecret } : {}),
      expiresAt: Date.now() + Number(token.expires_in) * 1000, scopes: actual };
  }
  async retainConnectionCredentials(project: string, secretRef: string, credentials: ConnectionCredentials) {
    await new EncryptedCredentialCustody(this.store, this.cipher).retain(project, secretRef, credentials);
  }
  async useConnection<T>(project: string, secretRef: string, scopes: string[], guard: () => Promise<void>, action: (credentials: ConnectionCredentials) => Promise<T>): Promise<T> {
    await guard();
    const sealed = await this.store.get<{ encrypted: string; keyId: string }>(project, "vault", secretRef);
    await guard();
    const credentials = JSON.parse(this.cipher.decryptPayloadAsString(sealed.encrypted, sealed.keyId)) as ConnectionCredentials;
    requireThat(credentials.expiresAt > Date.now() + 5000 && scopes.every(s => credentials.scopes.includes(s)), "provider_access_expired_or_denied");
    const result = await action(credentials); await guard(); return result;
  }
  private async read(g: Grant): Promise<
    Credentials & {
      expiresAt: number;
    }
  > {
    const record = await this.store.get<{
      encrypted: string;
      keyId: string;
    }>(g.projectId, "vault", g.secretRef);
    return JSON.parse(this.cipher.decryptPayloadAsString(record.encrypted, record.keyId));
  }
  async storeCredentials(
    g: Grant,
    credentials: Credentials & {
      expiresAt: number;
    },
  ) {
    await new EncryptedCredentialCustody(this.store, this.cipher).retain(g.projectId, g.secretRef, credentials);
  }
  async inspect(_s: Setup, g: Grant) {
    try {
      const credentials = await this.read(g);
      if (credentials.expiresAt > Date.now() || credentials.refreshToken)
        return {
          state: "ready" as const,
          reason: null,
          handoffUrl: null,
        };
    } catch {
      /* no secret diagnostics cross this boundary */
    }
    return {
      state: this.apps[g.provider]
        ? ("waiting_human" as const)
        : ("blocked" as const),
      reason: this.apps[g.provider]
        ? "provider_consent_required"
        : "oauth_application_not_configured",
      handoffUrl: this.apps[g.provider]
        ? `/api/projects/${encodeURIComponent(g.projectId)}/oauth/${encodeURIComponent(g.id)}`
        : null,
    };
  }
  /** Read-only credential access: never refreshes, grants or writes custody. */
  async useReadOnly<T>(g: Grant, guard: () => Promise<void>, action: (credentials: ConnectionCredentials) => Promise<T>) {
    requireThat(!g.revokedAt && Date.parse(g.expiresAt) > Date.now(), "grant_expired_or_revoked");
    return this.useConnection(g.projectId, g.secretRef, [], guard, action);
  }
  async use<T>(g: Grant, action: (credentials: Credentials) => Promise<T>) {
    requireThat(
      !g.revokedAt && Date.parse(g.expiresAt) > Date.now(),
      "grant_expired_or_revoked",
    );
    let credentials = await this.read(g);
    if (credentials.expiresAt <= Date.now() + 60000) {
      const app = this.apps[g.provider];
      requireThat(
        app && credentials.refreshToken && g.provider !== "meta",
        "reauthorization_required",
      );
      const r = await this.fetcher(endpoints[g.provider].token, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(20000),
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: credentials.refreshToken,
          client_id: app.clientId,
          client_secret: app.clientSecret,
        }),
      });
      requireThat(r.ok, "reauthorization_required");
      const token = await r.json();
      requireThat(
        typeof token.access_token === "string" && Number(token.expires_in) > 0,
        "invalid_oauth_token_response",
      );
      credentials = {
        ...credentials,
        accessToken: token.access_token,
        refreshToken: token.refresh_token || credentials.refreshToken,
        expiresAt: Date.now() + Number(token.expires_in) * 1000,
      };
      await this.storeCredentials(g, credentials);
    }
    return action(credentials);
  }
  async begin(p: Principal, project: string, grantId: string) {
    await this.store.authorize(p, project, ["admin", "editor"], true);
    const g = await this.store.get<Grant>(project, "grant", grantId);
    const app = this.apps[g.provider];
    requireThat(
      app && !g.revokedAt && Date.parse(g.expiresAt) > Date.now(),
      "oauth_unavailable",
    );
    const state = randomBytes(32).toString("base64url"),
      verifier = randomBytes(32).toString("base64url");
    await this.store.put(project, "oauth", byteDigest(Buffer.from(state)), {
      userId: p.userId,
      grantId,
      grantRevision: g.revision,
      verifier,
      expiresAt: Date.now() + 600000,
      consumed: false,
    });
    const url = new URL(endpoints[g.provider].authorize);
    url.search = new URLSearchParams({
      client_id: app.clientId,
      redirect_uri: `${this.origin}/api/oauth/${project}/${g.provider}/callback`,
      response_type: "code",
      state,
      scope: endpoints[g.provider].scope,
      ...(g.provider === "google"
        ? {
            code_challenge: createHash("sha256")
              .update(verifier)
              .digest("base64url"),
            code_challenge_method: "S256",
            access_type: "offline",
            prompt: "consent",
          }
        : {}),
    }).toString();
    return url.toString();
  }
  async complete(
    p: Principal,
    project: string,
    provider: Grant["provider"],
    state: string,
    code: string,
  ) {
    await this.store.authorize(p, project, ["admin", "editor"], true);
    const key = byteDigest(Buffer.from(state));
    const saved = await this.store.get<{
      userId: string;
      grantId: string;
      grantRevision: number;
      verifier: string;
      expiresAt: number;
      consumed: boolean;
    }>(project, "oauth", key);
    requireThat(
      saved.userId === p.userId &&
        saved.expiresAt > Date.now() &&
        !saved.consumed,
      "oauth_state_invalid",
    );
    const g = await this.store.get<Grant>(project, "grant", saved.grantId);
    const app = this.apps[provider];
    requireThat(
      app &&
        g.provider === provider &&
        g.revision === saved.grantRevision &&
        !g.revokedAt &&
        Date.parse(g.expiresAt) > Date.now(),
      "oauth_grant_changed",
    );
    await this.store.transaction(async () => {
      await this.store.authorize(p, project, ["admin", "editor"], true);
      const currentGrant = await this.store.get<Grant>(project, "grant", g.id);
      requireThat(
        currentGrant.revision === g.revision &&
          !currentGrant.revokedAt &&
          Date.parse(currentGrant.expiresAt) > Date.now(),
        "oauth_grant_changed",
      );
      const current = await this.store.get<typeof saved>(project, "oauth", key);
      requireThat(!current.consumed, "oauth_state_consumed");
      await this.store.put(project, "oauth", key, {
        ...saved,
        consumed: true,
      });
    });
    const r = await this.fetcher(endpoints[provider].token, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(20000),
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: app.clientId,
        client_secret: app.clientSecret,
        redirect_uri: `${this.origin}/api/oauth/${project}/${provider}/callback`,
        ...(provider === "google"
          ? {
              code_verifier: saved.verifier,
            }
          : {}),
      }),
    });
    requireThat(r.ok, "oauth_exchange_failed_restart_consent");
    const token = await r.json();
    requireThat(
      typeof token.access_token === "string" && Number(token.expires_in) > 0,
      "invalid_oauth_token_response",
    );
    await this.store.transaction(async () => {
      await this.store.authorize(p, project, ["admin", "editor"], true);
      const current = await this.store.get<Grant>(project, "grant", g.id);
      requireThat(
        current.revision === g.revision &&
          !current.revokedAt &&
          Date.parse(current.expiresAt) > Date.now(),
        "oauth_grant_changed",
      );
      await this.storeCredentials(g, {
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        clientId: app.clientId,
        clientSecret: app.clientSecret,
        expiresAt: Date.now() + Number(token.expires_in) * 1000,
      });
    });
    return g.id; // setup resume still independently verifies expected account and permissions.
  }
}
