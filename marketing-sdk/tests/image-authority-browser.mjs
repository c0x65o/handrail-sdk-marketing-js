// Real React/Chromium with an explicitly synthetic native authority transport.
// This qualifies UI recovery and settings, not provider delivery or owner consent.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer,build} from 'vite';
import {chromium} from 'playwright';
const root=process.cwd(),dir=await mkdtemp(join(tmpdir(),'marketing-image-ui-'));
let server,browser,page;
const errors=[],report={evidence:'synthetic authority transport; real SDK React and Chromium',cases:[],errors};
try{
 await writeFile(join(dir,'index.html'),'<div id="root"></div><script type="module" src="/main.jsx"></script>');
 await writeFile(join(dir,'main.jsx'),`
import React,{useState,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {ImageAuthorityPanel} from '${root}/marketing-sdk/react/image-authority.tsx';
import '${root}/marketing-sdk/react/style.css';
window.calls={configuration:0,estimate:0,review:0,approve:0,revoke:0,request:0,generate:0};
window.mode='success';window.receipts={};
const cost={currency:'USD',estimatedUsd:'0.01319',estimatedMinor:2,source:'https://developers.openai.com/api/docs/pricing',providerOverhead:'not_observed'};
const authority={
 configuration:async()=>{window.calls.configuration++;return {models:[{id:'gpt-image-2.5-flare',label:'GPT Image 2.5 Flare',qualities:['low','medium','high','xhigh','max'],sizes:['1024x1024','1536x1024']}],permission:window.mode==='blocked'?'native_policy_blocks_generation':'review_required',credentialAvailable:true};},
 estimate:async input=>{window.calls.estimate++;window.estimateInput=input;return cost;},
 review:async input=>{window.calls.review++;const review={id:'fixture-review',digest:'fixture-review-digest',input,cost,permission:window.mode==='blocked'?'native_policy_blocks_generation':'review_required'};window.receipts.review=review;if(window.mode==='lost-review')throw Error('Synthetic lost review response');return review;},
 approve:async input=>{window.calls.approve++;window.approveInput=input;const approval={id:'fixture-grant',digest:'fixture-approval-digest',reviewId:input.reviewId,quote:{receipt:'fixture-quote',expiresAt:window.receipts.review.input.expiresAt,currency:'USD',maxUnitMinor:window.receipts.review.input.reservationMinor}};window.receipts.approve=approval;if(window.mode==='lost-approval')throw Error('Synthetic lost approval response');return approval;},
 revoke:async input=>{window.calls.revoke++;return {revokedAt:new Date().toISOString()};},
 request:async input=>{window.calls.request++;window.lastRead=input;return window.receipts[input.command]?{found:true,result:window.receipts[input.command]}:{found:false};},
};
function App(){const [revision,setRevision]=useState(3),[busy,setBusy]=useState(false),[error,setError]=useState(''),[jobs,setJobs]=useState([]);const lock=useRef(false);window.setRevision=setRevision;
 const run=async work=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await work();}catch(e){setError(e.message);}finally{lock.current=false;setBusy(false);}};
 return <div className="marketing-root studio"><section className="card studio-editor">{error&&<p role="alert">{error}</p>}<ImageAuthorityPanel authority={authority} draftId="fixture-draft" revision={revision} storage="fixture" disabled={busy} jobs={jobs} run={run} onGenerate={async input=>{window.calls.generate++;window.generated=input;setJobs([{id:'fixture-job',grantId:input.grantId,state:'retained'}]);}}/></section></div>;}
createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
`);
 const config={configFile:false,root:dir,logLevel:'error',esbuild:{jsx:'automatic'},resolve:{alias:{'react/jsx-runtime':join(root,'node_modules/react/jsx-runtime.js'),'react':join(root,'node_modules/react/index.js'),'react-dom/client':join(root,'node_modules/react-dom/client.js')}}};
 await build({...config,build:{outDir:join(dir,'dist'),emptyOutDir:true}});
 server=await createServer({configFile:false,root:join(dir,'dist'),logLevel:'error',server:{host:'127.0.0.1',port:0}});await server.listen();
 browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));
 const url=`http://127.0.0.1:${server.httpServer.address().port}`;
 await page.goto(url);
 async function reset(mode){await page.evaluate(()=>sessionStorage.clear());await page.reload();await page.evaluate(mode=>window.mode=mode,mode);await page.getByRole('button',{name:'Check image setup',exact:true}).click();await page.getByLabel('Image model',{exact:true}).selectOption('gpt-image-2.5-flare');await page.getByLabel('Artwork prompt',{exact:true}).fill('A workshop invitation');await page.getByLabel('Generation rights declaration',{exact:true}).fill('Synthetic test concept');await page.getByLabel('Reservation (USD)',{exact:true}).fill('0.10');await page.getByLabel('Approval expires (local time)',{exact:true}).fill('2099-10-18T12:00');}
 async function review(){await page.getByRole('button',{name:'Review exact image request',exact:true}).click();}
 async function waitFor(fn){await page.waitForFunction(fn);}
 await reset('success');await page.getByRole('button',{name:'Estimate image cost',exact:true}).click();await waitFor(()=>window.calls.estimate===1);assert.equal((await page.evaluate(()=>window.estimateInput)).quality,'medium');assert.equal(await page.evaluate(()=>window.calls.approve+window.calls.generate),0);
 await review();await page.getByRole('button',{name:'Approve $0.10 and generate once',exact:true}).click();await waitFor(()=>window.calls.generate===1);assert.equal(await page.evaluate(()=>window.calls.approve),1);assert.equal((await page.evaluate(()=>window.generated)).quoteReceipt,'fixture-quote');await page.getByRole('button',{name:'Review another image',exact:true}).waitFor();report.cases.push('exact settings, estimate without authority, explicit approval then one generation, next completed request');
 await reset('lost-review');await review();await page.getByRole('button',{name:'Check saved generation decision',exact:true}).click();await page.getByRole('button',{name:'Approve $0.10 and generate once',exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.calls.review),1);assert.equal(await page.evaluate(()=>window.calls.generate),0);report.cases.push('lost review response recovers saved receipt without creating authority');
 await page.evaluate(()=>window.mode='lost-approval');await page.getByRole('button',{name:'Approve $0.10 and generate once',exact:true}).click();await page.getByRole('button',{name:'Check saved generation decision',exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.calls.generate),0);
 await page.getByRole('button',{name:'Check saved generation decision',exact:true}).click();await page.getByRole('button',{name:'Generate approved artwork once',exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.calls.generate),0);assert.equal(await page.evaluate(()=>window.calls.approve),1);
 await page.getByRole('button',{name:'Generate approved artwork once',exact:true}).click();await waitFor(()=>window.calls.generate===1);report.cases.push('lost approval response does not auto-generate; recovered approval permits one explicit request');
 await reset('success');await review();await page.evaluate(()=>window.setRevision(4));await waitFor(()=>document.body.textContent.includes('This draft changed.'));assert.equal(await page.getByRole('button',{name:'Approve $0.10 and generate once',exact:true}).isEnabled(),false);assert.equal(await page.evaluate(()=>window.calls.approve),0);report.cases.push('stale saved revision cannot be approved');
 await reset('blocked');await review();assert.equal(await page.getByRole('button',{name:'Approve $0.10 and generate once',exact:true}).isEnabled(),false);assert.equal(await page.evaluate(()=>window.calls.approve+window.calls.generate),0);report.cases.push('pause-only policy stays blocked');
 await mkdir('artifacts/image-authority-browser',{recursive:true});await page.screenshot({path:'artifacts/image-authority-browser/desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:'artifacts/image-authority-browser/mobile.png',fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile has no horizontal overflow');report.cases.push('desktop and narrow viewport shared control layout');
 await page.evaluate(()=>sessionStorage.setItem('fixture:image-authority:fixture-draft','{invalid'));await page.reload();await page.getByRole('alert').filter({hasText:'Saved generation recovery could not be read'}).waitFor();assert.equal(await page.getByRole('button',{name:'Check image setup',exact:true}).isEnabled(),false);assert.equal(await page.evaluate(()=>window.calls.approve+window.calls.generate),0);report.cases.push('corrupt saved decision fails closed instead of silently starting over');
 await reset('success');await review();await page.evaluate(()=>{Storage.prototype.setItem=function(){throw Error('Synthetic storage failure');};});await page.getByRole('button',{name:'Approve $0.10 and generate once',exact:true}).click();await page.getByRole('alert').filter({hasText:'Browser recovery storage unavailable'}).waitFor();assert.equal(await page.evaluate(()=>window.calls.approve+window.calls.generate),0);report.cases.push('unavailable recovery storage prevents sending a decision');
 assert.deepEqual(errors,[]);await writeFile('artifacts/image-authority-browser/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){console.error(JSON.stringify({errors,body:await page?.locator('body').innerText(),calls:await page?.evaluate(()=>window.calls)}));throw error;}finally{await browser?.close();await server?.close();await rm(dir,{recursive:true,force:true});}
