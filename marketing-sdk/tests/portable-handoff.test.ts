import { fork } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createConnections, HostAgent, byteDigest, classifyConnectionRoute, createStoreSessionAuthority, type Principal, type SessionInspection } from "@handrail/marketing/server";
import type { ConnectionView, ConnectionCommands, Provider } from "@handrail/marketing";
import { connectionFixture } from "./connection-fixture.js";
import { externalSessionFixture } from "./external-session-fixture.js";

async function fixture(provider: Provider = "meta") {
  const base = await connectionFixture(provider), host = await externalSessionFixture(base.store);
  const native = await host.login(), browser = await host.login(), wrong = await host.login("bob");
  const original = await host.principal(native.token), browserPrincipal = await host.principal(browser.token);
  let boundary: ((url: URL, part: "headers" | "body") => Promise<void>) | undefined;
  const custody = new HostAgent(base.store, base.custody.origin, base.custody.apps, base.custody.cipher, async (input, init) => {
    const response = await base.custody.fetcher(input, init), url = new URL(String(input));
    await boundary?.(url, "headers");
    const json = response.json.bind(response);
    response.json = async () => { const result = await json(); await boundary?.(url, "body"); return result; };
    return response;
  });
  const service = createConnections({ store: base.store, custody, accessPolicy: async () => base.currentPolicy(), sessionAuthority: host.authority, evidence: "fixture" });
  const routes = service.routes({ origin: custody.origin, authenticate: host.authenticate, loginPath: "/login", returnPath: "/marketing" });
  const call = <K extends keyof ConnectionCommands>(command: K, input: ConnectionCommands[K]["input"], principal = original, project = "p") => service.call(principal, project, command, input);
  const change = base.change;
  const start = (project = "p", principal = original) => call("startConnection", { provider: { kind: "advertising", provider }, intent: { kind: "advertising", operations: ["setup", "report"] }, expiresAt: new Date(Date.now() + 3500000).toISOString(), offlineAccess: false, requestKey: randomUUID() }, principal, project);
  const approved = async (project = "p", principal = original) => {
    let c = await start(project, principal);
    c = await call("reviewConnectionProviderAccess", change(c), principal, project);
    c = await call("decideConnectionProviderAccess", { ...change(c), decisionRef: c.accessReview!.decisionRef, digest: c.accessReview!.digest, decision: "approved" }, principal, project);
    return call("beginConnectionHandoff", change(c), principal, project);
  };
  const claimResponse = (c: ConnectionView, token = browser.token) => routes(host.request(token, c.handoffPath!, { method: "POST", headers: { origin: custody.origin, "content-type": "application/x-www-form-urlencoded", "sec-fetch-site": "same-origin" }, body: `revision=${c.revision}` }));
  const claim = async (c: ConnectionView, token = browser.token) => {
    const r = await claimResponse(c, token); assert.equal(r!.status, 200, await r!.clone().text());
    const location = new URL((await r!.json()).browserLocation);
    return { c, location, state: location.searchParams.get("state")!, callback: location.searchParams.get("redirect_uri")! };
  };
  const complete = (issued: Awaited<ReturnType<typeof claim>>, token = browser.token, override: { path?: string; body?: unknown; headers?: Record<string, string> } = {}) => routes(host.request(token, override.path ?? new URL(issued.callback).pathname.replace(/callback$/, "complete"), {
    method: "POST", headers: { origin: custody.origin, "content-type": "application/json", "sec-fetch-site": "same-origin", ...override.headers }, body: JSON.stringify(override.body ?? { state: issued.state, code: "SYNTHETIC_CODE" }),
  }));
  const read = (c: ConnectionView, principal = original) => call("connection", { connectionId: c.id }, principal, c.projectId);
  const selected = async () => {
    const issued = await claim(await approved()); assert.equal((await complete(issued))!.status, 200);
    let c = await read(issued.c); c = await call("discoverConnectionAccounts", change(c));
    c = await call("selectConnectionAccount", { ...change(c), choiceRef: c.discovery.accounts[0]!.choiceRef });
    if (c.phase === "choosing_identity") { c = await call("connectionIdentities", change(c)); c = await call("selectConnectionIdentity", { ...change(c), choiceRefs: [c.discovery.identities[0]!.choiceRef] }); }
    c = await call("reviewConnectionAccess", change(c));
    return call("decideConnectionAccess", { ...change(c), decisionRef: c.accessReview!.decisionRef, digest: c.accessReview!.digest, decision: "approved" });
  };
  return { ...base, host, native, browser, wrong, original, browserPrincipal, service, routes, call, start, approved, claim, claimResponse, complete, read, selected,
    setBoundary: (fn: typeof boundary) => { boundary = fn; } };
}

for (const provider of ["meta", "google", "linkedin"] as Provider[]) test(`portable: two fresh ${provider} projects share exact callback/app and retain issuance for exchange`, async () => {
  const f = await fixture(provider);
  try {
    const other = await f.host.principal(f.native.token, "other");
    const a = await f.claim(await f.approved()), b = await f.claim(await f.approved("other", other));
    assert.equal(a.callback, b.callback); assert.equal(a.callback, `https://sdk.example/api/marketing/oauth/${provider}/callback`);
    assert.notEqual(a.state, b.state); assert.equal(f.calls.length, 0);
    for (const issued of [a, b]) {
      const locator = await f.store.locateOAuthState(byteDigest(Buffer.from(issued.state)));
      assert.equal(locator.projectId, issued.c.projectId);
      const cb = await f.store.get<any>(locator.projectId, locator.kind, locator.id);
      assert.equal(cb.callbackUri, issued.callback); assert.ok(cb.appBinding); assert.ok(cb.browser); assert.ok(cb.authority);
      assert.equal(JSON.stringify(cb).includes(issued.state), false);
      const r = await f.complete(issued); assert.equal(r!.status, 200);
      assert.deepEqual(await r!.json(), { correlator: issued.c.id });
      assert.equal((await f.read(issued.c)).phase, "choosing_account");
    }
    assert.equal((await f.store.db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id LIKE 'external:%'").get())!.n, f.store.db.dialect === "postgres" ? "0" : 0);
    const users = await f.store.db.prepare("SELECT password_hash FROM users WHERE id LIKE 'external:%'").all();
    assert.ok(users.length > 0 && users.every(u => u.password_hash === ""));
    assert.equal((await f.store.list("p", "grant")).length, 0);
  } finally { await f.close(); }
});

test("portable: independent login, explicit same-actor claim, Strict cross-site GET without cookie and original-session resume", async () => {
  const f = await fixture();
  try {
    const c = await f.approved();
    assert.deepEqual(Object.keys(c.handoff!).sort(), ["browserStartUrl", "correlator", "expiresAt", "returnRouteId", "version"]);
    assert.equal(c.handoff!.correlator, c.id);
    const missing = await f.routes(new Request(c.handoff!.browserStartUrl));
    assert.equal(missing!.status, 409); assert.doesNotMatch(await missing!.text(), /FIXTURE Marketing app|ads_read|external:/);
    const wrong = await f.routes(f.host.request(f.wrong.token, c.handoffPath!)); assert.equal(wrong!.status, 409);
    assert.doesNotMatch(await wrong!.text(), /ads_read|FIXTURE Marketing app/);
    assert.equal((await f.claimResponse(c, f.wrong.token))!.status, 409);
    const issued = await f.claim(c);
    const landing = await f.routes(new Request(issued.callback + `?state=${issued.state}&code=SYNTHETIC_CODE`, { headers: { "sec-fetch-site": "cross-site" } }));
    assert.equal(landing!.status, 200); assert.equal(f.calls.length, 0); assert.equal(landing!.headers.get("referrer-policy"), "no-referrer");
    const html = await landing!.text(); assert.ok(html.includes("history.replaceState")); assert.ok(!html.includes(issued.state)); assert.doesNotMatch(html, /localStorage|sessionStorage|SYNTHETIC_CODE/);
    assert.equal((await f.complete(issued, f.native.token))!.status, 409);
    assert.equal((await f.complete(issued))!.status, 200);
    const newer = await f.host.login(); assert.equal((await f.complete(issued, newer.token))!.status, 401);
    let current = await f.read(c); current = await f.call("discoverConnectionAccounts", f.change(current), f.browserPrincipal);
    current = await f.call("selectConnectionAccount", { ...f.change(current), choiceRef: current.discovery.accounts[0]!.choiceRef }, f.browserPrincipal);
    current = await f.call("reviewConnectionAccess", f.change(current), f.browserPrincipal);
    current = await f.call("decideConnectionAccess", { ...f.change(current), decisionRef: current.accessReview!.decisionRef, digest: current.accessReview!.digest, decision: "approved" }, f.browserPrincipal);
    await assert.rejects(f.call("resumeConnection", f.change(current), f.browserPrincipal), /original_session_resume_required/);
    const replacement = await f.host.principal(newer.token);
    await assert.rejects(f.call("resumeConnection", f.change(current), replacement), /connection_session_changed/);
    const safe = await f.read(c, replacement); assert.equal(safe.account, null); assert.equal(safe.accessReview, null);
    assert.equal((await f.store.list("p", "grant")).length, 0);
    const key = f.change(current), done = await f.call("resumeConnection", key);
    assert.equal(done.phase, "verified"); assert.equal((await f.call("resumeConnection", key)).grantId, done.grantId);
    assert.equal((await f.store.list("p", "grant")).length, 1);
  } finally { await f.close(); }
});

test("portable: ambiguity, route/app/project swaps, injection and replay fail closed", async () => {
  const f = await fixture();
  try {
    const issued = await f.claim(await f.approved()), hash = byteDigest(Buffer.from(issued.state));
    await assert.rejects(f.store.locateOAuthState("not-a-digest"), /oauth_state_invalid/);
    await assert.rejects(f.store.locateOAuthState("f".repeat(64)), /oauth_state_invalid/);
    assert.equal((await f.complete(issued, undefined, { path: "/api/marketing/oauth/google/complete" }))!.status, 409);
    assert.equal((await f.complete(issued, undefined, { path: "/api/oauth/other/meta/complete" }))!.status, 409);
    assert.equal((await f.complete(issued, undefined, { body: { state: issued.state, code: "x", project: "other", success: true } }))!.status, 422);
    for (const headers of [{ origin: "https://wrong.example" }, { "sec-fetch-site": "cross-site" }, { "content-type": "text/plain" }] as Record<string, string>[]) assert.ok((await f.complete(issued, undefined, { headers }))!.status >= 400);
    const cb = await f.store.get<any>("p", "connectionCallback", hash);
    await f.store.put("other", "connectionCallback", hash, cb);
    await assert.rejects(f.store.locateOAuthState(hash), /oauth_state_invalid/); assert.equal((await f.complete(issued))!.status, 409); assert.equal(f.calls.length, 0);
    await f.store.db.prepare("DELETE FROM records WHERE project_id=? AND kind=? AND id=?").run("other", "connectionCallback", hash);
    f.custody.apps.meta!.clientId = "other-app"; assert.equal((await f.complete(issued))!.status, 409); assert.equal(f.calls.length, 0);
    f.custody.apps.meta!.clientId = "SYNTHETIC_APP";
    assert.equal((await f.complete(issued))!.status, 200); const count = f.calls.length;
    assert.equal((await f.complete(issued))!.status, 200); assert.equal(f.calls.length, count);
    assert.equal((await f.store.list("p", "grant")).length, 0);
    assert.equal(classifyConnectionRoute("/api/marketing/oauth/meta/callback", "GET"), "callback_landing");
    assert.equal(classifyConnectionRoute("/api/marketing/oauth/meta/callback", "POST"), "private");
    assert.equal(classifyConnectionRoute("/api/marketing/oauth/arbitrary/callback", "GET"), null);
    assert.equal(classifyConnectionRoute("/api/projects/p/connections", "GET"), null);
  } finally { await f.close(); }
});

for (const session of ["native", "browser"] as const) for (const phase of ["exchange", "accounts", "verify"] as const) for (const part of ["headers", "body"] as const) test(`portable: ${session} logout during ${phase} ${part} fences authority`, async () => {
  const f = await fixture();
  try {
    const issued = phase === "verify" ? null : await f.claim(await f.approved());
    if (phase === "accounts") await f.complete(issued!);
    const c = phase === "verify" ? await f.selected() : await f.read(issued!.c);
    let changed = false;
    f.setBoundary(async (url, boundary) => {
      if (!changed && boundary === part && (phase === "exchange" ? url.pathname.endsWith("access_token") : url.pathname.endsWith("adaccounts"))) { changed = true; await f.host.revoke(f[session].sessionRef); }
    });
    if (phase === "exchange") await f.complete(issued!);
    else await assert.rejects(f.call(phase === "verify" ? "resumeConnection" : "discoverConnectionAccounts", f.change(c)), /authentication_required/);
    assert.ok(changed); assert.equal((await f.store.list("p", "grant")).length, 0);
    const saved = await f.store.get<any>("p", "connection", c.id); assert.equal(saved.view.grantId, null);
    if (phase === "exchange") { assert.notEqual(saved.view.providerAuthorized.status, "verified"); assert.equal((await f.store.list<any>("p", "connectionCallback"))[0].status, "received"); }
  } finally { await f.close(); }
});

for (const change of ["disable", "role", "configuration", "expiry", "policy"] as const) test(`portable: ${change} during provider boundary cannot create authority`, async () => {
  const f = await fixture();
  try {
    const c = await f.selected(); let changed = false;
    f.setBoundary(async () => { if (changed) return; changed = true;
      if (change === "disable") await f.host.disable();
      if (change === "role") await f.host.changeRole("analyst");
      if (change === "configuration") await f.host.changeConfiguration();
      if (change === "expiry") await f.store.db.prepare("UPDATE fixture_host_sessions SET expires_at=0 WHERE id=?").run(f.browser.sessionRef);
      if (change === "policy") f.policy({ ...f.currentPolicy(), revision: "changed" });
    });
    await assert.rejects(f.call("resumeConnection", f.change(c)), /authentication_required|forbidden|session_authority_changed|configuration_changed/);
    assert.equal((await f.store.list("p", "grant")).length, 0);
  } finally { await f.close(); }
});

for (const authority of ["store", "external"] as const) for (const action of ["logout", "disable"] as const) test(`portable: ${authority} final SQL commit is serialized against ${action}`, async () => {
  const f = await fixture();
  try {
    const c = authority === "external" ? await f.selected() : await f.approved();
    // External path uses a real host SQL guard. Built-in path is exercised below
    // directly as the same bounded primitive around a real local record commit.
    const port = authority === "external" ? f.host.authority : createStoreSessionAuthority(f.store);
    const p: Principal = authority === "external" ? f.original : f.principal;
    const expected: SessionInspection = authority === "external" ? (await f.store.get<any>("p", "connection", c.id)).authority :
      await port.inspectSession({ issuer: "marketing:store", subject: p.userId, userId: p.userId, sessionRef: p.sessionTokenHash! }, "p");
    let entered!: () => void, release!: () => void;
    const acquired = new Promise<void>(r => { entered = r; }), gate = new Promise<void>(r => { release = r; });
    const events: string[] = [];
    const commit = port.withLiveSessions([expected], async () => {
      entered(); await gate; await f.store.put("p", "fixtureLocalCommit", "once", { id: "once" }); events.push("commit");
    });
    await acquired;
    const revoke = (authority === "external" ? action === "logout" ? f.host.revoke(f.native.sessionRef) : f.host.disable() : action === "logout" ? f.store.revokeSession(f.aliceToken) : f.store.db.prepare("UPDATE users SET disabled=1 WHERE id=?").run(p.userId)).then(() => events.push("revoked"));
    release(); await Promise.all([commit, revoke]); assert.deepEqual(events, ["commit", "revoked"]);
    await assert.rejects(port.withLiveSessions([expected], async () => { throw new Error("must never enter"); }), /authentication_required/);
  } finally { await f.close(); }
});

for (const wins of ["commit", "logout"] as const) test(`portable: actual external Grant final commit vs logout, ${wins} wins serialization`, async () => {
  const f = await fixture();
  try {
    const c = await f.selected();
    let signal!: () => void, release!: () => void;
    const reached = new Promise<void>(r => { signal = r; }), gate = new Promise<void>(r => { release = r; });
    let armed = true;
    if (wins === "commit") {
      const put = f.store.put.bind(f.store);
      f.store.put = async (...args) => {
        if (args[1] === "grant" && armed) { armed = false; signal(); await gate; }
        return put(...args);
      };
    } else {
      const guarded = f.host.authority.withLiveSessions.bind(f.host.authority); let count = 0;
      f.host.authority.withLiveSessions = async (expected, local) => {
        if (++count === 2) { signal(); await gate; }
        return guarded(expected, local);
      };
    }
    const result = f.call("resumeConnection", f.change(c)).then(v => ({ value: v, error: null }), e => ({ value: null, error: e }));
    await reached;
    const revoked = f.host.revoke(f.native.sessionRef);
    if (wins === "logout") await revoked;
    release(); await result; await revoked;
    const grants = await f.store.list("p", "grant"); assert.equal(grants.length, wins === "commit" ? 1 : 0);
    const record = await f.store.get<any>("p", "connection", c.id);
    assert.equal(record.view.phase === "verified", wins === "commit");
  } finally { await f.close(); }
});

test("portable: lost claim acknowledgement returns the original state; expired or changed claims cannot replace it", async t => {
  const f = await fixture();
  try {
    const c = await f.approved(), issued = await f.claim(c), current = await f.read(c);
    const recovered = await f.claim(current); assert.equal(recovered.state, issued.state);
    assert.equal((await f.store.list("p", "connectionCallback")).length, 1);
    const newBrowser = await f.host.login(); assert.equal((await f.claimResponse(current, newBrowser.token))!.status, 409);
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 301000 });
    assert.equal((await f.complete(issued))!.status, 409); assert.equal(f.calls.length, 0);
  } finally { t.mock.timers.reset(); await f.close(); }
});

test("portable: modern authority with an old project-path URI exchanges exactly that URI", async () => {
  const f = await connectionFixture("google");
  try {
    const issued = await f.authorize(await f.start()), key = byteDigest(Buffer.from(issued.location.searchParams.get("state")!));
    const cb = await f.store.get<any>("p", "connectionCallback", key);
    const payload = JSON.parse(f.custody.cipher.decryptPayloadAsString(cb.sealed.encrypted, cb.sealed.keyId));
    const oldUri = "https://sdk.example/api/oauth/p/google/callback", url = new URL(payload.url);
    url.searchParams.set("redirect_uri", oldUri); payload.url = url.href;
    cb.sealed = f.custody.cipher.encryptPayload(JSON.stringify(payload)); delete cb.callbackUri; delete cb.appBinding;
    await f.store.put("p", "connectionCallback", key, cb);
    const transport = f.custody.fetcher;
    (f.custody as { fetcher: typeof fetch }).fetcher = async (input, init) => {
      assert.equal(new URLSearchParams(String(init!.body)).get("redirect_uri"), oldUri);
      return transport(input, init);
    };
    const newRoute = await f.completeCallback(issued.callbackUrl); assert.equal(newRoute!.status, 409); assert.equal(f.calls.length, 0);
    const oldCallback = new URL(issued.callbackUrl); oldCallback.pathname = new URL(oldUri).pathname;
    assert.equal((await f.completeCallback(oldCallback))!.status, 200);
    assert.equal((await f.call("connection", { connectionId: issued.c.id })).phase, "choosing_account");
    assert.equal((await f.store.get<any>("p", "connectionCallback", key)).sealed.encrypted, cb.sealed.encrypted);
  } finally { await f.close(); }
});

test("portable: a state from another project's differently claimed browser cannot be substituted", async () => {
  const f = await fixture();
  try {
    const first = await f.claim(await f.approved());
    const otherOriginal = await f.host.principal(f.native.token, "other"), otherBrowser = await f.host.login();
    const second = await f.claim(await f.approved("other", otherOriginal), otherBrowser.token);
    assert.ok((await f.complete(first, otherBrowser.token))!.status >= 400);
    assert.ok((await f.complete(second, f.browser.token))!.status >= 400);
    assert.equal(f.calls.length, 0);
    assert.equal((await f.complete(first))!.status, 200);
    assert.equal((await f.read(first.c)).projectId, "p");
    assert.notEqual((await f.read(second.c)).providerAuthorized.status, "verified");
  } finally { await f.close(); }
});

// Enumerate the actual read sequence rather than assuming one HTTP await per
// operation. Every observed headers/body boundary is an independent revocation
// point, including Google manager traversal and LinkedIn introspection/finders.
for (const provider of ["meta", "google", "linkedin"] as Provider[]) for (const operation of ["accounts", "verify"] as const) test(`portable: both sessions fence every ${provider} ${operation} remote boundary`, async t => {
  const baseline = await fixture(provider); let count = 0;
  try {
    let c: ConnectionView;
    if (operation === "verify") c = await baseline.selected();
    else { const issued = await baseline.claim(await baseline.approved()); await baseline.complete(issued); c = await baseline.read(issued.c); }
    baseline.setBoundary(async () => { count++; });
    await baseline.call(operation === "verify" ? "resumeConnection" : "discoverConnectionAccounts", baseline.change(c));
    assert.ok(count > 0);
  } finally { await baseline.close(); }
  for (const session of ["native", "browser"] as const) for (let stopAt = 1; stopAt <= count; stopAt++) await t.test(`${session} boundary ${stopAt}/${count}`, async () => {
    const f = await fixture(provider);
    try {
      let c: ConnectionView;
      if (operation === "verify") c = await f.selected();
      else { const issued = await f.claim(await f.approved()); await f.complete(issued); c = await f.read(issued.c); }
      let seen = 0;
      f.setBoundary(async () => { if (++seen === stopAt) await f.host.revoke(f[session].sessionRef); });
      await assert.rejects(f.call(operation === "verify" ? "resumeConnection" : "discoverConnectionAccounts", f.change(c)), /authentication_required/);
      assert.equal(seen, stopAt, "No subsequent provider boundary after revocation");
      assert.equal((await f.store.list("p", "grant")).length, 0);
    } finally { await f.close(); }
  });
});

test("portable: browser status rechecks the original session after an awaited policy read", async () => {
  const f = await fixture();
  try {
    const c = await f.selected(); let changed = false;
    const service = createConnections({ ...f.service.options, accessPolicy: async () => {
      if (!changed) { changed = true; await f.host.revoke(f.native.sessionRef); }
      return f.currentPolicy();
    } });
    await assert.rejects(service.call(f.browserPrincipal, "p", "connection", { connectionId: c.id }), /authentication_required/);
    const safe = await service.call(f.browserPrincipal, "p", "connection", { connectionId: c.id });
    assert.equal(safe.account, null); assert.deepEqual(safe.discovery.accounts, []);
  } finally { await f.close(); }
});

for (const provider of ["google", "linkedin"] as Provider[]) for (const session of ["native", "browser"] as const) for (const part of ["headers", "body"] as const) test(`portable: ${provider} exchange ${part} rechecks ${session}`, async () => {
  const f = await fixture(provider);
  try {
    const issued = await f.claim(await f.approved()); let changed = false;
    f.setBoundary(async (_url, at) => { if (!changed && at === part) { changed = true; await f.host.revoke(f[session].sessionRef); } });
    await f.complete(issued); assert.ok(changed);
    assert.equal((await f.store.list("p", "grant")).length, 0);
    const saved = await f.store.get<any>("p", "connection", issued.c.id); assert.notEqual(saved.view.providerAuthorized.status, "verified");
  } finally { await f.close(); }
});

test("portable: no membership is granted for a client-selected unauthorized project", async () => {
  const f = await fixture();
  try {
    await f.store.db.prepare("INSERT INTO projects VALUES(?,?)").run("client-picked", "Unauthorized project");
    await assert.rejects(f.host.principal(f.native.token, "client-picked"), /authentication_required/);
    assert.equal((await f.store.db.prepare("SELECT user_id FROM memberships WHERE project_id=?").all("client-picked")).length, 0);
  } finally { await f.close(); }
});

test("portable: legacy grant-only callback safely restarts without session or app provenance", async () => {
  const f = await connectionFixture();
  try {
    const ready = await f.call("resumeConnection", f.change(await f.approved()));
    const location = new URL(await f.custody.begin(f.principal, "p", ready.grantId!));
    const callback = new URL(location.searchParams.get("redirect_uri")!);
    callback.searchParams.set("state", location.searchParams.get("state")!); callback.searchParams.set("code", "SYNTHETIC_LEGACY_CODE");
    const before = f.calls.length;
    const landing = await f.routes(new Request(callback)); assert.equal(landing!.status, 200); assert.equal(f.calls.length, before);
    const completed = await f.completeCallback(callback); assert.equal(completed!.status, 409);
    assert.deepEqual(await completed!.json(), { error: "secure_completion_unavailable" });
    assert.equal((await f.store.list("p", "grant")).length, 1);
    assert.equal((await f.completeCallback(callback))!.status, 409); assert.equal(f.calls.length, before);
  } finally { await f.close(); }
});

for (const winner of ["grant", "revocation"] as const) for (const action of ["logout", "disable", "role", "project", "configuration", "expiry"] as const) test(`review: independent SQL process ${action}, ${winner} commits first`, { timeout: 15000 }, async () => {
  const f = await fixture();
  const child = fork(new URL("./session-race-child.js", import.meta.url), [f.path], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  let release: (() => void) | undefined;
  try {
    const [ready] = await once(child, "message"); assert.equal(ready.event, "ready"); assert.notEqual(ready.pid, process.pid);
    const c = await f.selected();
    let signal!: () => void;
    const entered = new Promise<void>(r => { signal = r; });
    const gate = new Promise<void>(r => { release = r; });
    const put = f.store.put.bind(f.store);
    if (winner === "grant") f.store.put = async (...args) => {
      if (args[1] === "grant") { signal(); await gate; }
      return put(...args);
    };
    let revoked = false;
    const committed = new Promise<void>(resolve => child.on("message", (m: any) => { if (m.event === "committed") { revoked = true; resolve(); } }));
    let grant: Promise<unknown>;
    if (winner === "grant") {
      grant = f.call("resumeConnection", f.change(c)).catch(e => e);
      await entered;
      const attempted = once(child, "message"); child.send({ session: f.native.sessionRef, action, hold: false });
      assert.equal((await attempted)[0].event, "attempt");
      await delay(150); assert.equal(revoked, false, "Independent writer must wait for SDK SQL commit");
      release!(); await grant; await committed;
    } else {
      const locked = new Promise<void>(resolve => child.on("message", (m: any) => { if (m.event === "locked") resolve(); }));
      child.send({ session: f.native.sessionRef, action, hold: true }); await locked;
      let settled = false;
      grant = f.call("resumeConnection", f.change(c)).then(() => { settled = true; }, e => { settled = true; return e; });
      // SQLite's synchronous BEGIN needs the child to release independently.
      child.send({ release: true });
      const outcome = await grant; await committed;
      assert.ok(outcome instanceof Error); assert.ok(settled);
    }
    assert.equal((await f.store.list("p", "grant")).length, winner === "grant" ? 1 : 0);
    assert.equal((await f.store.get<any>("p", "connection", c.id)).view.phase === "verified", winner === "grant");
  } finally { release?.(); child.kill("SIGKILL"); await f.close(); }
});

test("review: missing historical authority fails closed without exchanging or rewriting ciphertext", async () => {
  const f = await fixture();
  try {
    const issued = await f.claim(await f.approved());
    const key = byteDigest(Buffer.from(issued.state)), cb = await f.store.get<any>("p", "connectionCallback", key);
    // A corruption/compatibility negative control, NOT historical provenance.
    delete cb.authority; delete cb.browser; delete cb.connectionRevision; delete cb.decisionDigest;
    await f.store.put("p", "connectionCallback", key, cb);
    assert.equal((await f.complete(issued))!.status, 409); assert.equal(f.calls.length, 0);
    assert.deepEqual(await f.store.get("p", "connectionCallback", key), cb);
  } finally { await f.close(); }
});

test("review: authenticated host header bootstrap stays private and validates bounded custom headers", async () => {
  const f = await fixture();
  try {
    let calls = 0;
    const routes = f.service.routes({ origin: f.custody.origin, authenticate: f.host.authenticate, mutationHeaders: () => { calls++; return { "x-preview-request": "1", "x-csrf-token": "synthetic</script>" }; } });
    const path = "/api/marketing/oauth/meta/complete";
    assert.ok((await routes(new Request(f.custody.origin + path)))!.status >= 400); assert.equal(calls, 0);
    const landing = await routes(new Request(f.custody.origin + "/api/marketing/oauth/meta/callback?code=x"));
    assert.equal(landing!.status, 200); assert.equal(calls, 0);
    const bootstrap = await routes(f.host.request(f.browser.token, path));
    assert.equal(bootstrap!.status, 200); assert.deepEqual(await bootstrap!.json(), { headers: { "x-preview-request": "1", "x-csrf-token": "synthetic</script>" } });
    const c = await f.approved(), html = await (await routes(f.host.request(f.browser.token, c.handoffPath!)))!.text();
    assert.ok(html.includes("x-preview-request")); assert.ok(!html.includes("synthetic</script>"));
    const bad = f.service.routes({ origin: f.custody.origin, authenticate: f.host.authenticate, mutationHeaders: () => ({ authorization: "forbidden" }) });
    assert.ok((await bad(f.host.request(f.browser.token, path)))!.status >= 400);
  } finally { await f.close(); }
});

for (const entry of ["claim", "headers"] as const) test(`shared review: ${entry} rechecks after awaited host mutation headers`, async () => {
  const f = await fixture();
  try {
    const c = await f.approved();
    const routes = f.service.routes({ origin: f.custody.origin, authenticate: f.host.authenticate,
      mutationHeaders: async () => { await f.host.revoke(f.browser.sessionRef); return { "x-preview-request": "1" }; } });
    const response = await routes(f.host.request(f.browser.token, entry === "claim" ? c.handoffPath! : "/api/marketing/oauth/meta/complete"));
    assert.ok(response!.status >= 400);
    const body = await response!.text();
    assert.ok(!body.includes("FIXTURE Fieldwork") && !body.includes('"x-preview-request"'));
    assert.equal(f.calls.length, 0);
  } finally { await f.close(); }
});

test("review: concurrent browser claims and tampered issued nonce cannot create a second effect", async () => {
  const f = await fixture();
  try {
    const c = await f.approved(), second = await f.host.login();
    const responses = await Promise.all([f.claimResponse(c), f.claimResponse(c, second.token)]);
    assert.deepEqual(responses.map(r => r!.status).sort(), [200, 409]);
    const success = responses.find(r => r!.status === 200)!;
    const url = new URL((await success.json()).browserLocation), state = url.searchParams.get("state")!;
    const cb = (await f.store.list<any>("p", "connectionCallback"))[0];
    assert.equal((await f.store.list("p", "connectionCallback")).length, 1);
    const payload = JSON.parse(f.custody.cipher.decryptPayloadAsString(cb.sealed.encrypted, cb.sealed.keyId));
    const tampered = new URL(payload.url); tampered.searchParams.set("state", "x".repeat(43)); payload.url = tampered.href;
    cb.sealed = f.custody.cipher.encryptPayload(JSON.stringify(payload)); await f.store.put("p", "connectionCallback", cb.id, cb);
    const winner = responses[0]!.status === 200 ? f.browser.token : second.token;
    assert.equal((await f.complete({ c, location: url, state, callback: url.searchParams.get("redirect_uri")! }, winner))!.status, 409);
    assert.equal(f.calls.length, 0); assert.equal((await f.store.get<any>("p", "connectionCallback", cb.id)).status, "prepared");
  } finally { await f.close(); }
});

test("review: private completion rejects duplicate JSON, oversized bodies and encoded route/query tampering", async () => {
  const f = await fixture();
  try {
    const issued = await f.claim(await f.approved());
    const path = "/api/marketing/oauth/meta/complete";
    for (const body of [`{"state":"${issued.state}","state":"${issued.state}","code":"x"}`, JSON.stringify({ state: issued.state, code: "x".repeat(9000) })]) {
      const response = await f.routes(f.host.request(f.browser.token, path, { method: "POST", headers: { origin: f.custody.origin, "content-type": "application/json" }, body }));
      assert.ok(response!.status >= 400);
    }
    for (const route of [path + "?project=p", path.replace("meta", "%6deta"), path.replace("/complete", "%2fcomplete"), "/api/oauth/%70/meta/complete"]) {
      const result = await f.complete(issued, undefined, { path: route }); assert.ok(result === null || result.status >= 400);
    }
    assert.equal(f.calls.length, 0);
  } finally { await f.close(); }
});


test('shared review: natural session expiry inside final Grant transaction rolls back',async t=>{
 const f=await fixture();try{
  const c=await f.selected(), now=Date.now(), put=f.store.put.bind(f.store);
  t.mock.timers.enable({apis:['Date'],now});
  f.store.put=async(...args)=>{await put(...args);if(args[1]==='grant')t.mock.timers.setTime(now+7200000);};
  await assert.rejects(f.call('resumeConnection',f.change(c)),/authentication_required|session_authority_changed/);
  assert.equal((await f.store.list('p','grant')).length,0);
 }finally{t.mock.timers.reset();await f.close();}
});
