/* global document, getComputedStyle, window */
// Real React + disposable SDK SQLite host. No target-platform or provider qualification.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'vite';
import { chromium } from 'playwright';
import { runtime, createHost } from '../../.marketing-build/reference/host.js';
import { seedQa } from '../../.marketing-build/reference/seed.js';
import { testStore } from '../../.marketing-build/tests/datastore.js';

const evidence = resolve(process.env.MARKETING_EVIDENCE_DIR || 'artifacts/embedding-browser');
await mkdir(evidence, { recursive: true });
const dir = await mkdtemp(join(tmpdir(), 'marketing-embedding-'));
const harness = join(evidence, 'harness');
await mkdir(harness, { recursive: true });
const report = { sourceDigest: JSON.parse(await readFile('.marketing-build/source-manifest.json', 'utf8')).digest,
  environment: 'local-disposable-sqlite-fixture; synthetic host, real SDK React/HTTP', cases: [], screenshots: [], errors: [] };
const css = await readFile(new URL(import.meta.resolve('@handrail/marketing/react/style.css')), 'utf8');
const negativeCss = process.env.MARKETING_NEGATIVE_CSS ? await readFile(process.env.MARKETING_NEGATIVE_CSS, 'utf8') : null;
if (negativeCss) assert.equal(createHash('sha256').update(negativeCss).digest('hex'), '8c413536085289a3c6644293e8545ec7ec155b049884fbd5618562bcc12d79e8', 'frozen published 0.1.6 CSS');
const genericClasses = [...new Set([...css.matchAll(/\.marketing-root\s+\.([a-z][a-z-]*)/g)].map(m => m[1]))];
const password = randomBytes(32).toString('base64url');
let browser, app, store;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
try {
  // Host rules deliberately have no ID specificity shield against leaking SDK selectors.
  const hostHtml = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
:root { font: 18px/1.4 Georgia, serif; color: #234; background: #dae8e4; --host-proof: retained; }
body { margin: 13px; } * { box-sizing: content-box; }
h1,h2,h3 { font: bold 19px/1.3 Georgia,serif; margin: 3px; letter-spacing: 1px; }
nav,main,aside,header { display: block; margin: 2px; padding: 3px; width: auto; min-height: 0; border: 0; }
a { color: #704020; } button,input,textarea,select { font: 14px/1.3 Georgia,serif; color: #163728; background: #f0ead0; padding: 3px; border: 2px solid #486050; border-radius: 2px; width: auto; }
input { width: 110px; } label { display: inline; margin: 0; font: inherit; }
button:hover,a:hover { filter: none; color: #705020; } button:disabled { opacity: .7; }
button:focus-visible,input:focus-visible,a:focus-visible,select:focus-visible,textarea:focus-visible,summary:focus-visible { outline: 2px dashed #704020; outline-offset: 1px; }
.card,.grid,.actions,.badge,.error,.selected,.muted,.secondary,.hero,.loading,.login,.brand,.choice-chip { padding: 2px; margin: 1px; color: #345; background: #dce9dc; display: inline-block; font-size: 14px; border-radius: 1px; }
.host-probes::before { content: 'Host pseudo'; display: block; padding: 2px; }
#instances { display: flex; gap: 10px; flex-wrap: wrap; } .embedding-slot { width: 390px; max-width: 100%; min-width: 0; }
@media(max-width:650px) { body { margin: 0; } }
</style></head><body><section class="host-probes">
<h1>Host heading one</h1><h2>Host heading two</h2><h3>Host heading three</h3><h4>Host heading four</h4><h5>Host heading five</h5><h6>Host heading six</h6><header>Host header</header>
<nav>Host navigation <button>Host nav action</button></nav><main>Host main <aside>Host aside</aside></main>
<a href="#host-end">Host link</a><button id="host-button">Host action</button><button disabled>Disabled host</button>
<label>Host input<input id="host-input"></label><textarea aria-label="Host textarea">Host copy</textarea><select aria-label="Host select"><option>Host option</option></select><details><summary>Host summary</summary>Host details</details>
${genericClasses.map(c=>`<div class="${c}">Host ${c}</div>`).join('')}
<fieldset><legend>Host legend</legend>Host fieldset</fieldset><figure>Host figure<figcaption>Host caption</figcaption></figure><blockquote>Host quote</blockquote><pre>Host pre</pre><code>Host code</code><dl><dt>Host term</dt><dd>Host definition</dd></dl></section><div id="instances"><div class="embedding-slot" id="first"></div><div class="embedding-slot" id="second"></div></div><p id="host-end">Host footer</p><script type="module" src="./main.jsx"></script></body></html>`;
  await writeFile(join(harness, 'host.css'), hostHtml.match(/<style>([\s\S]*?)<\/style>/)[1]);
  await writeFile(join(harness, 'index.html'), hostHtml.replace(/<style>[\s\S]*?<\/style>/, '<link rel="stylesheet" href="./host.css">'));
  await writeFile(join(harness, 'main.jsx'), `import React from 'react';
import { createRoot } from 'react-dom/client';
import { MarketingRoot, MarketingWorkspace } from '@handrail/marketing/react';
import { createMarketingClient } from '@handrail/marketing';
const client = createMarketingClient('', 'qa-alpha');
function Instance() {
 const [workspace, setWorkspace] = React.useState(false), [name, setName] = React.useState('');
 return workspace ? <MarketingWorkspace client={client}/> : <MarketingRoot><main className="login"><h1>Marketing sign in</h1><form onSubmit={e=>{e.preventDefault();setWorkspace(true)}}><label>Username<input value={name} onChange={e=>setName(e.target.value)}/></label><label>Password<input type="password"/></label><p className="error" role="alert">Fixture host session controls</p><button>Open Marketing</button></form></main></MarketingRoot>;
}
createRoot(document.getElementById('first')).render(<Instance/>);
createRoot(document.getElementById('second')).render(<Instance/>);`);
  await build({ configFile: false, root: harness, logLevel: 'warn', build: { outDir: 'dist', emptyOutDir: true } });
  await writeFile(join(harness, 'dist/sdk.css'), css);
  if (negativeCss) await writeFile(join(harness, 'dist/negative.css'), negativeCss);
  await writeFile(join(harness, 'dist/host.css'), hostHtml.match(/<style>([\s\S]*?)<\/style>/)[1]);
  // Empty slots isolate CSS mutation from legitimate component-size changes.
  await writeFile(join(harness, 'dist/host-only.html'), hostHtml.replace(/<style>[\s\S]*?<\/style>/, '<link rel="stylesheet" href="./host.css">').replace(/<script[\s\S]*?<\/script>/, ''));
  const rt = await runtime({ MARKETING_MODE: 'fixture', MARKETING_PUBLIC_URL: 'http://127.0.0.1' }, await testStore(join(dir, 'fixture.sqlite')));
  store = rt.store;
  await seedQa(store, { username: 'qa-embedding', password });
  const hostOptions = { store, service: rt.service, origin: 'http://127.0.0.1', staticDir: join(harness, 'dist'), version: 'local-embedding-source' };
  app = await createHost(hostOptions);
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  await new Promise(r => app.server.close(r));
  app = await createHost({ ...hostOptions, origin: base });
  await new Promise(r => app.server.listen(Number(new URL(base).port), '127.0.0.1', r));
  browser = await chromium.launch({ headless: true, executablePath: process.env.MARKETING_CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  for (const [viewport, width] of [[1440,1080],[1440,390],[1440,320],[390,390],[320,320]]) {
    const context = await browser.newContext({ viewport: { width: viewport, height: 1100 } });
    const page = await context.newPage();
    page.on('pageerror', e => report.errors.push(e.message));
    page.on('response', r => { if (r.status() >= 500) report.errors.push(`HTTP ${r.status()} ${r.url()}`); });
    // The only allowed network is this test's loopback fixture host.
    await page.route('**/*', route => route.request().url().startsWith(base + '/') ? route.continue() : route.abort());
    const response = await context.request.post(`${base}/api/login`, { data: { username: 'qa-embedding', password } });
    assert.equal(response.status(), 200);
    await page.addInitScript(() => {
      window.cspViolations = [];
      document.addEventListener('securitypolicyviolation', e => window.cspViolations.push(e.violatedDirective));
    });
    const navigation = await page.goto(base);
    const csp = navigation.headers()['content-security-policy'];
    assert.ok(csp.includes("style-src 'self'") && csp.includes("script-src 'self'") && !csp.includes('unsafe-'), 'original restrictive CSP');
    await page.locator('#first .login').waitFor();
    await page.locator('#second .login').waitFor();
    await page.locator('.embedding-slot').evaluateAll((els, w) => els.forEach(el => el.style.width = w + 'px'), width);
    const hostSnapshot = () => page.evaluate(() => {
      window.scrollTo(0, 0); // Compare layout at the same scroll positions.
      document.querySelector('.host-probes').scrollTop = 0;
      const els = [document.documentElement, document.body, ...document.querySelectorAll('.host-probes, .host-probes *, #host-end')];
      const elements = els.map(el => {
        const c = getComputedStyle(el), r = el.getBoundingClientRect();
        const style = Object.fromEntries([...c].map(k => [k,c.getPropertyValue(k)]));
        const pseudo = ['::before','::after'].map(p => { const s=getComputedStyle(el,p);return Object.fromEntries([...s].map(k=>[k,s.getPropertyValue(k)])); });
        return { element: el.tagName + '.' + el.className, style, pseudo, rect: { x:r.x,y:r.y,width:r.width,height:r.height } };
      });
      return { elements, flowHeight: document.querySelector('#instances').getBoundingClientRect().height };
    });
    const differences = (a, b, path = '') => {
      if (a && b && typeof a === 'object' && typeof b === 'object')
        return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap(k => differences(a[k], b[k], path + '/' + k));
      // CSSOM serializes pixel values with fewer decimals than DOMRect.
      if (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < (/^\/elements\/[01]\/style\//.test(path) ? 0.1 : 0.02)) return [];
      return a === b ? [] : [{ path, before: a, after: b }];
    };
    const normalizeFlow = snapshot => {
      const copy = structuredClone(snapshot);
      // Account only for measured Marketing flow height. All other properties,
      // host dimensions, and relative positions must remain exactly unchanged.
      for (const el of copy.elements.slice(0, 2)) {
        for (const k of ['height', 'block-size']) el.style[k] = parseFloat(el.style[k]) - copy.flowHeight;
        for (const k of ['perspective-origin', 'transform-origin']) {
          const parts = el.style[k].split(' ');
          parts[1] = parseFloat(parts[1]) - copy.flowHeight / 2;
          el.style[k] = parts;
        }
        el.rect.height -= copy.flowHeight;
      }
      copy.elements.at(-1).rect.y -= copy.flowHeight;
      delete copy.flowHeight;
      return copy;
    };
    const assertHost = (actual, expected, message, flow = true) => {
      const diff = differences(flow ? normalizeFlow(expected) : expected, flow ? normalizeFlow(actual) : actual);
      assert.deepEqual(diff, [], message);
    };
    // Same probes, computed properties, and assertion for positive/negative CSS,
    // without mounted components. Both source orders must detect the old leak.
    const controls = [];
    report.controlRuns ||= [];
    report.controlRuns.push({viewport, width, controls});
    for (const order of ['after-host', 'before-host']) {
      await page.goto(base + '/host-only.html');
      await page.locator('#host-input').focus();
      const baseline = await hostSnapshot();
      for (const [name, url] of [['corrected', '/sdk.css'], ...(negativeCss ? [['published-0.1.6', '/negative.css']] : [])]) {
        const sheet = await page.addStyleTag({ url: base + url });
        if (order === 'before-host') await sheet.evaluate(el => document.head.prepend(el));
        await page.waitForFunction(el => el.sheet?.cssRules.length > 0, sheet);
        const actual = await hostSnapshot();
        const diff = differences(baseline, actual);
        if (name === 'corrected') assertHost(actual, baseline, 'uncaged host-only CSS isolation: ' + order, false);
        else {
          assert.throws(() => assertHost(actual, baseline, 'negative control', false), { code: 'ERR_ASSERTION' }, name + ' ' + order);
          assert.ok(diff.some(x => /style\/(font|background|padding|box-sizing|display|margin)/.test(x.path)), 'detect actual style mutation, not just reflow');
        }
        controls.push({ name, order, differences: diff });
        await sheet.evaluate(el => el.remove());
        assertHost(await hostSnapshot(), baseline, 'control cleanup', false);
      }
    }
    await page.goto(base);
    await page.locator('#second .login').waitFor();
    await page.locator('.embedding-slot').evaluateAll((els, w) => els.forEach(el => el.style.width = w + 'px'), width);
    await page.mouse.move(viewport - 1, 1099);
    await page.locator('#host-input').focus();
    const before = await hostSnapshot();
    const tag = await page.addStyleTag({ url: base + '/sdk.css' });
    assertHost(await hostSnapshot(), before, 'all host computed properties, pseudo styles and flow-relative rectangles survive CSS load');
    const styledFlowHeight = (await hostSnapshot()).flowHeight;
    // Audit CSSOM including conditional rules: no unscoped selector or global at-rule.
    const audit = await tag.evaluate(el => {
      const selectors = [], invalid = [];
      const walk = rules => [...rules].forEach(rule => {
        if (rule.selectorText) { selectors.push(rule.selectorText); if (!rule.selectorText.split(',').every(s=>s.trim().startsWith('.marketing-root'))) invalid.push(rule.cssText); }
        else if (rule.cssRules && (rule.constructor.name === 'CSSContainerRule' || rule.constructor.name === 'CSSMediaRule')) walk(rule.cssRules);
        else invalid.push(rule.cssText);
      }); walk(el.sheet.cssRules); return { selectors: selectors.length, invalid };
    });
    assert.deepEqual(audit.invalid, []);
    for (const selector of ['#host-button','#host-input','.host-probes a','.host-probes select','.host-probes textarea','.host-probes summary']) {
      await page.locator(selector).focus();
      const styled = await hostSnapshot();
      await tag.evaluate(el=>el.sheet.disabled=true);
      assertHost(await hostSnapshot(), styled, `${selector} focused styles and layout`);
      await tag.evaluate(el=>el.sheet.disabled=false);
    }
    for (const selector of ['#host-button', '.host-probes a']) {
      await page.locator(selector).hover();
      const hovered = await hostSnapshot();
      await tag.evaluate(el=>el.sheet.disabled=true);
      assertHost(await hostSnapshot(), hovered, 'host hover styles: ' + selector);
      await tag.evaluate(el=>el.sheet.disabled=false);
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const reduced = await hostSnapshot();
    await tag.evaluate(el=>el.sheet.disabled=true);
    assertHost(await hostSnapshot(), reduced, 'host reduced-motion styles');
    await tag.evaluate(el=>el.sheet.disabled=false);
    const first = page.locator('#first'), second = page.locator('#second');
    const shot = async name => {
      const overflow = await page.locator('.embedding-slot').evaluateAll(els => els.map(el=>({ client:el.clientWidth,scroll:el.scrollWidth })));
      assert.ok(overflow.every(x=>x.scroll<=x.client+1), JSON.stringify(overflow));
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth), 'no document overflow');
      const file = `${viewport}-${width}-${name}.png`;
      await first.screenshot({ path:join(evidence,file) });
      report.screenshots.push({file,sha256:sha(await readFile(join(evidence,file)))});
    };
    await first.getByLabel('Username').fill('first-only');
    assert.equal(await second.getByLabel('Username').inputValue(), '');
    assert.equal(await first.locator('h1').evaluate(el=>getComputedStyle(el).fontSize), width <=650 ? '34px' : '38px');
    assert.equal(await first.locator('button').evaluate(el=>getComputedStyle(el).backgroundColor), 'rgb(49, 91, 234)');
    await shot('login');
    let release;
    const gate = new Promise(r=>release=r);
    let mode = 'hold';
    await page.route('**/api/projects/qa-alpha/workspace', async route => {
      if(mode==='hold') await gate;
      if(mode==='fail') await route.fulfill({status:408,json:{error:'fixture_read_failure'}});
      else await route.continue();
    });
    await first.getByRole('button',{name:'Open Marketing'}).click();
    await first.getByRole('status').waitFor();
    await shot('loading');
    mode='fail'; release();
    await first.getByRole('alert').waitFor();
    await shot('error');
    mode='pass';
    await first.getByRole('button',{name:'Retry read'}).click();
    await second.getByRole('button',{name:'Open Marketing'}).click();
    await first.getByRole('heading',{name:'Workspace',exact:true}).waitFor();
    await second.getByRole('heading',{name:'Workspace',exact:true}).waitFor();
    await first.getByLabel('Campaign name',{exact:true}).fill('First instance campaign');
    await second.getByLabel('Campaign name',{exact:true}).fill('Second instance campaign');
    assert.equal(await first.getByLabel('Campaign name',{exact:true}).inputValue(), 'First instance campaign');
    await first.getByRole('navigation').getByRole('button',{name:'Connections',exact:true}).click();
    assert.equal(await second.getByLabel('Campaign name',{exact:true}).inputValue(), 'Second instance campaign');
    await first.getByRole('navigation').getByRole('button',{name:'Workspace',exact:true}).click();
    // This instance's own tab transition remounts its campaign form by design.
    await first.getByLabel('Campaign name',{exact:true}).fill('First instance campaign');
    if (width<=650) assert.equal(await first.locator('.marketing-shell').evaluate(el=>getComputedStyle(el).display), 'block', 'container breakpoint inside desktop viewport');
    await first.getByLabel('Campaign name',{exact:true}).focus();
    await page.keyboard.press('Tab');
    assert.equal(await first.getByLabel('Purpose',{exact:true}).evaluate(el => el === document.activeElement), true, 'keyboard stays in first instance');
    await first.getByLabel('Campaign name',{exact:true}).focus();
    assert.equal(await first.getByLabel('Campaign name',{exact:true}).evaluate(el=>getComputedStyle(el).outlineStyle),'solid');
    await shot('workspaces');
    await page.locator('.embedding-slot').evaluateAll(els=>els.forEach(el=>el.scrollTop=0));
    await shot('workspace-top');
    // Both instances render the same saved draft: cancel must restore focus locally.
    const saved = await context.request.post(`${base}/api/projects/qa-alpha/saveDraft`, { data: { requestKey:randomBytes(16).toString('hex'),material:{name:`Embedding draft ${viewport}-${width}`,budget:{currency:'USD'}} } });
    assert.equal(saved.status(),200);
    const draft=await saved.json();
    const promote=second.locator(`[data-draft-promote="${draft.id}"]`);
    await promote.waitFor();
    await promote.click();
    assert.equal(await second.locator('.promotion h2').evaluate(el => el === document.activeElement), true, 'promotion heading receives local focus');
    await writeFile(join(evidence, `${viewport}-${width}-promotion-aria.txt`), await second.locator('.promotion').ariaSnapshot());
    await shot('promotion');
    const promotionFile = `${viewport}-${width}-promotion-detail.png`;
    await second.locator('.promotion').screenshot({path:join(evidence,promotionFile)});
    report.screenshots.push({file:promotionFile,sha256:sha(await readFile(join(evidence,promotionFile)))});
    await second.getByRole('button',{name:'Cancel promotion',exact:true}).click();
    await promote.waitFor();
    assert.equal(await promote.evaluate(el=>el===document.activeElement),true,'promotion cancel restores focus to the second instance');
    assert.equal(await first.getByLabel('Campaign name',{exact:true}).inputValue(),'First instance campaign');
    // Promotion also intentionally replaces this instance's campaign-create form.
    await second.getByLabel('Campaign name',{exact:true}).fill('Second instance campaign');
    await first.getByLabel('Campaign name',{exact:true}).fill('First revised campaign');
    assert.equal(await second.getByLabel('Campaign name',{exact:true}).inputValue(),'Second instance campaign');
    // Instance-local inherited theme tokens do not alter its sibling or host.
    const secondColor=await second.locator('.marketing-root').evaluate(el=>getComputedStyle(el).color);
    await first.evaluate(el=>{el.style.setProperty('--marketing-color','rgb(30, 60, 90)');el.style.setProperty('--marketing-font-family','Georgia, serif')});
    assert.equal(await first.locator('.marketing-root').evaluate(el=>getComputedStyle(el).color),'rgb(30, 60, 90)');
    assert.equal(await second.locator('.marketing-root').evaluate(el=>getComputedStyle(el).color),secondColor);
    await page.mouse.move(viewport - 1, 1099);
    await page.locator('#host-input').focus();
    assertHost(await hostSnapshot(),before,'host remains identical after workspace interactions');
    assert.deepEqual(await page.evaluate(() => window.cspViolations), [], 'no CSP violations');
    report.cases.push({csp, controls, uncaged: true, flowHeights: {unstyledLogin: before.flowHeight, styledLogin: styledFlowHeight, final: (await hostSnapshot()).flowHeight}, viewport,containerWidth:width,selectors: audit.selectors,hostElements:before.elements.length,propertiesPerElement:Object.keys(before.elements[0].style).length,hostSnapshotSha256:sha(JSON.stringify(before)),hostComputedStylesAndLayout:true,focusHoverReducedMotion:true,states:['login','loading','error','workspace','promotion'],twoInstances:true,localPromotionFocus:true,overflow:false});
    await context.close();
  }
  assert.deepEqual(report.errors,[]);
  report.passed=true;
} catch(error) { report.failure=error.stack; throw error; }
finally {
  await writeFile(join(evidence,'report.json'),JSON.stringify(report,null,2)+'\n');
  await browser?.close();
  if(app?.server.listening) await new Promise(r=>app.server.close(r));
  await store?.close();
  await rm(dir,{recursive:true,force:true});
}
console.log(JSON.stringify({passed:report.passed,cases:report.cases.length,screenshots:report.screenshots.length}));
