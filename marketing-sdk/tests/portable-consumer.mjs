/* global process, console, Buffer */
// Independent package projection: public imports only; synthetic existing host DB
// and OAuth HTTP edges. No real provider request, cookie bridge or native widget.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { Store, HostAgent, createCredentialCipher, classifyConnectionRoute } from '@handrail/marketing/server';
import { externalSessionFixture } from './compiled/external-session-fixture.js';
import { mountMarketingConnections } from './compiled/connections-server.js';
import { loopbackGuard, qualifyGuard } from './connection-network-guard.mjs';

const artifacts = process.argv[2]; await mkdir(artifacts, { recursive: true });
const store = new Store('./portable-consumer.sqlite');
for (const project of ['p','other']) await store.db.prepare('INSERT INTO projects VALUES(?,?)').run(project, 'FIXTURE Project ' + project);
const host = await externalSessionFixture(store);
let origin, mount, providerCalls = 0, landingWithoutCookie = 0, loginCalls = 0;
const transport = async (input, init) => {
  const url = new URL(String(input)); providerCalls++; assert.equal(init.redirect, 'error');
  if (url.href === 'https://graph.facebook.com/v26.0/oauth/access_token') return Response.json({ access_token: 'SYNTHETIC_PRIVATE_TOKEN', expires_in: 3600, scope: 'ads_read' });
  if (url.pathname.endsWith('/me/permissions')) return Response.json({ data: [{ permission: 'ads_read', status: 'granted' }] });
  if (url.pathname.endsWith('/me/adaccounts')) return Response.json({ data: [{ id: 'act_2041', name: 'FIXTURE Retail', currency: 'USD', timezone_name: 'America/Chicago', account_status: 1, user_tasks: ['ANALYZE'] }] });
  throw new Error('Unexpected synthetic provider edge');
};
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    if (url.pathname === '/login' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
      return res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><h1>Independent fixture host login</h1><button id="login">Sign in as fixture Alice</button><p id="result"></p><script>document.getElementById("login").onclick=async()=>{await fetch("/fixture/login",{method:"POST"});document.getElementById("result").textContent="Signed in independently. Reopen your saved browser-start address."}</script>');
    }
    if (url.pathname === '/fixture/login' && req.method === 'POST') {
      assert.equal(req.headers.origin, origin); const session = await host.login(); loginCalls++;
      res.writeHead(200, { 'set-cookie': `host_session=${session.token}; HttpOnly; SameSite=Strict; Path=/`, 'cache-control': 'no-store' }); return res.end('{}');
    }
    if (url.pathname === '/marketing') { res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }); return res.end('<h1>Fixture host return</h1><p>Only a wake hint. Use the original authenticated app to read the saved connection.</p>'); }
    const classification = classifyConnectionRoute(url.pathname, req.method);
    if (classification === 'callback_landing' && req.headers['sec-fetch-site'] === 'cross-site') { assert.ok(req.headers.cookie === undefined, 'Strict cookie unexpectedly present'); landingWithoutCookie++; }
    else if (req.headers['sec-fetch-site'] === 'cross-site') { res.writeHead(403); return res.end('origin_denied'); }
    if (req.method === 'POST' && req.headers['x-preview-request'] !== '1') { res.writeHead(403); return res.end('missing_host_csrf_header'); }
    let size = 0; const chunks = [];
    for await (const chunk of req) { size += chunk.length; assert.ok(size <= 8192); chunks.push(chunk); }
    const headers = new Headers(); for (const [key,value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(key,value);
    const request = new Request(url, { method: req.method, headers, ...(req.method === 'POST' ? { body: Buffer.concat(chunks) } : {}) });
    const response = await mount.handle(request);
    if (!response) { res.writeHead(404); return res.end('not_found'); }
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) { res.writeHead(500); res.end('fixture_host_failed'); console.error('Fixture bridge failed; inspect the local fixture assertion.'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r)); origin = `http://127.0.0.1:${server.address().port}`;
const key = randomBytes(32), custody = new HostAgent(store, origin, { meta: { clientId: 'SYNTHETIC_APP', clientSecret: 'SYNTHETIC_APP_SECRET' } }, createCredentialCipher('fixture', () => key), transport);
const unavailable = () => { throw new Error('Paid generation forbidden'); };
mount = mountMarketingConnections({ store, custody, sessionAuthority: host.authority, authenticate: host.authenticate, evidence: 'fixture', returnPath: '/marketing', loginPath: '/login', mutationHeaders: () => ({ 'x-preview-request': '1' }),
  accessPolicy: async () => ({ revision: '1', appLabel: 'FIXTURE Marketing app', allowedOperations: ['setup','report'], allowedOAuthScopes: ['ads_read'], allowOffline: false, maxDurationSeconds: 7200, discoveryRetentionSeconds: 3600 }),
  generation: { evidence: 'generated', validate: unavailable, submit: unavailable, reconcile: unavailable },
});
const guard = await loopbackGuard(origin);
const browser = await chromium.launch({ headless: true, executablePath: process.env.MARKETING_CHROMIUM_PATH || undefined, proxy: { server: guard.server }, args: ['--no-sandbox','--proxy-bypass-list=<-loopback>','--disable-quic','--force-webrtc-ip-handling-policy=disable_non_proxied_udp','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] });
const screenshots = [], errors = [], proofs = [];
try {
  const probe = await browser.newContext({ serviceWorkers: 'block' });
  const negative = await qualifyGuard(probe, origin, guard);
  await writeFile(resolve(artifacts, 'network-negative-control.json'), JSON.stringify(negative, null, 2)); await probe.close();
  const baseline = guard.blocked.length;
  for (const width of [1440,390,320]) {
    const native = await host.login();
    const api = async (command, input) => {
      const response = await fetch(`${origin}/api/projects/p/${command}`, { method: 'POST', headers: { origin, 'x-preview-request': '1', cookie: `host_session=${native.token}`, 'content-type': 'application/json' }, body: JSON.stringify(input), redirect: 'error' });
      const value = await response.json(); assert.equal(response.status, 200, JSON.stringify(value)); return value;
    };
    const change = c => ({ connectionId: c.id, expectedRevision: c.revision, requestKey: randomUUID() });
    let c = await api('startConnection', { provider: { kind: 'advertising', provider: 'meta' }, intent: { kind: 'advertising', operations: ['setup','report'] }, expiresAt: new Date(Date.now()+3500000).toISOString(), offlineAccess: false, requestKey: randomUUID() });
    c = await api('reviewConnectionProviderAccess', change(c));
    c = await api('decideConnectionProviderAccess', { ...change(c), decisionRef: c.accessReview.decisionRef, digest: c.accessReview.digest, decision: 'approved' });
    c = await api('beginConnectionHandoff', change(c));
    const descriptor = c.handoff;
    const context = await browser.newContext({ viewport: { width, height: width === 1440 ? 1000 : 844 }, serviceWorkers: 'block' });
    // Explicit local emulation of the provider authorization response. Playwright
    // fulfills the exact authorize request before any socket opens; all other
    // external traffic is denied by routing AND the prequalified loopback proxy.
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === origin) return route.continue();
      if (url.origin === 'https://www.facebook.com' && url.pathname === '/v26.0/dialog/oauth') {
        if (!url.searchParams.has('redirect_uri')) return route.fulfill({ contentType: 'text/html', body: '<h1>Synthetic provider history</h1><p>The response was discarded. Use Forward to check the saved outcome.</p>' });
        const callback = new URL(url.searchParams.get('redirect_uri')); assert.equal(callback.origin, origin);
        callback.searchParams.set('state', url.searchParams.get('state')); callback.searchParams.set('code', 'SYNTHETIC_CODE');
        return route.fulfill({ contentType: 'text/html', headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }, body: `<!doctype html><h1>Synthetic provider response</h1><p>No provider network or live consent.</p><a href="${callback.href.replaceAll('&','&amp;')}">Return synthetic response</a><script>history.replaceState(null,'',location.pathname)</script>` });
      }
      await route.abort('blockedbyclient'); throw new Error('Unexpected browser egress');
    });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    const shot = async name => {
      assert.ok(!/[?&](code|state)=/.test(page.url())); assert.doesNotMatch(await page.locator('body').innerText(), /SYNTHETIC_CODE|SYNTHETIC_PRIVATE_TOKEN|SYNTHETIC_APP_SECRET/);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width} overflow`);
      const path = `${width}-${name}.png`; await page.screenshot({ path: resolve(artifacts,path), fullPage: true }); screenshots.push(path);
    };
    await page.goto(descriptor.browserStartUrl); await page.getByRole('heading', { name: 'Sign in or recover setup' }).waitFor(); await shot('independent-login-needed');
    await page.getByRole('link', { name: 'Sign in to this host' }).click(); await page.getByRole('button', { name: 'Sign in as fixture Alice' }).click();
    await page.getByText('Signed in independently.', { exact: false }).waitFor();
    const logged = await context.cookies();
    const wrong = await host.login('bob');
    await context.addCookies([{ name: 'host_session', value: wrong.token, url: origin, httpOnly: true, sameSite: 'Strict' }]);
    await page.goto(descriptor.browserStartUrl); await page.getByRole('heading', { name: 'Sign in or recover setup' }).waitFor(); await shot('wrong-login');
    assert.ok(!(await page.locator('body').innerText()).includes('FIXTURE Project'));
    await context.addCookies(logged);
    // Bounded synthetic clock/phase controls preserve and restore exact fixture record.
    const saved = await store.get('p', 'connection', c.id);
    await store.put('p', 'connection', c.id, { ...saved, providerDecision: { ...saved.providerDecision, expiresAt: new Date(0).toISOString() } });
    await page.goto(descriptor.browserStartUrl); await page.getByRole('heading', { name: 'This approval has expired' }).waitFor(); await shot('expired');
    await store.put('p', 'connection', c.id, { ...saved, view: { ...saved.view, phase: 'cancelled' } });
    await page.goto(descriptor.browserStartUrl); await page.getByRole('heading', { name: 'This setup was cancelled' }).waitFor(); await shot('cancelled');
    await store.put('p', 'connection', c.id, saved);
    await page.goto(descriptor.browserStartUrl); await page.getByRole('heading', { name: 'Continue this connection' }).waitFor(); await shot('claim');
    await page.getByText('Review the exact provider access you approved', { exact: true }).click(); await shot('claim-expanded');
    await page.reload(); await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.tagName), 'BUTTON');
    await page.keyboard.press('Enter'); await page.getByRole('heading', { name: 'Synthetic provider response' }).waitFor();
    const callbackAck = page.waitForResponse(r => r.url().endsWith('/meta/complete') && r.request().method() === 'POST');
    await page.getByRole('link', { name: 'Return synthetic response' }).click();
    assert.equal((await callbackAck).status(), 200);
    await page.getByText('Response recorded.', { exact: false }).waitFor(); await shot('completion');
    assert.equal((await store.list('p','grant')).length, proofs.length);
    await page.reload(); await page.getByText('This response is no longer available.', { exact: false }).waitFor(); await shot('reload-recovery');
    // Back to the intercepted synthetic edge and forward: no repeated exchange.
    const effects = providerCalls; await page.goBack(); await page.goForward(); await page.getByRole('heading', { name: 'Check your connection' }).waitFor(); assert.equal(providerCalls, effects);
    await page.getByRole('link', { name: 'Return to Connections' }).click(); await page.getByRole('heading', { name: 'Fixture host return' }).waitFor();
    c = await api('connection', { connectionId: descriptor.correlator }); assert.equal(c.phase,'choosing_account');
    c = await api('discoverConnectionAccounts', change(c)); c = await api('selectConnectionAccount', { ...change(c), choiceRef: c.discovery.accounts[0].choiceRef });
    c = await api('reviewConnectionAccess', change(c)); c = await api('decideConnectionAccess', { ...change(c), decisionRef: c.accessReview.decisionRef, digest: c.accessReview.digest, decision: 'approved' });
    c = await api('resumeConnection', change(c)); assert.equal(c.phase, 'verified');
    proofs.push({ width, independentLogin: true, strictCookieAbsentAtCallback: true, freshAuthenticatedCompletion: true, originalSessionResume: true, keyboard: true, reload: true, backForward: true });
    await context.close();
  }
  assert.equal(guard.blocked.length, baseline); assert.deepEqual(errors, []); assert.equal(loginCalls, 3); assert.ok(landingWithoutCookie >= 3);
  assert.equal((await store.db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).n, 0);
  assert.ok((await store.db.prepare('SELECT password_hash FROM users').all()).every(u => u.password_hash === ''));
  await writeFile(resolve(artifacts,'browser-result.json'), JSON.stringify({ passed: true, proofs, screenshots, providerCalls, landingWithoutCookie, loginCalls, evidence: 'synthetic public HTTP consumer; real SQLite external host sessions; zero SDK sessions/passwords; exact provider authorize request fulfilled locally without opening a socket', productionHost: 'unverified', nativeDevice: 'unverified' },null,2));
  console.log('Portable public consumer passed at 1440/390/320 with Strict callback, independent host login, original-session resume and zero SDK sessions.');
} finally { await browser.close(); await guard.close(); await new Promise(r => server.close(r)); await store.close(); }
