import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Store,HostAgent,createCredentialCipher,createConnections } from '@handrail/marketing/server';
export async function qualifyHistorical(out, reportPath = join(out,'verdict.json')) {
 const raw=await readFile(join(out,'issued.json')),data=JSON.parse(raw),store=new Store(join(out,'synthetic.sqlite'));
 let calls=0;
 try {
  const custody=new HostAgent(store,'https://sdk.example',data.apps,createCredentialCipher('synthetic',()=>Buffer.from(data.key,'base64')),async()=>{calls++;throw Error('Forbidden exchange');});
  const service=createConnections({store,custody,accessPolicy:async()=>data.policy,evidence:'fixture'}), routes=service.routes({origin:custody.origin,authenticate:async()=>data.principal});
  const issued=new URL(data.issued),uri=issued.searchParams.get('redirect_uri'),state=issued.searchParams.get('state');
  const attempt=data.rows.find(r=>r.kind==='connectionCallback'||r.kind==='oauth');
  const pending=JSON.parse(attempt.body);assert.ok((typeof pending.expiresAt==='number'?pending.expiresAt:Date.parse(pending.expiresAt))>Date.now(),'Old pending attempt must still be unexpired');
  const before=await store.db.prepare('SELECT project_id,kind,id,body FROM records ORDER BY kind,id').all();assert.equal(JSON.stringify(before),JSON.stringify(data.rows));
  const landing=await routes(new Request(uri+'?state='+state+'&code=SYNTHETIC_CODE'));assert.equal(landing.status,200);
  const response=await routes(new Request(uri.replace(/callback$/,'complete'),{method:'POST',headers:{origin:custody.origin,'content-type':'application/json'},body:JSON.stringify({state,code:'SYNTHETIC_CODE'})}));
  assert.equal(response.status,409);assert.equal(calls,0);
  assert.deepEqual(await store.db.prepare('SELECT project_id,kind,id,body FROM records ORDER BY kind,id').all(),before);
  assert.deepEqual(await readFile(join(out,'issued.json')),raw);
  await writeFile(reportPath,JSON.stringify({candidateSourceDigest:JSON.parse(await readFile('.marketing-build/source-manifest.json','utf8')).digest,version:data.version,verdict:'safe restart; missing independently inspected session/claim/decision provenance',issuedEvidenceSha256:createHash('sha256').update(raw).digest('hex'),issuedUri:uri,completionStatus:response.status,providerCalls:calls,originalRecordBytesPreserved:true,wasPendingAndUnexpired:true,realAccountQualification:false},null,2)+'\n');
 } finally {await store.close();}
}
