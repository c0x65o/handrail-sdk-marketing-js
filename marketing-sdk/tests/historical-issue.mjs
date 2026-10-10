import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import * as sdk from '@handrail/marketing/server';
const [version,out]=process.argv.slice(2), path=join(out,'synthetic.sqlite'), store=new sdk.Store(path);
let calls=0;
try {
 await store.db.prepare('INSERT INTO projects VALUES(?,?)').run('p','Synthetic historical project');
 const uid=await store.createUser('synthetic','');await store.db.prepare('INSERT INTO memberships VALUES(?,?,?)').run(uid,'p','admin');
 const p=await store.authenticate(await store.login('synthetic','','fixture'));
 const key=randomBytes(32),apps={meta:{clientId:'SYNTHETIC_APP',clientSecret:'SYNTHETIC_APP_SECRET'}};
 const custody=new sdk.HostAgent(store,'https://sdk.example',apps,sdk.createCredentialCipher('synthetic',()=>key),async()=>{calls++;throw Error('Network forbidden');});
 const policy={revision:'1',appLabel:'Synthetic old source',allowedOperations:['setup','report'],allowedOAuthScopes:['ads_read'],allowOffline:false,maxDurationSeconds:3600,discoveryRetentionSeconds:1800};
 let issued;
 if(version==='0.1.8') {
  const service=sdk.createConnections({store,custody,accessPolicy:async()=>policy,evidence:'fixture'});
  const call=(cmd,input)=>service.call(p,'p',cmd,input),change=c=>({connectionId:c.id,expectedRevision:c.revision,requestKey:randomBytes(16).toString('hex')});
  let c=await call('startConnection',{provider:{kind:'advertising',provider:'meta'},intent:{kind:'advertising',operations:['setup','report']},requestKey:'historical-source-issued',expiresAt:new Date(Date.now()+1800000).toISOString(),offlineAccess:false});
  c=await call('reviewConnectionProviderAccess',change(c));const d=c.accessReview;
  c=await call('decideConnectionProviderAccess',{...change(c),decisionRef:d.decisionRef,digest:d.digest,decision:'approved'});
  c=await call('beginConnectionHandoff',change(c));
  const routes=service.routes({origin:custody.origin,authenticate:async()=>p});
  const result=await routes(new Request(custody.origin+c.handoffPath));assert.equal(result.status,303);issued=result.headers.get('location');
 } else {
  const grant={id:'historical-grant',projectId:'p',revision:1,provider:'meta',accountId:'synthetic-account',label:'Synthetic pre-existing old authority',currency:'USD',timezone:'UTC',permissions:['setup','report'],expiresAt:new Date(Date.now()+1800000).toISOString(),revokedAt:null,secretRef:'synthetic-unused'};
  await store.put('p','grant',grant.id,grant);issued=await custody.begin(p,'p',grant.id);
 }
 const url=new URL(issued);assert.equal(url.searchParams.get('redirect_uri'),'https://sdk.example/api/oauth/p/meta/callback');assert.equal(calls,0);
 const rows=await store.db.prepare('SELECT project_id,kind,id,body FROM records ORDER BY kind,id').all();
 await writeFile(join(out,'issued.json'),JSON.stringify({version,issued,principal:p,key:key.toString('base64'),apps,policy,calls,rows},null,2)+'\n');
} finally {await store.close();}
