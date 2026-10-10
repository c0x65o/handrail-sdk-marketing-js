/* global process, console, Buffer */
// Executed inside the independent packed consumer. Only package public exports.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright';
import { build } from 'vite';
import { loopbackGuard, qualifyGuard } from './connection-network-guard.mjs';
import { Store, HostAgent, createCredentialCipher } from '@handrail/marketing/server';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { externalSessionFixture } from './compiled/external-session-fixture.js';
import { mountManualCreativeConnections } from './compiled/creative-server.js';

const artifacts = process.argv[2]; await mkdir(artifacts, { recursive: true });
const store = new Store('./connections-consumer.sqlite');
const hostStore = new Store('./shared-host.sqlite'), authenticationStore = new Store('./shared-host.sqlite');
const host = await externalSessionFixture(store, hostStore, authenticationStore);
for (const project of ['consumer','consumer390','consumer320']) {
  await store.db.prepare('INSERT INTO projects VALUES(?,?)').run(project, 'FIXTURE Fieldwork — long project label for narrow layout and unambiguous account selection');
  await hostStore.db.prepare('INSERT INTO fixture_host_memberships VALUES(?,?,?)').run('alice', project, 'admin');
}
// Independent process writes only this disposable fixture's host sessions.
await writeFile('fixture-revoke.mjs', `import { Store } from '@handrail/marketing/server'; const s=new Store('./shared-host.sqlite'); await s.transaction(()=>s.db.prepare('UPDATE fixture_host_sessions SET revoked=1 WHERE id=?').run(process.argv[2])); await s.close();`);
const revoke = async session => { const child=fork('./fixture-revoke.mjs',[session],{stdio:['ignore','ignore','pipe','ipc']}); assert.equal((await once(child,'exit'))[0],0); };
let currentSession;
const creativeProofs = [], diagnostics = [];

let origin, mount, failNextRead = false, tokenSeconds = 3600, approvedMetaScopes = "", approvedLinkedInScopes = "";
const requests = [], browserErrors = [], sdkReads = []; const lifecycleProof = {};
const transport = async (input, init) => {
  const url = new URL(String(input)); requests.push(url.origin + url.pathname);
  assert.ok(['https://graph.facebook.com','https://oauth2.googleapis.com','https://googleads.googleapis.com','https://www.linkedin.com','https://api.linkedin.com'].includes(url.origin)); assert.equal(init.redirect, 'error');
  if (url.origin === 'https://oauth2.googleapis.com') return Response.json({ access_token: 'SYNTHETIC_GOOGLE_TOKEN', expires_in: 3600, scope: 'https://www.googleapis.com/auth/adwords' });
  if (url.pathname.endsWith('/accessToken')) return Response.json({ access_token: 'SYNTHETIC_LINKEDIN_TOKEN', expires_in: 3600, scope: approvedLinkedInScopes });
  if (url.pathname.endsWith('/introspectToken')) return Response.json({ active: true, scope: approvedLinkedInScopes });
  if (url.pathname.endsWith('customers:listAccessibleCustomers')) return Response.json({ resourceNames: ['customers/999'] });
  if (url.pathname.endsWith('googleAds:search')) return Response.json({ results: [{ customerClient: { id: '2041', descriptiveName: 'FIXTURE Google retail', currencyCode: 'USD', timeZone: 'America/Chicago', manager: false, status: 'ENABLED', level: '1' } }] });
  if (url.pathname.endsWith('/adAccountUsers')) return Response.json({ elements: ['2041','12041'].map(id => ({ account: 'urn:li:sponsoredAccount:' + id, role: 'ACCOUNT_MANAGER', user: 'urn:li:person:fixture-member' })), paging: { start: 0, count: 25, total: 2 } });
  if (/\/adAccounts\/(2041|12041)$/.test(url.pathname)) return Response.json({ id: Number(url.pathname.split('/').at(-1)), name: 'FIXTURE LinkedIn retail', currency: 'USD', status: 'ACTIVE', reference: 'urn:li:organization:555', referenceInfo: { organization: { id: 555, localizedName: 'FIXTURE LinkedIn Page' } } });
  if (url.pathname.endsWith('/organizationAcls')) {
    const start = Number(url.searchParams.get('start'));
    return Response.json(start === 0 ? { elements: [], paging: { start: 0, count: 25, links: [{ rel: 'next', href: '/rest/organizationAcls?q=roleAssignee&state=APPROVED&start=25&count=25' }] } } : { elements: [{ organizationTarget: 'urn:li:organization:555', roleAssignee: 'urn:li:person:fixture-member', role: 'DIRECT_SPONSORED_CONTENT_POSTER', state: 'APPROVED' }], paging: { start, count: 25, links: [] } });
  }
  if (url.pathname.endsWith('/oauth/access_token')) return Response.json({ access_token: 'SYNTHETIC_TOKEN_NEVER_DISPLAY', expires_in: tokenSeconds, scope: approvedMetaScopes });
  if (failNextRead) { failNextRead = false; throw new Error('SYNTHETIC_PRIVATE_PROVIDER_FAILURE'); }
  if (url.pathname.endsWith('/me/permissions')) return Response.json({ data: approvedMetaScopes.split(/[ ,]+/).filter(Boolean).map(permission => ({ permission, status: 'granted' })) });
  if (url.pathname.endsWith('/me/adaccounts')) return Response.json({ data: [
    { id: 'act_2041', name: 'FIXTURE Studio retail', business: { name: 'Fixture business' }, currency: 'USD', timezone_name: 'America/Chicago', account_status: 1, user_tasks: ['ANALYZE','ADVERTISE'] },
    { id: 'act_3170', name: 'FIXTURE Trade catalog', currency: 'USD', timezone_name: 'America/New_York', account_status: 1, user_tasks: ['ANALYZE','ADVERTISE'] },
  ] });
  if (url.pathname.endsWith('/promote_pages') && !url.searchParams.has('after')) return Response.json({ data: [], paging: { next: 'https://never-follow.invalid', cursors: { after: 'identities-page-two' } } });
  if (url.pathname.endsWith('/promote_pages')) return Response.json({ data: [{ id: '555', name: 'FIXTURE Studio Page', instagram_business_account: { id: '556', username: 'FIXTURE Studio Instagram' } }] });
  throw new Error('Unexpected synthetic provider path');
};
// Node HTTP bridge is counted as host glue; this is not an in-process MarketingClient.
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    if (url.pathname === '/fixture/login' && req.method === 'POST') {
      const { token, sessionRef } = await host.login(); currentSession = sessionRef;
      res.writeHead(200, { 'set-cookie': `host_session=${token}; HttpOnly; SameSite=Strict; Path=/`, 'content-type': 'application/json' }); return res.end('{}');
    }
    if (req.method === 'POST' && req.headers['x-preview-request'] !== '1') { res.writeHead(403); return res.end('missing_host_mutation_header'); }
    if (/\/(workspace|connections)$/.test(url.pathname)) sdkReads.push(url.pathname.split('/').at(-1));
    const buffers = []; let length = 0;
    for await (const chunk of req) { length += chunk.length; if (length > 262144) throw new Error('body too large'); buffers.push(chunk); }
    const headers = new Headers(); for (const [key, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(key, value);
    const response = await mount.handle(new Request(url, { method: req.method, headers, ...(req.method === 'POST' ? { body: Buffer.concat(buffers) } : {}) }));
    if (response) { res.writeHead(response.status, Object.fromEntries(response.headers)); return res.end(Buffer.from(await response.arrayBuffer())); }
    const path = resolve('web-dist', url.pathname === '/' ? 'index.html' : '.' + url.pathname);
    assert.ok(path.startsWith(resolve('web-dist') + '/'));
    res.writeHead(200, { 'content-type': extname(path) === '.js' ? 'text/javascript' : extname(path) === '.css' ? 'text/css' : 'text/html', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
    res.end(await readFile(path));
  } catch { diagnostics.push('fixture_host_failed'); res.writeHead(500); res.end('fixture_host_failed'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r)); origin = `http://127.0.0.1:${server.address().port}`;
const key = randomBytes(32), custody = new HostAgent(store, origin, { ...Object.fromEntries(['meta','google','linkedin'].map(p => [p, { clientId: 'SYNTHETIC_APP', clientSecret: 'SYNTHETIC_SECRET', ...(p === 'linkedin' ? { linkedinAdvertising: { appId: 'SYNTHETIC_APP_ID', clientId: 'SYNTHETIC_APP', revision: 'fixture-1', tier: 'development', supportedScopes: ['r_ads','rw_ads','r_ads_reporting','r_organization_admin','w_organization_social','r_organization_social'] } } : {}) }])) }, createCredentialCipher('fixture', () => key), transport);
const unavailable = () => { throw new Error('No paid generation in qualification'); };
mount = mountManualCreativeConnections({ store, custody, evidence: 'fixture', billing: { authorize: unavailable }, creativeEnvironment: 'shared-fixture',
  creativePolicy: async () => ({ revision: '1', environment: 'shared-fixture', appLabel: 'SYNTHETIC shared Connections', models: ['SYNTHETIC-long-model-label-for-explicit-selection-and-safe-narrow-layout'], maxDurationSeconds: 3600, grantIds: [] }),
  sessionAuthority: host.authority, mutationHeaders: () => ({ 'x-preview-request': '1' }),
  accessPolicy: async (_actor, _project, provider) => ({ revision: 'fixture-policy-1', appLabel: 'FIXTURE Marketing app', allowedOperations: ['setup','report','prepare','activate','pause'], allowedOAuthScopes: provider === 'google' ? ['https://www.googleapis.com/auth/adwords'] : provider === 'linkedin' ? ['r_ads','rw_ads','r_ads_reporting','r_organization_admin','w_organization_social','r_organization_social'] : ['ads_read','ads_management','pages_read_engagement'], maxDurationSeconds: 7200, discoveryRetentionSeconds: 3600, allowOffline: false }),
  authenticate: host.authenticate,
});
await writeFile('index.html', '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1" /><title>FIXTURE public Connections consumer</title></head><body style="margin:0"><div id="app"></div><script type="module" src="/connection-app.tsx"></script></body></html>');
await writeFile('connection-app.tsx', `import React from 'react'; import { createRoot } from 'react-dom/client'; import { createMarketingClient } from '@handrail/marketing'; import { MarketingConnections, MarketingWorkspace } from '@handrail/marketing/react'; import '@handrail/marketing/react/style.css'; const project = new URLSearchParams(location.search).get('project') || sessionStorage.getItem('fixture-project') || 'consumer'; sessionStorage.setItem('fixture-project', project); const client = createMarketingClient(location.origin, project, (input, init) => fetch(input, { ...init, headers: { ...init?.headers, 'x-preview-request': '1' } })); function Fixture(){ const [visible,setVisible]=React.useState(true); (window as any).fixtureVisibility=setVisible; return location.search === "?workspace" ? <MarketingWorkspace client={client} visible={visible} /> : <MarketingConnections client={client} visible={visible} sessionKey="fixture-owner-session" />; } createRoot(document.getElementById('app')!).render(<Fixture/>);`);
await build({ logLevel: 'error', build: { outDir: 'web-dist' } });
const guard = await loopbackGuard(origin);
let activePage;
const browser = await chromium.launch({ headless: true, executablePath: process.env.MARKETING_CHROMIUM_PATH || undefined, proxy: { server: guard.server }, args: ['--no-sandbox', '--proxy-bypass-list=<-loopback>', '--disable-quic', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, serviceWorkers: 'block' });
  const isolation = await qualifyGuard(context, origin, guard);
  await writeFile(resolve(artifacts, 'network-negative-control.json'), JSON.stringify(isolation, null, 2));
  const guardBaseline = guard.blocked.length;
  const page = await context.newPage(); activePage = page;
  page.on('pageerror', e => browserErrors.push(e.message));
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (['https://www.facebook.com/v26.0/dialog/oauth','https://accounts.google.com/o/oauth2/v2/auth','https://www.linkedin.com/oauth/v2/authorization'].includes(url.origin + url.pathname)) {
      // Locally fulfill the synthetic authorize edge before any socket opens.
      // The qualified loopback proxy independently blocks all external network.
      const authorization = url;
      if (authorization.origin === 'https://www.linkedin.com') approvedLinkedInScopes = authorization.searchParams.get('scope');
      if (authorization.origin === 'https://www.facebook.com') approvedMetaScopes = authorization.searchParams.get('scope').split(',').join(' ');
      assert.ok(['https://www.facebook.com/v26.0/dialog/oauth','https://accounts.google.com/o/oauth2/v2/auth','https://www.linkedin.com/oauth/v2/authorization'].includes(authorization.origin + authorization.pathname));
      const callback = new URL(authorization.searchParams.get('redirect_uri')); callback.searchParams.set('state', authorization.searchParams.get('state')); callback.searchParams.set('code', 'SYNTHETIC_CALLBACK_CODE');
      return route.fulfill({ contentType: 'text/html', body: `<html><head><title>SYNTHETIC PROVIDER</title></head><body><h1>SYNTHETIC provider consent boundary</h1><p>No live login or access. This is not provider qualification.</p><a href="${callback.href.replaceAll('&','&amp;')}">Complete synthetic consent</a></body></html>` });
    }
    if (url.origin === origin) return route.continue();
    await route.abort('blockedbyclient'); throw new Error('External browser network blocked: ' + url.origin + url.pathname);
  });
  let viewportWidth = 1440;
  const screenshot = async name => { await page.screenshot({ path: resolve(artifacts, name.replace(/^1440/, String(viewportWidth)) + '.png'), fullPage: true }); };
  const click = name => page.getByRole('button', { name, exact: true }).click();
  assert.equal((await page.request.post(origin + '/fixture/login')).status(), 200);
  for (const width of [1440, 390, 320]) {
  assert.equal((await page.request.post(origin + '/fixture/login')).status(), 200);
  viewportWidth = width; const initialRequestCount = requests.length; const project = width === 1440 ? 'consumer' : `consumer${width}`;
  await page.setViewportSize({ width, height: width === 1440 ? 1050 : 844 });
  if (width === 1440) { sdkReads.length = 0; await page.goto(origin + '/?workspace');
  await page.getByRole('heading', { name: 'Your marketing connections', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Connections', exact: true }).getAttribute('aria-current'), 'page');
  await screenshot('1440-workspace-zero-grant');
  await page.clock.install();
  const cold = [...sdkReads]; assert.deepEqual(cold, ['workspace','connections']);
  await page.clock.runFor(65000); assert.deepEqual(sdkReads, cold); // zero idle polls
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.clock.runFor(65000); assert.deepEqual(sdkReads, cold);
  const returning = page.waitForResponse(r => r.url().endsWith('/connections'));
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); });
  await returning;
  await page.clock.runFor(1000); assert.deepEqual(sdkReads, [...cold,'connections']);
  await page.evaluate(() => window.fixtureVisibility(false));
  await page.getByRole('heading', { name: 'Your marketing connections', exact: true }).waitFor({ state: 'detached' });
  const disposed = sdkReads.length; await page.clock.runFor(65000); assert.equal(sdkReads.length, disposed);
  await page.evaluate(() => window.fixtureVisibility(true));
  await page.getByRole('heading', { name: 'Your marketing connections', exact: true }).waitFor();
  assert.deepEqual(sdkReads.slice(disposed), ['workspace','connections']);
  // Narrow read-edge fixture for a genuinely asynchronous job; no job submission.
  await page.route('**/workspace', async route => {
    const response = await route.fetch(), value = await response.json();
    value.jobs = [{ id: 'SYNTHETIC_PENDING_JOB', projectId: 'consumer', campaignId: 'none', grantId: 'none', kind: 'image', prompt: 'fixture', promptDigest: 'fixture', parentAssetIds: [], rightsReceipt: 'fixture', state: 'processing', providerRequestId: null, assetId: null, reason: null, createdAt: new Date().toISOString() }];
    await route.fulfill({ response, json: value });
  });
  const opening = page.waitForResponse(r => r.url().endsWith('/workspace'));
  await click('Workspace'); await opening; await page.clock.runFor(100);
  const pendingStart = sdkReads.length;
  for (let i = 0; i < 12; i++) {
    const read = page.waitForResponse(r => r.url().endsWith('/workspace'));
    await page.clock.runFor(5000); await read; await page.clock.runFor(100);
  }
  assert.equal(sdkReads.length - pendingStart, 12);
  const bounded = sdkReads.length; await page.clock.runFor(30000); assert.equal(sdkReads.length, bounded);
  await page.unroute('**/workspace');
  Object.assign(lifecycleProof, { pendingReadCap: 12, afterCap30Seconds: 0, coldReads: cold, idle65Seconds: 0, hidden65Seconds: 0, returnReads: ['connections'], disposed65Seconds: 0, remountReads: ['workspace','connections'], visibility: 'public visible prop and simulated document visibility events; not full Preview cold start' });
  }
  await page.goto(origin + '/?project=' + project);
  await page.getByRole('button', { name: 'Connect Meta', exact: true }).waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Creative AI', exact: true }).count(), 1);
  assert.equal((await store.list(project, 'grant')).length, 0);
  await screenshot('1440-zero-grant');
  await click('Connect Meta');
  await page.getByLabel('Setup, reporting and later campaign operations', { exact: false }).check();
  // Lose the original start response after the real server has committed its receipt.
  await page.route('**/startConnection', async route => { await route.fetch(); await route.abort('failed'); await page.unroute('**/startConnection'); });
  await click('Continue with Meta'); await page.getByRole('button', { name: 'Retry original request' }).waitFor();
  await click('Retry original request'); await click('Review provider authorization');
  await page.getByText('Exact provider approval and OAuth scopes', { exact: true }).click(); await page.getByText('Exact OAuth scopes', { exact: true }).waitFor(); await screenshot('1440-provider-review-expanded'); await page.getByText('Exact provider approval and OAuth scopes', { exact: true }).click(); await screenshot('1440-provider-review');
  assert.equal(requests.length, initialRequestCount);
  await page.getByLabel('I reviewed this exact action, scope and duration.').check();
  await click('Approve provider access for discovery'); await click('Continue securely with provider');
  await page.getByRole('link', { name: 'Continue securely with Meta' }).click(); await click('Claim and continue with provider');
  await page.getByRole('link', { name: 'Complete synthetic consent' }).click();
  await page.getByText('Response recorded.', { exact: false }).waitFor(); await page.getByRole('link', { name: 'Return to Connections' }).click(); await page.waitForURL(origin + '/?correlator=*'); assert.ok(!page.url().includes('state=') && !page.url().includes('code='));
  await click('Refresh accounts');
  const radio = page.getByRole('radio', { name: /FIXTURE Studio retail/ });
  await radio.focus(); await page.keyboard.press('Space'); await page.keyboard.press('ArrowDown');
  assert.equal(await page.getByRole('radio', { name: /FIXTURE Trade catalog/ }).isChecked(), true);
  await page.keyboard.press('ArrowUp'); assert.equal(await radio.isChecked(), true);
  await screenshot('1440-account-selection'); await click('Use selected account'); await click('Find publishing identities'); await click('Load more identities');
  await page.getByRole('checkbox', { name: /FIXTURE Studio Page/ }).check(); await click('Use selected identity'); await click('Review project access');
  await screenshot('1440-project-review'); assert.equal((await store.list(project, 'grant')).length, 0);
  await page.getByLabel('I reviewed this exact action, scope and duration.').check(); await click("Approve this connection's access");
  failNextRead = true; await click('Verify account access'); await page.getByRole('heading', { name: 'Check interrupted', exact: true }).waitFor();
  await screenshot('1440-interrupted-verification');
  await page.reload();
  await page.route('**/resumeConnection', async route => { await route.fetch({ maxRedirects: 0 }); await route.abort('failed'); await page.unroute('**/resumeConnection'); });
  await click('Verify account access'); await page.getByRole('button', { name: 'Retry original request' }).waitFor(); await page.reload();
  await page.getByRole('heading', { name: 'Account access verified', exact: true }).waitFor(); await screenshot('1440-verified');
  assert.equal((await store.list(project, 'grant')).length, 1);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Overflow at ${width}`);
  assert.equal(await page.getByText(/Project: FIXTURE Fieldwork/).isVisible(), true);
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
  assert.ok(await page.evaluate(() => ['BUTTON','A','INPUT','SUMMARY'].includes(document.activeElement.tagName)));
  await click('Connect another account');
  await page.getByLabel('Setup, reporting and later campaign operations', { exact: false }).check();
  await click('Continue with Meta'); await click('Cancel setup');
  assert.equal(await page.getByRole('button', { name: 'Keep setup', exact: true }).evaluate(e => e === document.activeElement), true);
  await click('Confirm cancel setup'); await page.getByRole('heading', { name: 'Setup cancelled', exact: true }).waitFor();
  await screenshot('1440-cancelled'); await click('Back to Connections · save and close'); await click('View connection');
  await click('Review local access revocation'); await screenshot('1440-revocation-review'); await click('Decline');
  await click('Back to Connections · save and close'); await screenshot('1440-catalogue');
  await click('Connect OpenAI · Images'); await screenshot('1440-creative-requirements');
  await click('Back to Connections · save and close');
  for (const [provider, publishing] of [['Google Ads', false], ['LinkedIn', false], ['LinkedIn', true]]) {
    const organizationCallsBefore = requests.filter(p => /organization/.test(p)).length;
    await click('Connect ' + provider);
    if (provider === 'LinkedIn' && publishing) await page.getByLabel('Setup, reporting and later campaign operations', { exact: false }).check();
    await click('Continue with ' + provider); await click('Review provider authorization');
    if (provider === 'LinkedIn' && publishing) { await page.getByText('Exact provider approval and OAuth scopes', { exact: true }).click(); await page.getByText('r_organization_admin', { exact: true }).waitFor(); await screenshot('1440-linkedin-provider-review-expanded'); await page.getByText('Exact provider approval and OAuth scopes', { exact: true }).click(); await screenshot('1440-linkedin-provider-review'); }
    await page.getByLabel('I reviewed this exact action, scope and duration.').check(); await click('Approve provider access for discovery'); await click('Continue securely with provider');
    await page.getByRole('link', { name: 'Continue securely with ' + provider }).click(); await click('Claim and continue with provider');
    // Lost callback acknowledgement: the SDK persisted its receipt, but the
    // browser did not receive the clean return. Explicit navigation then recovers.
    await page.route('**/complete', async route => { if (route.request().method() !== 'POST') return route.continue(); const response = await route.fetch({ maxRedirects: 0 }); assert.equal(response.status(), 200); await route.abort('failed'); await page.unroute('**/complete'); });
    await page.getByRole('link', { name: 'Complete synthetic consent' }).click(); await page.getByText('Completion could not be confirmed.', { exact: false }).waitFor(); await page.goto(origin + '/');
    await click('Refresh accounts'); await page.getByRole('radio', { name: /FIXTURE (Google|LinkedIn) retail.*\b2041\b/ }).check();
    if (provider === 'LinkedIn') assert.equal(await page.getByRole('radio', { name: /FIXTURE LinkedIn retail.*\b12041\b/ }).count(), 1);
    await screenshot('1440-' + provider.split(' ')[0].toLowerCase() + (publishing ? '-publishing' : '-reporting') + '-selection'); await click('Use selected account');
    if (provider === 'Google Ads') { await click('Find publishing identities'); await page.getByRole('radio', { name: /Google Ads manager/ }).check(); await click('Use selected identity'); }
    if (provider === 'LinkedIn' && publishing) { await click('Find publishing identities'); await page.getByRole('radio', { name: /FIXTURE LinkedIn Page/ }).check(); await screenshot('1440-linkedin-page-selection'); await click('Use selected identity'); }
    await click('Review project access'); await page.getByLabel('I reviewed this exact action, scope and duration.').check(); await click("Approve this connection's access"); await click('Verify account access');
    await page.getByRole('heading', { name: 'Account access verified', exact: true }).waitFor();
    await screenshot('1440-' + provider.split(' ')[0].toLowerCase() + (publishing ? '-publishing' : '-reporting') + '-verified');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    if (provider === 'LinkedIn' && !publishing) assert.equal(requests.filter(p => /organization/.test(p)).length, organizationCallsBefore);
    await click('Back to Connections · save and close');
  }
  const linkedinCapability = custody.apps.linkedin.linkedinAdvertising; delete custody.apps.linkedin.linkedinAdvertising;
  const beforeBlocked = requests.length;
  const reporting = (await store.list(project, 'connection')).find(c => c.view.provider.provider === 'linkedin' && !c.view.intent.operations.includes('prepare') && c.view.grantId);
  // Verify through the authenticated public HTTP command; database records only identify the fixture's original intent.
  await page.reload();
  const stillReporting = await page.evaluate(async ({ project, id }) => (await (await fetch('/api/projects/' + project + '/connection', { method: 'POST', headers: { 'content-type': 'application/json', 'x-preview-request': '1' }, body: JSON.stringify({ connectionId: id }) })).json()), { project, id: reporting.id });
  assert.equal(stillReporting.configured.status, 'verified'); assert.equal(stillReporting.phase, 'verified');
  await click('Connect LinkedIn');
  await page.getByLabel('Setup, reporting and later campaign operations', { exact: false }).check();
  await click('Continue with LinkedIn'); await page.getByRole('heading', { name: 'Administrator setup needed', exact: true }).waitFor();
  await screenshot('1440-linkedin-app-configuration-missing'); assert.equal(requests.length, beforeBlocked);
  await click('Cancel setup'); await click('Confirm cancel setup');
  custody.apps.linkedin.linkedinAdvertising = linkedinCapability;
  await click('Back to Connections · save and close');
  const googleApp = custody.apps.google; delete custody.apps.google;
  await page.reload(); await click('View Google Ads setup requirements');
  await page.getByRole('heading', { name: 'Administrator action required' }).first().waitFor(); await screenshot('1440-unconfigured');
  custody.apps.google = googleApp; await click('Back to Connections · save and close');
  await page.locator('.connection-cards article').filter({ has: page.getByRole('heading', { name: 'Meta', exact: true }) }).getByRole('button', { name: 'View connection', exact: true }).click();
  await click('Review local access revocation'); await page.getByLabel('I reviewed this exact action, scope and duration.').check(); await click('Revoke this local access');
  await page.getByRole('heading', { name: 'Fresh access review needed', exact: true }).waitFor(); await screenshot('1440-revoked');
  await click('Back to Connections · save and close');
  // A genuinely expired synthetic provider token produces fresh-access copy,
  // not a green account badge or an automatic new OAuth grant.
  tokenSeconds = 1;
  await click('Connect Meta'); await click('Continue with Meta'); await click('Review provider authorization');
  await page.getByLabel('I reviewed this exact action, scope and duration.').check(); await click('Approve provider access for discovery'); await click('Continue securely with provider');
  await page.getByRole('link', { name: 'Continue securely with Meta' }).click(); await click('Claim and continue with provider'); await page.getByRole('link', { name: 'Complete synthetic consent' }).click();
  await page.getByText('Response recorded.', { exact: false }).waitFor(); await page.getByRole('link', { name: 'Return to Connections' }).click(); await page.waitForURL(origin + '/?correlator=*'); await new Promise(r => setTimeout(r, 1100)); await page.reload();
  await page.getByRole('heading', { name: 'Fresh access review needed', exact: true }).waitFor(); await screenshot('1440-expired-provider-access');
  tokenSeconds = 3600; await click('Back to Connections · save and close');
  assert.equal((await store.list(project, 'grant')).length, 4);
  // Complete manual creative setup through the SAME installed public composition.
  for (const provider of ['openai','xai']) {
    await page.goto(origin + '/?project=' + project);
    await click('Connect ' + (provider === 'openai' ? 'OpenAI · Images' : 'xAI · Video'));
    await page.getByRole('link', { name: 'Open private creative setup' }).click();
    const root = page.url();
    assert.equal((await page.request.post(root, { form: { requestKey: 'negative-no-header' } })).status(), 403);
    assert.equal((await page.request.post(root, { headers: { 'x-preview-request': '1', origin: 'https://wrong.example' }, form: { requestKey: 'negative-origin' } })).status(), 403);
    await click('Review exact local access');
    await page.getByRole('heading', { name: 'Private secure entry and approval' }).waitFor();
    const saved = page.url(), sourceSession = currentSession;
    await page.getByLabel('Existing provider API key').fill('SYNTHETIC_SHARED_KEY');
    await page.getByRole('checkbox', { name: /^I approve this exact/ }).check();
    await click('Approve and save credential configuration');
    await page.getByRole('heading', { name: 'Status: configured', exact: true }).waitFor();
    await screenshot('1440-' + provider + '-shared-configured');
    assert.equal((await store.list(project, 'generationGrant')).length, 0);
    assert.equal((await page.request.post(origin + '/fixture/login')).status(), 200);
    // The current session cannot adopt the old binding; approve explicit reuse.
    await page.goto(root);
    const source = await store.get(project, 'creativeConnection', saved.split('/').at(-1));
    await page.locator(`input[name=sourceId][value="${source.id}"]`).check();
    await page.locator(`input[name=expiresAt][value="${source.expiresAt}"]`).check();
    await click('Review exact local access');
    await page.getByRole('heading', { name: 'Private secure entry and approval' }).waitFor();
    assert.equal(await page.getByLabel('Existing provider API key').count(), 0);
    await page.getByRole('checkbox', { name: /^I approve this exact/ }).check();
    await click('Approve and save credential configuration');
    await page.getByRole('heading', { name: 'Status: configured', exact: true }).waitFor();
    await revoke(sourceSession); await page.reload();
    await page.getByRole('heading', { name: 'Status: unavailable', exact: true }).waitFor();
    await screenshot('1440-' + provider + '-source-logout');
    const reusePath = page.url();
    await revoke(currentSession); await page.reload();
    await page.getByRole('heading', { name: 'Secure setup needs attention' }).waitFor();
    await screenshot('1440-' + provider + '-current-logout');
    assert.equal((await page.request.post(origin + '/fixture/login')).status(), 200);
    for (const path of [reusePath, saved]) {
      await page.goto(path);
      await page.getByRole('checkbox', { name: 'Confirm disconnect for this exact binding and revision.' }).check();
      await click('Disconnect this binding');
      await page.getByRole('heading', { name: 'Status: revoked', exact: true }).waitFor();
    }
    assert.equal((await store.list(project,'grant')).length,4);
    assert.equal((await store.list(project,'generationCostReservation')).length,0);
    creativeProofs.push({width,provider,sourceLogout:true,currentLogout:true,ciphertextRetained:true});
  }
  const body = await page.locator('body').innerText(); assert.ok(!/SYNTHETIC_SECRET|SYNTHETIC_TOKEN|SYNTHETIC_CALLBACK_CODE|SYNTHETIC_PRIVATE|SYNTHETIC_GOOGLE_TOKEN|SYNTHETIC_LINKEDIN_TOKEN/.test(body));
  }
  assert.deepEqual(browserErrors, []); assert.deepEqual(diagnostics, []);
  assert.equal(Number((await store.db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).n),0);
  assert.ok((await store.db.prepare('SELECT password_hash FROM users').all()).every(r=>r.password_hash===''));
  assert.equal(guard.blocked.length, guardBaseline, 'Unexpected egress attempts during consumer journey');
  await writeFile(resolve(artifacts, 'browser-result.json'), JSON.stringify({ result: 'passed', evidence: 'SYNTHETIC HTTP FIXTURE; real SQLite and packed public exports', viewportWidths: [1440,390,320], creativeProofs, hostAuthentication: 'separate real host SQL request connection and process revocation writer', agent: 'absent', providerRequests: requests, browserErrors, lifecycleProof, grantCount: 12, noLiveProviderNetwork: true, noPaidGeneration: true, nativeQualification: false, lostAcknowledgements: ['start', 'callback', 'grant commit'], linkedinPublishing: 'source-qualified contract; synthetic associated-organization and member/role join only', liveProviderQualification: false }, null, 2));
  console.log('Packed public HTTP consumer browser journey passed: 1440/390/320, two approvals, identity, interrupted read, lost start response, four approved connection intents per project; LinkedIn publishing discovery, keyboard and no horizontal overflow.');
} catch (error) {
  await writeFile(resolve(artifacts,'failure.json'),JSON.stringify({error:String(error),diagnostics,browserErrors,creativeProofs,headings:await activePage?.locator('h1,h2').allTextContents().catch(()=>[]),blocked:guard.blocked},null,2));
  if(activePage) await activePage.screenshot({path:resolve(artifacts,'failure-masked.png'),mask:[activePage.locator('input[type=password]')]}).catch(()=>{});
  throw error;
} finally { await browser.close(); await guard.close(); await new Promise(r => server.close(r)); await authenticationStore.close(); await hostStore.close(); await store.close(); }
