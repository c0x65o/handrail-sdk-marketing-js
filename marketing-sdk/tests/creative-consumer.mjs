// Public-only packed consumer. Synthetic credentials, no Agent and no provider network.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright';
import { build } from 'vite';
import { loopbackGuard, qualifyGuard } from './connection-network-guard.mjs';
import { Store, HostAgent, createCredentialCipher } from '@handrail/marketing/server';
import { mountManualCreativeConnections } from './compiled/creative-server.js';
import { externalSessionFixture } from './compiled/external-session-fixture.js';
const artifacts = process.argv[2]; await mkdir(artifacts, { recursive: true });
const projects = ['p1440', 'p390', 'p320'];
const store = new Store('./creative-consumer.sqlite');
for (const project of projects) await store.db.prepare('INSERT INTO projects VALUES(?,?)').run(project, 'SYNTHETIC Fieldwork ' + project);
const hostStore = new Store('./creative-host.sqlite'), authenticationStore = new Store('./creative-host.sqlite');
const host = await externalSessionFixture(store, hostStore, authenticationStore);
for (const project of projects) await hostStore.db.prepare('INSERT INTO fixture_host_memberships VALUES(?,?,?)').run('alice', project, 'admin');
let origin, mount; const diagnostics = [], results = [];
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    if (url.pathname === '/fixture/login' && req.method === 'POST') {
      const { token } = await host.login();
      res.writeHead(200, { 'set-cookie': `host_session=${token}; HttpOnly; SameSite=Strict; Path=/` }); return res.end('{}');
    }
    if (req.method === 'POST' && req.headers['x-preview-request'] !== '1') { res.writeHead(403); return res.end('{}'); }
    const chunks = []; let bytes = 0;
    for await (const chunk of req) { bytes += chunk.length; assert.ok(bytes < 262144); chunks.push(chunk); }
    const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
    const response = await mount.handle(new Request(url, { method: req.method, headers, ...(req.method === 'POST' ? { body: Buffer.concat(chunks) } : {}) }));
    if (response) { if (response.status >= 500) diagnostics.push({ path: url.pathname, status: response.status }); res.writeHead(response.status, Object.fromEntries(response.headers)); return res.end(Buffer.from(await response.arrayBuffer())); }
    const path = resolve('web-dist', url.pathname === '/' ? 'index.html' : '.' + url.pathname); assert.ok(path.startsWith(resolve('web-dist') + '/'));
    res.writeHead(200, { 'content-type': extname(path) === '.js' ? 'text/javascript' : extname(path) === '.css' ? 'text/css' : 'text/html', 'cache-control': 'no-store' }); res.end(await readFile(path));
  } catch { diagnostics.push({ failure: 'fixture_http_bridge' }); res.writeHead(500); res.end('fixture_host_failed'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r)); origin = `http://127.0.0.1:${server.address().port}`;
const key = randomBytes(32), cipher = createCredentialCipher('synthetic-only', () => key);
const unavailable = () => { throw new Error('provider calls and paid generation forbidden'); };
const custody = new HostAgent(store, origin, {}, cipher, unavailable);
mount = mountManualCreativeConnections({ store, custody, creativeEnvironment: 'isolated-qualification', evidence: 'fixture', accessPolicy: async () => null,
  creativePolicy: async (_p, _project, provider) => ({ revision: 'synthetic-1', environment: 'isolated-qualification', appLabel: 'SYNTHETIC SDK secure setup', models: [provider === 'openai' ? 'gpt-image-1.5' : 'grok-imagine-video-1.5'], maxDurationSeconds: 3600, grantIds: [] }),
  billing: { authorize: unavailable },
  sessionAuthority: host.authority, authenticate: host.authenticate, mutationHeaders: () => ({ 'x-preview-request': '1' }) });
await writeFile('index.html', '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>SYNTHETIC creative Connections</title></head><body style="margin:0"><div id="app"></div><script type="module" src="/creative-app.tsx"></script></body></html>');
await writeFile('creative-app.tsx', `import React from 'react'; import { createRoot } from 'react-dom/client'; import { createMarketingClient } from '@handrail/marketing'; import { MarketingConnections } from '@handrail/marketing/react'; import '@handrail/marketing/react/style.css'; const project = new URLSearchParams(location.search).get('project') || sessionStorage.getItem('fixture-project') || 'p1440'; sessionStorage.setItem('fixture-project', project); createRoot(document.getElementById('app')!).render(<MarketingConnections client={createMarketingClient(location.origin, project, (input, init) => fetch(input, { ...init, headers: { ...init?.headers, 'x-preview-request': '1' } }))} sessionKey="synthetic-human" />);`);
await build({ logLevel: 'error', build: { outDir: 'web-dist' } });
const guard = await loopbackGuard(origin);
let activePage; const httpFailures = [];
const browser = await chromium.launch({ headless: true, executablePath: process.env.MARKETING_CHROMIUM_PATH || undefined, proxy: { server: guard.server }, args: ['--no-sandbox', '--proxy-bypass-list=<-loopback>', '--disable-quic', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, serviceWorkers: 'block' });
  const isolation = await qualifyGuard(context, origin, guard);
  await writeFile(resolve(artifacts, 'network-negative-control.json'), JSON.stringify(isolation, null, 2));
  const baseline = guard.blocked.length; const nonLoopbackPageRequests = [];
  context.on('request', request => { if (new URL(request.url()).origin !== origin) nonLoopbackPageRequests.push(new URL(request.url()).origin); });
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'));
  const page = await context.newPage(); activePage = page; page.on('response', r => { if (r.status() >= 400) httpFailures.push({ path: new URL(r.url()).pathname, status: r.status() }); }); page.on('pageerror', e => diagnostics.push({ pageError: e.message }));
  assert.equal((await page.request.post(origin + '/fixture/login')).status(), 200);
  assert.equal((await page.request.post(origin + '/api/projects/p1440/creative/openai', { form: { requestKey: 'no-header-negative' } })).status(), 403);
  const overflow = async () => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1050 : 844 });
    const project = 'p' + width;
    await page.goto(origin + '/?project=' + project);
    await page.getByRole('button', { name: 'Connect OpenAI · Images', exact: true }).waitFor();
    await overflow(); await page.screenshot({ path: resolve(artifacts, `${width}-catalogue.png`), fullPage: true });
    for (const provider of ['openai', 'xai']) {
      if (provider === 'xai') await page.goto(origin + '/?project=' + project);
      const label = provider === 'openai' ? 'OpenAI · Images' : 'xAI · Video';
      await page.getByRole('button', { name: 'Connect ' + label, exact: true }).click();
      await page.waitForFunction(() => document.activeElement?.tagName === 'H1');
      const link = page.getByRole('link', { name: 'Open private creative setup' }); await link.focus(); await page.keyboard.press('Enter');
      await page.waitForURL(origin + `/api/projects/${project}/creative/${provider}`);
      await page.getByRole('heading', { name: 'Requirements', exact: true }).waitFor();
      await overflow(); await page.screenshot({ path: resolve(artifacts, `${width}-${provider}-requirements.png`), fullPage: true });
      assert.equal((await store.list(project, 'generationGrant')).length, 0);
      await page.getByRole('button', { name: 'Review exact local access' }).click();
      await page.getByRole('heading', { name: 'Private secure entry and approval' }).waitFor();
      const saved = page.url();
      await page.getByRole('link', { name: 'Back to Connections · save and close' }).click();
      await page.getByRole('button', { name: 'Connect ' + label, exact: true }).click();
      await page.getByRole('link', { name: 'Manage creative binding' }).last().click();
      assert.equal(page.url(), saved);
      await page.waitForFunction(() => document.activeElement?.tagName === 'H1');
      const input = page.getByLabel('Existing provider API key');
      if (width === 320 && provider === 'openai') {
        await input.fill('SYNTHETIC INVALID KEY');
        await page.getByRole('checkbox', { name: /^I approve this exact/ }).check();
        await page.getByRole('button', { name: 'Approve and save credential configuration' }).click();
        await page.getByRole('heading', { name: 'Secure setup needs attention' }).waitFor();
        await page.waitForFunction(() => document.activeElement?.tagName === 'H1');
        assert.ok(!(await page.content()).includes('creative_key_invalid'));
        await page.waitForURL(saved + '?notice=key-format');
        let replayedPosts = 0;
        const observePost = request => { if (request.method() === 'POST') replayedPosts++; };
        page.on('request', observePost); await page.reload(); page.off('request', observePost);
        assert.equal(replayedPosts, 0, 'Reloading validation failure must not replay the key POST');
        await overflow(); await page.screenshot({ path: resolve(artifacts, '320-validation-recovery.png'), fullPage: true });
        await page.goto(saved);
      }
      await input.fill('SYNTHETIC_BROWSER_KEY_NOT_REAL');
      await input.evaluate(element => element.scrollIntoView({ block: "center" }));
      await overflow(); await page.screenshot({ path: resolve(artifacts, `${width}-${provider}-entry-masked.png`), fullPage: false, mask: [input] });
      await page.goto(origin + '/?project=' + project);
      await page.goBack(); await input.waitFor(); assert.equal(await input.inputValue(), '', 'Browser Back must clear private entry');
      await input.fill('SYNTHETIC_BROWSER_KEY_NOT_REAL');
      await page.reload(); assert.equal(await input.inputValue(), '');
      await input.fill('SYNTHETIC_BROWSER_KEY_NOT_REAL');
      await page.getByRole('checkbox', { name: /^I approve this exact/ }).check();
      {
        await page.route(saved, async route => {
          if (route.request().method() !== 'POST') return route.continue();
          const receipt = await route.fetch({ maxRedirects: 0 }); assert.equal(receipt.status(), 200);
          await route.abort('failed'); await page.unroute(saved);
        });
        await page.getByRole('button', { name: 'Approve and save credential configuration' }).click();
        await page.getByText('Saving could not be confirmed.', { exact: false }).waitFor();
        assert.equal(await input.inputValue(), '');
        await page.goto(saved); // Recover committed original intent, never resubmit a key.
      }
      await page.getByRole('heading', { name: 'Status: configured', exact: true }).waitFor();
      assert.equal(await page.locator('script').count(), 1);
      assert.ok(!(await page.content()).includes('SYNTHETIC_BROWSER_KEY_NOT_REAL'));
      assert.ok(await page.evaluate(() => !JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]).includes('SYNTHETIC_BROWSER_KEY_NOT_REAL')));
      const before = JSON.stringify(await store.list(project, 'creativeConnection'));
      await page.getByRole('link', { name: 'Refresh harmless status' }).click();
      assert.equal(JSON.stringify(await store.list(project, 'creativeConnection')), before);
      for (const kind of ['generationGrant', 'generationJob', 'generationCostReservation', 'grant']) assert.equal((await store.list(project, kind)).length, 0);
      await overflow(); await page.screenshot({ path: resolve(artifacts, `${width}-${provider}-configured.png`), fullPage: true });
      // CSS zoom is a local reflow check, not native-device accessibility proof.
      await page.evaluate(() => { document.body.style.zoom = '2'; });
      await overflow(); await page.screenshot({ path: resolve(artifacts, `${width}-${provider}-zoom200.png`), fullPage: false });
      await page.evaluate(() => { document.body.style.zoom = ''; });
      // Choose the original authorized credential through the SDK form, with no new key or grant.
      await page.getByRole('link', { name: 'Reconnect or choose another binding' }).click();
      const originalId = saved.split('/').at(-1);
      const sourceOption = page.locator(`input[name=sourceId][value="${originalId}"]`);
      const sourceExpiry = (await sourceOption.locator("..").textContent()).split('expires ').at(-1);
      await sourceOption.check();
      await page.locator(`input[name=expiresAt][value="${sourceExpiry}"]`).check();
      await page.getByRole('button', { name: 'Review exact local access' }).click();
      await page.getByRole('heading', { name: 'Private secure entry and approval' }).waitFor();
      const reused = page.url();
      assert.equal(await page.getByLabel('Existing provider API key').count(), 0);
      await page.getByRole('checkbox', { name: /^I approve this exact/ }).check();
      await page.getByRole('button', { name: 'Approve and save credential configuration' }).click();
      await page.getByRole('heading', { name: 'Status: configured', exact: true }).waitFor();
      await page.screenshot({ path: resolve(artifacts, `${width}-${provider}-reused.png`), fullPage: true });
      await page.goto(saved);
      await page.getByRole('checkbox', { name: 'Confirm disconnect for this exact binding and revision.' }).check();
      await page.getByRole('button', { name: 'Disconnect this binding' }).focus(); await page.keyboard.press('Enter');
      await page.getByRole('heading', { name: 'Status: revoked', exact: true }).waitFor();
      await page.screenshot({ path: resolve(artifacts, `${width}-${provider}-revoked.png`), fullPage: true });
      await page.goto(reused);
      await page.getByRole('heading', { name: 'Status: unavailable', exact: true }).waitFor();
      await page.getByRole('checkbox', { name: 'Confirm disconnect for this exact binding and revision.' }).check();
      await page.getByRole('button', { name: 'Disconnect this binding' }).click();
      await page.getByRole('link', { name: 'Reconnect or choose another binding' }).click();
      await page.getByRole('button', { name: 'Review exact local access' }).click();
      await page.getByRole('checkbox', { name: 'Confirm cancel for this exact binding and revision.' }).check();
      await page.getByRole('button', { name: 'Cancel saved setup' }).click();
      await page.getByRole('heading', { name: 'Status: revoked', exact: true }).waitFor();
      // Expired review recovery uses the same durable fixture record, never a provider call.
      await page.getByRole('link', { name: 'Reconnect or choose another binding' }).click();
      await page.getByRole('button', { name: 'Review exact local access' }).click();
      await page.getByRole('heading', { name: 'Private secure entry and approval' }).waitFor();
      const expiredId = page.url().split('/').at(-1), review = await store.get(project, 'creativeConnection', expiredId);
      await store.put(project, 'creativeConnection', expiredId, { ...review, reviewExpiresAt: new Date(0).toISOString() });
      await page.reload();
      assert.equal(await page.getByLabel('Existing provider API key').count(), 0);
      await page.getByRole('heading', { name: 'Status: expired', exact: true }).waitFor();
      await page.getByText('This review, authority or credential save changed. Any retained credential remains fenced. Cancel this intent and start a fresh review.').waitFor();
      await overflow(); await page.screenshot({ path: resolve(artifacts, `${width}-${provider}-expired-review.png`), fullPage: true });
      await page.getByRole('checkbox', { name: 'Confirm cancel for this exact binding and revision.' }).check();
      await page.getByRole('button', { name: 'Cancel saved setup' }).click();
      await page.getByRole('heading', { name: 'Status: revoked', exact: true }).waitFor();
      // Concurrent private scripts: hold the first custody acknowledgement after
      // retaining bytes, then submit the preloaded second review. No replay/overwrite.
      await page.getByRole('link', { name: 'Reconnect or choose another binding' }).click();
      await page.getByRole('button', { name: 'Review exact local access' }).click();
      await page.getByRole('heading', { name: 'Private secure entry and approval' }).waitFor();
      const concurrentPath = page.url(), second = await context.newPage();
      await second.setViewportSize({ width, height: width === 1440 ? 1050 : 844 });
      await second.goto(concurrentPath);
      const retain = mount.creative.options.custody.retain.bind(mount.creative.options.custody);
      let signal, release; const entered = new Promise(r => signal = r), gate = new Promise(r => release = r);
      mount.creative.options.custody.retain = async (...args) => { await retain(...args); signal(); await gate; };
      try {
        for (const tab of [page, second]) {
          await tab.getByLabel('Existing provider API key').fill('SYNTHETIC_CONCURRENT_KEY');
          await tab.getByRole('checkbox', { name: /^I approve this exact/ }).check();
        }
        await page.getByRole('button', { name: 'Approve and save credential configuration' }).click(); await entered;
        await second.getByRole('button', { name: 'Approve and save credential configuration' }).click();
        await second.getByRole('heading', { name: 'Secure setup needs attention' }).waitFor();
        await second.getByRole('link', { name: 'Return to saved setup' }).click();
        await second.getByRole('heading', { name: 'Status: unavailable', exact: true }).waitFor();
        assert.equal(await second.getByLabel('Existing provider API key').count(),0);
        await second.screenshot({ path: resolve(artifacts, `${width}-${provider}-pending-custody.png`), fullPage: true });
        // Cancellation fences the pending first submission; retained ciphertext
        // remains uncertain and may not be promoted by its delayed completion.
        await second.getByRole('checkbox', { name: 'Confirm cancel for this exact binding and revision.' }).check();
        await second.getByRole('button', { name: 'Cancel saved setup' }).click();
        await second.getByRole('heading', { name: 'Status: revoked', exact: true }).waitFor();
        release();
        await page.getByRole('heading', { name: 'Secure setup needs attention' }).waitFor();
        await page.goto(concurrentPath);
        await page.getByRole('heading', { name: 'Status: revoked', exact: true }).waitFor();
        assert.equal((await mount.creative.inspect(await host.principal((await context.cookies()).find(c=>c.name==='host_session').value,project), project, concurrentPath.split('/').at(-1))).credentialStored,true);
      } finally { release?.(); mount.creative.options.custody.retain=retain; await second.close(); }
      results.push({ width, provider, concurrentApprovalAndPendingCancellation: true, cssZoom200: true, expiredReviewRecovery: true, secureHeadingFocus: true, validationRecovery: width === 320 && provider === 'openai', zeroGrants: true, privateEntry: true, masked: true, reload: true, browserBack: true, keyboard: true, localDisconnect: true, existingBindingReuse: true, sourceRevocation: true, cancelReconnect: true, statusNoWrites: true, lostAck: true });
    }
  }
  await writeFile(resolve(artifacts, 'blocked-attempts.json'), JSON.stringify(guard.blocked.slice(baseline), null, 2));
  assert.deepEqual(nonLoopbackPageRequests, [], 'No page navigation or subresource may request an external origin');
  // Chromium also issues browser-process CONNECT attempts (outside page routing).
  // The unchanged guard denies these before any upstream socket or DNS lookup.
  // Retain every attempt and fail on a new unexplained target.
  assert.ok(guard.blocked.slice(baseline).every(x => /^CONNECT (www\.google\.com|accounts\.google\.com|content-autofill\.googleapis\.com):443$/.test(x)), 'Unexplained proxy target');
  assert.deepEqual(diagnostics, []);
  for (const db of [store, hostStore]) assert.equal(Number((await db.db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).n), 0);
  assert.ok((await store.db.prepare('SELECT password_hash FROM users').all()).every(row => row.password_hash === ""));
  await writeFile(resolve(artifacts, 'verification.json'), JSON.stringify({ results, diagnostics, guard: 'qualified before all browser work; all denied CONNECTs retained with no upstream transport', nonLoopbackPageRequests, blockedBrowserConnects: guard.blocked.length - baseline, agent: 'absent', externalSessions: 'independent host SQL, separate authentication connection, no SDK sessions/passwords', mutationHeader: 'required x-preview-request for every mutation; missing-header negative passed', providerCalls: 0, paidCalls: 0, reservations: 0, historicalIsolation: 'Two predecessor Facebook navigation failures remain failed and preserved.' }, null, 2));
  console.log('Creative public consumer passed:', results.length, 'provider/viewport journeys');
} catch (e) {
  if (activePage) await activePage.screenshot({ path: resolve(artifacts, 'failure-masked.png'), fullPage: false, mask: [activePage.locator('input[type=password]')] }).catch(() => {});
  await writeFile(resolve(artifacts, 'failure.json'), JSON.stringify({ error: String(e), diagnostics, httpFailures, headings: await activePage?.locator('h1,h2').allTextContents().catch(()=>[]), completed: results }, null, 2)); throw e;
} finally { await browser.close(); await guard.close(); await authenticationStore.close(); await hostStore.close(); await store.close(); await new Promise(r => { server.close(r); server.closeAllConnections(); }); }
