// Real SDK React/client/service + existing disposable SQL/session harness.
// Only listCampaigns transport failures/delays are injected; no fake repository.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { build } from 'vite';
import { chromium } from 'playwright';
import { testStore } from '../../.marketing-build/tests/datastore.js';
import { externalSessionFixture } from '../../.marketing-build/tests/external-session-fixture.js';
import { MarketingServer, DomainError } from '../../.marketing-build/server/index.js';
import { emptyBrief } from '../../.marketing-build/core/index.js';

const evidence=resolve(process.env.MARKETING_EVIDENCE_DIR||'artifacts/studio-library-browser');
await mkdir(evidence,{recursive:true});
const dir=await mkdtemp(join(tmpdir(),'studio-library-'));
const harness=join(evidence,'harness');await mkdir(harness,{recursive:true});
const report={sourceDigest:JSON.parse(await readFile('.marketing-build/source-manifest.json','utf8')).digest,cases:[],screenshots:[],errors:[],requests:[]};
let store,server,browser;
try {
  store=await testStore(join(dir,'library.sqlite'));await store.db.acquireExecutor();
  report.environment=`local disposable ${store.db.dialect}; real SDK React/client/service and external session fixture`;
  for(const project of ['p','other'])await store.db.prepare('INSERT INTO projects VALUES(?,?)').run(project,'Library regression');
  const host=await externalSessionFixture(store),session=await host.login(),principal=await host.principal(session.token);
  const service=MarketingServer.unconnected(store,{studio:{sessions:host.authority}});
  for(const name of ['Library pilot alpha','Library pilot beta'])await service.studio.saveBrief(principal,'p',{requestKey:name,brief:{...emptyBrief(),name}});
  const savedBefore=await store.list('p','campaignDraft');
  await writeFile(join(harness,'index.html'),'<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/main.jsx"></script></html>');
  await writeFile(join(harness,'main.jsx'),`import React from 'react';import{createRoot}from'react-dom/client';import{CampaignStudio,MarketingRoot}from'@handrail/marketing/react';import{createMarketingClient}from'@handrail/marketing';import'@handrail/marketing/react/style.css';
// Deliberately ignore abort at the transport boundary to exercise late responses.
const client=createMarketingClient('','p',(url,init)=>fetch(url,{...init,signal:undefined}));
const workspace=await client.call('workspace',{});
function App(){const[visible,setVisible]=React.useState(true),[scope,setScope]=React.useState(workspace.planningScope);return <MarketingRoot><button onClick={()=>setVisible(v=>!v)}>Toggle Studio</button><button onClick={()=>setScope(s=>s+'-new')}>Replace identity scope</button><CampaignStudio client={client} workspace={{...workspace,planningScope:scope}} visible={visible}/></MarketingRoot>;}createRoot(document.getElementById('root')).render(<App/>);`);
  await build({configFile:false,root:harness,logLevel:'warn',build:{outDir:'dist',target:'esnext'}});
  server=createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://127.0.0.1');
      if(url.pathname.startsWith('/api/')){
        const command=url.pathname.split('/').at(-1);report.requests.push(command);
        assert.ok(['workspace','listCampaigns','studio'].includes(command),'browser must never write');
        const chunks=[];for await(const c of req)chunks.push(c);
        const p=await host.authenticate(new Request(url,{headers:{cookie:req.headers.cookie||''}}));
        const input=JSON.parse(Buffer.concat(chunks).toString());
        const output=await service.call(p,'p',command,command==='listCampaigns'?{...input,limit:1}:input);
        res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(output));return;
      }
      const file=resolve(harness,'dist',url.pathname==='/'?'index.html':'.'+url.pathname);
      assert.ok(file.startsWith(resolve(harness,'dist')+'/'));
      res.writeHead(200,{'content-type':extname(file)==='.js'?'text/javascript':extname(file)==='.css'?'text/css':'text/html'});res.end(await readFile(file));
    }catch(e){report.errors.push(String(e));res.writeHead(e instanceof DomainError?e.status:500,{'content-type':'application/json'});res.end(JSON.stringify({error:String(e)}));}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true,executablePath:process.env.MARKETING_CHROMIUM_PATH||undefined,args:['--no-sandbox']});
  for(const width of [1440,390]){
    const context=await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block'});
    await context.addCookies([{name:'host_session',value:session.token,url:base,httpOnly:true,sameSite:'Strict'}]);
    await context.route('**/*',r=>r.request().url().startsWith(base+'/')?r.continue():r.abort());
    const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
    const library=page.locator('.studio-library'),empty=library.getByText('No records in this view. Start a brief or change the filter.',{exact:true});
    const rows=library.locator('.studio-records article'),search=library.getByLabel('Search campaigns');
    const fail=r=>r.fulfill({status:408,json:{error:'fixture_library_read_failed'}});
    let read=fail;await page.route('**/listCampaigns',r=>read(r));
    const shot=async name=>{assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);const file=`${width}-${name}.png`;await library.screenshot({path:join(evidence,file)});report.screenshots.push({file,sha256:createHash('sha256').update(await readFile(join(evidence,file))).digest('hex')});};
    const noEmpty=async()=>assert.equal(await empty.count(),0);
    const submit=()=>library.getByRole('button',{name:'Search',exact:true}).click();
    const settled=()=>library.getByText('Loading campaign library…',{exact:true}).waitFor({state:'hidden'});
    await page.goto(base);await page.getByRole('alert').waitFor();await shot('initial-failure');await noEmpty();
    // Local editor errors are independent of successful/failed library reads.
    await page.getByLabel('Campaign name',{exact:true}).fill('');
    await page.getByRole('button',{name:'Save brief',exact:true}).click();
    const editorError=page.getByRole('alert').filter({hasText:'Enter a campaign name'});await editorError.waitFor();
    let release,started;const gate=new Promise(r=>release=r),requested=new Promise(r=>started=r);
    read=async r=>{started();await gate;await r.continue();};
    await library.getByRole('button',{name:'Retry library read'}).click();await requested;
    await library.getByRole('status').waitFor();await noEmpty();await library.getByRole('alert').waitFor();await shot('retry-pending');
    release();await settled();await rows.first().waitFor();assert.match(await rows.innerText(),/Library pilot (alpha|beta)/);await editorError.waitFor();await shot('recovered');
    const firstName=await rows.locator('h3').innerText();
    read=fail;await library.getByRole('button',{name:'More records'}).click();await library.getByRole('alert').waitFor();assert.equal(await rows.count(),1);assert.equal(await rows.locator('h3').innerText(),firstName);await noEmpty();await shot('pagination-failure');
    read=r=>r.continue();await library.getByRole('button',{name:'Retry library read'}).click();await page.waitForFunction(()=>document.querySelectorAll('.studio-records article').length===2);assert.equal(await library.getByRole('alert').count(),0);
    await page.getByLabel('Campaign name',{exact:true}).fill('Retained unsaved brief');
    await search.fill('missing');await noEmpty();assert.equal(await rows.count(),0);await shot('unsubmitted-search');
    read=fail;await submit();await library.getByRole('alert').waitFor();await noEmpty();assert.equal(await rows.count(),0);await shot('search-failure');
    read=r=>r.continue();await library.getByRole('button',{name:'Retry library read'}).click();await empty.waitFor();await editorError.waitFor();await shot('confirmed-empty');
    assert.equal(await page.getByLabel('Campaign name',{exact:true}).inputValue(),'Retained unsaved brief');
    // An editor action cannot erase a library failure or suppress true emptiness.
    read=fail;await submit();await library.getByRole('alert').waitFor();await page.getByRole('button',{name:'Start a brief',exact:true}).click();await library.getByRole('alert').waitFor();await noEmpty();
    // Late failure and late success must not settle a newer successful search.
    for(const late of ['failure','success']){
      let captured;const pending=new Promise(r=>captured=r);
      read=r=>{captured(r);};await search.fill('old');await submit();const old=await pending;
      read=r=>r.continue();await search.fill('alpha');await submit();await rows.getByRole('heading',{name:'Library pilot alpha'}).waitFor();
      const response=page.waitForResponse(r=>r.url().endsWith('/listCampaigns')&&r.request().postDataJSON().query==='old');
      if(late==='failure')await fail(old);else await old.fulfill({json:{items:[],nextCursor:null}});await response;
      await page.waitForTimeout(100);assert.equal(await library.getByRole('alert').count(),0);await noEmpty();assert.equal(await rows.locator('h3').innerText(),'Library pilot alpha');
    }
    // A failed filter read hides old rows; even a late page cannot contaminate it.
    await search.fill('');read=r=>r.continue();await submit();await rows.first().waitFor();
    let captured;const pending=new Promise(r=>captured=r);read=r=>{captured(r);};await library.getByRole('button',{name:'More records'}).click();const old=await pending;
    read=fail;await library.getByLabel('Library view').selectOption('archived');await library.getByRole('alert').waitFor();await noEmpty();assert.equal(await rows.count(),0);
    read=r=>r.continue();await library.getByRole('button',{name:'Retry library read'}).click();await empty.waitFor();await old.continue();await page.waitForTimeout(100);await empty.waitFor();assert.equal(await rows.count(),0);await shot('empty-archive');
    // Hiding cancels reads; returning retries the current view, preserving edits.
    read=r=>r.continue();await library.getByLabel('Library view').selectOption('active');await rows.first().waitFor();
    let hiddenRead;const hiddenPending=new Promise(r=>hiddenRead=r);read=r=>{hiddenRead(r);};await submit();const hidden=await hiddenPending;
    await page.getByRole('button',{name:'Toggle Studio'}).click();await fail(hidden);
    read=r=>r.continue();await page.getByRole('button',{name:'Toggle Studio'}).click();await rows.first().waitFor();assert.equal(await library.getByRole('alert').count(),0);
    assert.equal(await page.getByLabel('Campaign name',{exact:true}).inputValue(),'Retained unsaved brief');
    // Restore a browser-held pending intent, then prove read recovery never replays it.
    const retained=await page.evaluate(()=>{
      const key=Object.keys(sessionStorage).find(k=>k.startsWith('marketing:studio:v1:'));
      const local=JSON.parse(sessionStorage.getItem(key));
      local.pending={command:'saveBrief',input:{requestKey:'pending-library-regression',brief:local.brief}};
      const value=JSON.stringify(local);sessionStorage.setItem(key,value);return {key,value};
    });
    read=fail;await page.reload();await library.getByRole('alert').waitFor();await page.getByLabel('Pending Studio save').waitFor();await noEmpty();
    read=r=>r.continue();await library.getByRole('button',{name:'Retry library read'}).click();await rows.first().waitFor();
    assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),retained.key),retained.value);
    await page.getByLabel('Pending Studio save').waitFor();
    // A denied library read hides saved rows without discarding/replaying a pending write.
    read=r=>r.fulfill({status:403,json:{error:'forbidden'}});await submit();await library.getByRole('alert').waitFor();
    assert.equal(await rows.count(),0);await noEmpty();assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),retained.key),retained.value);
    // Identity remount clears rows and local edits; an initial failure stays unknown.
    read=fail;await page.getByRole('button',{name:'Replace identity scope'}).click();await library.getByRole('alert').waitFor();assert.equal(await rows.count(),0);await noEmpty();assert.equal(await page.getByLabel('Campaign name',{exact:true}).inputValue(),'Untitled campaign');
    report.cases.push({width,initialFailure:true,retryNonempty:true,emptySuccess:true,editorErrorIsolation:true,paginationRecovery:true,failedSearch:true,outOfOrderSuccessAndFailure:true,filterRace:true,hiddenAbort:true,identityReset:true,unsavedEditsRetained:true,pendingIntentRetainedWithoutReplay:true,deniedReadHidesRows:true});
    await context.close();
  }
  assert.deepEqual(await store.list('p','campaignDraft'),savedBefore,'reads and UI errors must not mutate persisted drafts');
  assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.failure=error.stack;throw error;}
finally{await writeFile(join(evidence,'report.json'),JSON.stringify(report,null,2)+'\n');await browser?.close();if(server?.listening)await new Promise(r=>server.close(r));await store?.close();await rm(dir,{recursive:true,force:true});}
console.log(JSON.stringify({passed:report.passed,cases:report.cases.length,screenshots:report.screenshots.length}));
