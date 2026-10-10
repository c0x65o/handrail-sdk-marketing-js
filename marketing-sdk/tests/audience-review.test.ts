import test from 'node:test';
import assert from 'node:assert/strict';
import { nativePreflightFixture } from './preflight-fixture.js';
import { testStore } from './datastore.js';
import { revokeIndependently } from './independent-revocation.js';
import type { AudienceContext, Grant } from '../core/index.js';

const context = (f: Awaited<ReturnType<typeof nativePreflightFixture>>): AudienceContext => ({grantId:f.c.grantId,expectedGrantRevision:f.check.expectedGrantRevision,material:f.c.material,facet:'country',locale:'en_US'});

test('two Connections accounts cannot reuse country choices or cursors, even with identical country labels', async()=>{
  const f=await nativePreflightFixture(true);
  try {
    let c=await f.discovered();
    c=await f.call('discoverConnectionAccounts',{...f.change(c),cursor:c.discovery.cursor!});
    c=await f.call('selectConnectionAccount',{...f.change(c),choiceRef:c.discovery.accounts[1]!.choiceRef});
    c=await f.call('connectionIdentities',f.change(c));
    c=await f.call('selectConnectionIdentity',{...f.change(c),choiceRefs:[c.discovery.identities[0]!.choiceRef]});
    c=await f.call('reviewConnectionAccess',f.change(c));
    c=await f.call('decideConnectionAccess',{...f.change(c),decisionRef:c.accessReview!.decisionRef,digest:c.accessReview!.digest,decision:'approved'});
    c=await f.call('resumeConnection',f.change(c));
    const g=await f.store.get<Grant>('p','grant',c.grantId!);
    assert.notEqual(g.accountId,f.c.material.settings!.accountId);
    const a=context(f),b:AudienceContext={...a,grantId:g.id,expectedGrantRevision:g.revision,material:{...a.material,settings:{...f.c.material.settings!,accountId:g.accountId}}};
    f.http.override=u=>u.pathname.endsWith('/search')?Response.json({data:[{key:'CA',name:'Canada',type:'country'}],paging:{next:'https://never-follow.invalid/',cursors:{after:'more'}}}):undefined;
    const first=await f.call('searchAudience',{...a,query:'Canada'}),second=await f.call('searchAudience',{...b,query:'Canada'});
    assert.equal(first.choices[0]!.label,second.choices[0]!.label);
    assert.notEqual(first.choices[0]!.choiceRef,second.choices[0]!.choiceRef);
    await assert.rejects(f.call('resolveAudience',{...b,choiceRefs:[first.choices[0]!.choiceRef],selected:[]}),/stale/);
    await assert.rejects(f.call('searchAudience',{...b,query:'Canada',continuation:first.continuation!}),/stale/);
    await assert.rejects(f.server.call(f.bobPrincipal,'p','resolveAudience',{...a,choiceRefs:[first.choices[0]!.choiceRef],selected:[]}),/stale/);
    const own=await f.call('resolveAudience',{...b,choiceRefs:[second.choices[0]!.choiceRef],selected:[]});
    assert.deepEqual(own.selections.map(s=>s.code),['CA']);
    const before=f.http.trace.length;
    f.policy({...f.currentPolicy(),revision:'changed'});
    await assert.rejects(f.call('searchAudience',{...a,query:'Canada'}),/configuration_changed/);
    assert.equal(f.http.trace.length,before,'cache hit must reauthorize without provider traffic');
  } finally {await f.close();}
});

test('country renaming preserves exact identity and revoked grants invalidate cached status/search',async()=>{
  const f=await nativePreflightFixture(true);
  try {
    const a=context(f);
    await f.call('searchAudience',{...a,query:'Canada'});
    f.http.override=u=>u.pathname.endsWith('/search')?Response.json({data:[{key:'CA',name:'Renamed Canada',type:'country'}]}):undefined;
    const renamed=await f.call('resolveAudience',{...a,choiceRefs:[],selected:['CA']});
    assert.equal(renamed.selections[0]!.code,'CA');assert.equal(renamed.selections[0]!.label,'Renamed Canada');
    const other=await testStore(f.path);
    try {const g=await other.get<Grant>('p','grant',f.c.grantId);await other.put('p','grant',g.id,{...g,revokedAt:new Date().toISOString()});} finally {await other.close();}
    await assert.rejects(f.call('audienceStatus',{...a,selected:['CA']}),/revoked/);
    await assert.rejects(f.call('searchAudience',{...a,query:'Canada'}),/revoked/);
  }finally{await f.close();}
});

for(const command of ['saveCampaign','planningWrite','promoteStudio'] as const)
test(`${command}: every media body read is outside both SQL/session guards`,async()=>{
  const f=await nativePreflightFixture(true),other=await testStore(f.path);
  let release=()=>{};
  const prepare=f.store.db.prepare.bind(f.store.db);
  try{
    const d=command==='promoteStudio'?await f.call('saveStudioMaterial',{draftId:f.d.id,expectedRevision:f.d.revision,requestKey:'new-revision',material:f.d.material,step:'tracking'}):f.d;
    const save={id:f.c.id,expectedRevision:f.c.revision,grantId:f.c.grantId,material:{...f.c.material,headline:'Independently reviewed edit'},requestKey:'review-save'};
    const scope=(await f.server.workspace(f.principal,'p')).planningScope!;
    let enter=()=>{},reads=0;const entered=new Promise<void>(r=>enter=r),held=new Promise<void>(r=>release=r);
    f.store.db.prepare=((sql:string)=>{
      const s=prepare(sql);
      if(sql==='SELECT bytes FROM blobs WHERE project_id=? AND digest=?'){
        const get=s.get.bind(s);s.get=async(...args:any[])=>{reads++;enter();await held;return get(...args);};
      }return s;
    }) as typeof prepare;
    const pending=(command==='saveCampaign'?f.call(command,save):command==='planningWrite'?f.call(command,{command:'saveCampaign',input:save,requestKey:'review-envelope',scope}):f.call(command,{...f.input,expectedRevision:d.revision,requestKey:'review-promotion'})).catch(e=>e);
    await entered;
    const progress=other.put('p','probe','unrelated',{id:'unrelated'}).then(()=>true);
    assert.equal(await Promise.race([progress,new Promise(r=>setTimeout(()=>r(false),750))]),true);
    await revokeIndependently(f.hostPath,f.principal.externalSessionRef!,'role');
    release();assert.ok(await pending instanceof Error);assert.equal(reads,1);
    assert.deepEqual(await other.get('p','campaign',f.c.id),f.c);
  }finally{release();f.store.db.prepare=prepare;await other.close();await f.close();}
});

test('save final SQL byte comparison rejects replacement after the unlocked observation',async()=>{
  const f=await nativePreflightFixture(true),other=await testStore(f.path),prepare=f.store.db.prepare.bind(f.store.db);
  try{
    let changed=false;
    f.store.db.prepare=((sql:string)=>{const s=prepare(sql);if(sql==='SELECT bytes FROM blobs WHERE project_id=? AND digest=?'){
      const get=s.get.bind(s);s.get=async(...args:any[])=>{const row=await get(...args);if(!changed){changed=true;await other.db.prepare('UPDATE blobs SET bytes=? WHERE project_id=? AND digest=?').run(Buffer.from('corrupted synthetic bytes'),...args);}return row;};
    }return s;}) as typeof prepare;
    await assert.rejects(f.call('saveCampaign',{id:f.c.id,expectedRevision:f.c.revision,grantId:f.c.grantId,material:f.c.material,requestKey:'changed-bytes'}),/asset_bytes_missing_or_changed/);
    assert.deepEqual(await other.get('p','campaign',f.c.id),f.c);
  }finally{f.store.db.prepare=prepare;await other.close();await f.close();}
});

test('successful save reads each media body once and preserves immutable replay',async()=>{
  const f=await nativePreflightFixture(true),prepare=f.store.db.prepare.bind(f.store.db);
  try{
    let reads=0;
    f.store.db.prepare=((sql:string)=>{const s=prepare(sql);if(sql==='SELECT bytes FROM blobs WHERE project_id=? AND digest=?'){const get=s.get.bind(s);s.get=async(...args:any[])=>{reads++;return get(...args);};}return s;}) as typeof prepare;
    const input={id:f.c.id,expectedRevision:f.c.revision,grantId:f.c.grantId,material:{...f.c.material,headline:'Reviewed saved copy'},requestKey:'one-body-read'};
    const saved=await f.call('saveCampaign',input);assert.equal(reads,1);
    assert.deepEqual(await f.call('saveCampaign',input),saved);assert.equal(reads,1);
    await assert.rejects(f.call('saveCampaign',{...input,material:{...input.material,headline:'Changed replay'}}),/payload_conflict/);
  }finally{f.store.db.prepare=prepare;await f.close();}
});
