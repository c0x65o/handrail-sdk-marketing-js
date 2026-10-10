import { externalSessionFixture } from "./external-session-fixture.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { testStore } from "./datastore.js";
import { MarketingServer, HostAgent, NativeProvider, createCredentialCipher, createConnections, type ConnectionAccessPolicy } from "../server/index.js";
import type { ConnectionCommands, ConnectionView, Permission, Provider } from "../core/index.js";

/** Only external HTTP is synthetic. Real SQL, auth, cipher, transport and domain commands. */
export async function connectionFixture(provider: Provider = "meta", write = false, external = false) {
  const dir = mkdtempSync(join(tmpdir(), "marketing-connections-")), path = join(dir, "db"), store = await testStore(path);
  await store.db.prepare("INSERT INTO projects VALUES(?,?)").run("p", "FIXTURE Fieldwork");
  await store.db.prepare("INSERT INTO projects VALUES(?,?)").run("other", "Other project");
  const alice = await store.createUser("alice", ""), bob = await store.createUser("bob", ""), agentId = await store.createUser("agent", "", "agent");
  for (const uid of [alice, bob, agentId]) await store.db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(uid, "p", "admin");
  let aliceToken = (await store.login("alice", "", "alice"))!, bobToken = (await store.login("bob", "", "bob"))!;
  const hostPath = join(dir, "external-host"), hostStore = external ? await testStore(hostPath) : null;
  const host = hostStore ? await externalSessionFixture(store, hostStore) : null;
  if (host) { aliceToken = (await host.login("alice")).token; bobToken = (await host.login("bob")).token; }
  const authenticate = (token: string) => host ? host.principal(token) : store.authenticate(token);
  const principal = await authenticate(aliceToken), bobPrincipal = await authenticate(bobToken);
  const scopes = provider === "google" ? ["https://www.googleapis.com/auth/adwords"] : provider === "linkedin" ? [write ? "rw_ads" : "r_ads", "r_ads_reporting", ...(write ? ["r_organization_admin", "w_organization_social", "r_organization_social"] : [])] : ["ads_read", ...(write ? ["ads_management", "pages_read_engagement"] : [])];
  const calls: string[] = []; let boundary: ((url: URL) => Promise<void>) | null = null, failExchange = false, failRead = false, tokenSeconds = 3600;
  const page = (id: string, name: string) => ({ id, name, currency: "USD", timezone_name: "America/Chicago", account_status: 1, business: { name: "FIXTURE business" }, user_tasks: ["ANALYZE", "ADVERTISE"] });
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); calls.push(url.origin + url.pathname);
    if (boundary) await boundary(url);
    if (["/v26.0/oauth/access_token", "/token", "/oauth/v2/accessToken"].includes(url.pathname)) {
      if (failExchange) throw new Error("DO_NOT_EXPOSE_PROVIDER_SECRET");
      return Response.json({ access_token: "SYNTHETIC_ACCESS_TOKEN_NEVER_DISPLAY", expires_in: tokenSeconds, scope: scopes.join(" ") });
    }
    if (url.pathname.endsWith("/introspectToken")) return Response.json({ active: true, scope: scopes.join(" ") });
    if (failRead) throw new Error("DO_NOT_EXPOSE_PROVIDER_BODY");
    if (url.origin === "https://graph.facebook.com") {
      if (url.pathname.endsWith("/me/permissions")) return Response.json({ data: scopes.map(permission => ({ permission, status: "granted" })) });
      if (url.pathname.endsWith("/me/adaccounts")) return Response.json(url.searchParams.has("after") ? { data: [page("act_3170", "FIXTURE Trade catalog")] } : { data: [page("act_2041", "FIXTURE Studio retail")], paging: { next: "https://untrusted.invalid/never-follow", cursors: { after: "page-two" } } });
      if (url.pathname.endsWith("/promote_pages")) return Response.json({ data: [{ id: "555", name: "FIXTURE Studio Page", instagram_business_account: { id: "556", username: "FIXTURE studio instagram" } }] });
    }
    if (url.origin === "https://api.linkedin.com") {
      if (url.pathname.endsWith("/adAccountUsers")) return Response.json({ elements: [{ account: "urn:li:sponsoredAccount:2041", role: "ACCOUNT_MANAGER", user: "urn:li:person:fixture-member" }], paging: { start: 0, count: 25, total: 1 } });
      if (url.pathname.endsWith("/adAccounts/2041")) return Response.json({ id: 2041, name: "FIXTURE LinkedIn retail", currency: "USD", status: "ACTIVE", servingStatuses: ["RUNNABLE"], reference: "urn:li:organization:555", referenceInfo: { organization: { id: 555, localizedName: "FIXTURE Studio organization" } } });
      if (url.pathname.endsWith("/organizationAcls")) return Response.json({ elements: [{ organization: "urn:li:organization:555", role: "ADMINISTRATOR", state: "APPROVED", roleAssignee: "urn:li:person:fixture-member" }], paging: { start: 0, count: 25, total: 1 } });
      if (url.pathname.endsWith("/organizations/555")) return Response.json({ id: 555, localizedName: "FIXTURE Studio organization" });
    }
    if (url.origin === "https://googleads.googleapis.com") {
      if (url.pathname.endsWith("customers:listAccessibleCustomers")) return Response.json({ resourceNames: ["customers/999"] });
      if (url.pathname.endsWith("googleAds:search")) return Response.json({ results: [{ customerClient: { id: "2041", descriptiveName: "FIXTURE Google retail", currencyCode: "USD", timeZone: "America/Chicago", manager: false, status: "ENABLED", level: "1" } }] });
    }
    throw new Error(`Unexpected fixture HTTP path (${init?.method})`);
  };
  const key = randomBytes(32);
  const custody = new HostAgent(store, "https://sdk.example", { [provider]: { clientId: "SYNTHETIC_APP", clientSecret: "SYNTHETIC_APP_SECRET", ...(provider === "linkedin" ? { linkedinAdvertising: { appId: "SYNTHETIC_APP_ID", clientId: "SYNTHETIC_APP", revision: "fixture-1", tier: "development" as const, supportedScopes: scopes } } : {}) } }, createCredentialCipher("fixture", () => key), fetcher);
  let policy: ConnectionAccessPolicy = { revision: "1", appLabel: "FIXTURE Marketing app", allowedOperations: ["setup", "report", "prepare", "activate", "pause"], allowedOAuthScopes: scopes, allowOffline: false, maxDurationSeconds: 7200, discoveryRetentionSeconds: 3600 };
  const connections = createConnections({ store, custody, accessPolicy: async () => policy, evidence: "fixture", ...(host ? {sessionAuthority:host.authority} : {}) });
  const unavailable = (): never => { throw new Error("paid_generation_forbidden_in_fixture"); };
  const native = new NativeProvider("linkedin", custody, store, (input, init) => connections.discovery.fetcher(input, init));
  const server = new MarketingServer(store, { meta: new NativeProvider("meta", custody, store, fetcher), google: new NativeProvider("google", custody, store, fetcher), linkedin: native }, { evidence: "generated", validate: unavailable, submit: unavailable, reconcile: unavailable }, custody, "fixture", undefined, undefined, { connections, ...(host ? {studio:{sessions:host.authority}} : {}) });
  const call = <K extends keyof ConnectionCommands>(command: K, input: ConnectionCommands[K]["input"]) => server.call(principal, "p", command, input);
  const change = (c: ConnectionView, extra = {}) => ({ connectionId: c.id, expectedRevision: c.revision, requestKey: randomBytes(16).toString("hex"), ...extra });
  const start = () => call("startConnection", { provider: { kind: "advertising", provider }, intent: { kind: "advertising", operations: write ? ["setup", "report", "prepare", "activate", "pause"] : ["setup", "report"] as Permission[] }, requestKey: randomBytes(16).toString("hex"), expiresAt: new Date(Date.now() + 3600000).toISOString(), offlineAccess: false });
  const routes = connections.routes({ origin: custody.origin, authenticate: async r => authenticate(r.headers.get("x-fixture-session") ?? aliceToken) });
  const authorize = async (c: ConnectionView) => {
    c = await call("reviewConnectionProviderAccess", change(c)); const r = c.accessReview!;
    c = await call("decideConnectionProviderAccess", { ...change(c), decisionRef: r.decisionRef, digest: r.digest, decision: "approved" });
    c = await call("beginConnectionHandoff", change(c));
    const handoff = await routes(new Request(custody.origin + c.handoffPath, { method: "POST", headers: { origin: custody.origin, "content-type": "application/x-www-form-urlencoded" }, body: `revision=${c.revision}` }));
    const location = new URL((await handoff!.json()).browserLocation);
    const callbackUrl = `${location.searchParams.get("redirect_uri")}?state=${location.searchParams.get("state")}&code=SYNTHETIC_CODE`;
    return { c: await call("connection", { connectionId: c.id }), callbackUrl, location };
  };
  const completeCallback = (callback: string | URL, token = aliceToken) => {
    const url = new URL(callback);
    return routes(new Request(url.origin + url.pathname.replace(/callback$/, "complete"), { method: "POST", headers: { origin: custody.origin, "content-type": "application/json", "x-fixture-session": token }, body: JSON.stringify({ state: url.searchParams.get("state"), code: url.searchParams.get("code") }) }));
  };
  const discovered = async () => {
    const a = await authorize(await start()); await completeCallback(a.callbackUrl);
    return call("discoverConnectionAccounts", change(await call("connection", { connectionId: a.c.id })));
  };
  const selected = async () => {
    let c = await discovered(); c = await call("selectConnectionAccount", { ...change(c), choiceRef: c.discovery.accounts[0]!.choiceRef });
    if (c.phase === "choosing_identity") { c = await call("connectionIdentities", change(c)); c = await call("selectConnectionIdentity", { ...change(c), choiceRefs: [c.discovery.identities[0]!.choiceRef] }); }
    return c;
  };
  const approved = async () => {
    let c = await selected(); c = await call("reviewConnectionAccess", change(c)); const r = c.accessReview!;
    return call("decideConnectionAccess", { ...change(c), decisionRef: r.decisionRef, digest: r.digest, decision: "approved" });
  };
  return { store, path, host, hostPath, server, native, connections, custody, fixtureKey: key.toString("base64"), principal, alice, bobPrincipal, bobToken, aliceToken, calls, call, change, start, authorize, discovered, selected, approved, routes, completeCallback,
    tokenLifetime: (seconds: number) => { tokenSeconds = seconds; },
    boundary: (fn: typeof boundary) => { boundary = fn; }, failExchange: () => { failExchange = true; }, failRead: (v: boolean) => { failRead = v; },
    policy: (next: ConnectionAccessPolicy) => { policy = next; }, currentPolicy: () => policy,
    close: async () => { await hostStore?.close(); await store.close(); if(process.env.MARKETING_TEST_RETAIN!=="1")rmSync(dir, { recursive: true, force: true }); } };
}
