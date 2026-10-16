import test from 'node:test';
import assert from 'node:assert/strict';
import {nativePreflightFixture} from './preflight-fixture.js';
import {MarketingServer,NativeProvider,digest,requireThat,inspectLiveSessions,type CampaignAccess,type VaultPort} from '../server/index.js';
import type {Grant,Commands,Campaign} from '../core/index.js';

async function hostFixture() {
  const f=await nativePreflightFixture(true);
  try {
    const original=await f.store.get<Grant>('p','grant',f.c.grantId);
    const snapshot=await f.connections.campaignAuthority(f.principal,original);
    // Test setup copies synthetic credentials into closure-only host custody,
    // then removes SDK OAuth and vault records. No production import or regrant.
    const credentials=await f.custody.useReadOnly(original,async()=>{},async c=>structuredClone(c));
    const grant={...original,id:'host-grant',secretRef:'host-vault-reference'};
    await f.store.put('p','grant',grant.id,grant);
    await f.store.db.prepare('DELETE FROM records WHERE project_id=? AND kind=?').run('p','setup');
    await f.store.put('p','campaign',f.c.id,{...f.c,grantId:grant.id});
    await f.store.db.prepare('DELETE FROM records WHERE project_id=? AND kind IN (?,?)').run('p','connection','vault');
    let revision=1,denied=false,expiry=credentials.expiresAt,guards=0,held=0;
    let beforeCommit:(()=>Promise<void>)|undefined;
    const current=async(g:Grant)=>{
      requireThat(!denied && digest(g)===digest(grant) && expiry>Date.now(),'host_access_revoked');
      await inspectLiveSessions(f.connections.sessionAuthority,snapshot.sessions);
    };
    const vault:VaultPort={
      prerequisiteBinding:async g=>{await current(g);return digest({grant,revision,expiry});},
      useReadOnly:async(g,guard,local)=>{await current(g);await guard();const result=await local({...credentials,expiresAt:expiry});await current(g);await guard();return result;},
      use:async(g,local)=>{await current(g);const result=await local(credentials);await current(g);return result;},
    };
    const access:CampaignAccess={store:f.store,sessionAuthority:f.connections.sessionAuthority,
      campaignAuthority:async(p,g,observed)=>{
        assert.equal(p.userId,f.principal.userId);await current(g);
        return {...snapshot,digest:digest({grant,revision,sessions:snapshot.sessions}),
          credentialExpiresAt:observed??expiry,expiresAt:Math.min(snapshot.expiresAt,expiry-60000),receiptReferences:['host-authority:fixture']};
      },
      withCampaignAuthority:async(p,g,expected,local)=>{
        guards++;
        return f.connections.sessionAuthority.withLiveSessions(expected.sessions,()=>f.store.transaction(async()=>{
          if(beforeCommit)await beforeCommit();
          requireThat(digest(await access.campaignAuthority(p,g,expected.credentialExpiresAt))===digest(expected),'host_access_changed');
          held++;
          try {
            const result=await local();
            requireThat(digest(await access.campaignAuthority(p,g,expected.credentialExpiresAt))===digest(expected),'host_access_changed');
            return result;
          } finally {held--;}
        }));
      },
    };
    const provider=new NativeProvider('meta',vault,f.store,async(...args)=>{
      assert.equal(held,0,'provider HTTP must run outside host commit guard');return f.http.fetch(...args);
    });
    const server=new MarketingServer(f.store,{meta:provider,google:provider,linkedin:provider},f.server.generation,f.server.agent,'fixture',undefined,undefined,
      {campaignAccess:access,studio:{sessions:f.connections.sessionAuthority},tracking:f.source.options});
    const call=<K extends keyof Commands>(command:K,input:Commands[K]['input'])=>server.call(f.principal,'p',command,input);
    return {...f,server,call,access,vault,grant,provider,guards:()=>guards,
      rotate:()=>{revision++;},revoke:()=>{denied=true;},expire:()=>{expiry=Date.now()-1;},
      beforeCommit:(fn:()=>Promise<void>)=>{beforeCommit=fn;}};
  } catch(error) {await f.close();throw error;}
}

test('host custody prepares a paused campaign without SDK OAuth/vault/setup records, retaining current proof and original grant identity',async()=>{
  const f=await hostFixture();try{
    const before=digest(f.grant);
    const proof=await f.call('checkCampaign',f.check);assert.equal(proof.state,'ready',JSON.stringify(proof));
    assert.ok(f.guards()>0);assert.ok(f.http.trace.every(r=>r.method==='GET'));
    assert.deepEqual(await f.store.list('p','connection'),[]);assert.deepEqual(await f.store.list('p','vault'),[]);
    assert.deepEqual(await f.store.list('p','setup'),[]);
    assert.deepEqual(await f.call('checkCampaign',f.check),proof);
    assert.equal((await f.call('campaignCheck',{campaignId:f.c.id}))?.state,'ready');
    await f.store.db.acquireExecutor();
    const op=await f.call('prepare',{campaignId:f.c.id,requestKey:'prepare-host'});
    const result=await f.server.dispatch('p',op.id);assert.equal(result.state,'succeeded',JSON.stringify(result));
    const campaign=await f.store.get<Campaign>('p','campaign',f.c.id);
    assert.equal(campaign.state,'paused');assert.equal(campaign.grantId,'host-grant');assert.equal(campaign.receipt?.intent,'paused');
    assert.equal(digest(await f.store.get('p','grant','host-grant')),before);
    assert.deepEqual(await f.store.list('p','vault'),[]);assert.equal((await f.store.list('p','advertisingBudgetReservation')).length,0);
    const writes=f.http.trace.filter(r=>r.method==='POST').length;assert.equal(writes,5);
    assert.deepEqual(await f.server.dispatch('p',op.id),result);assert.equal(f.http.trace.filter(r=>r.method==='POST').length,writes);
  }finally{await f.close();}
});

for(const change of ['rotate','revoke','expire'] as const)test(`host ${change} after proof prevents preparation effects without falling back to SDK custody`,async()=>{
  const f=await hostFixture();try{
    assert.equal((await f.call('checkCampaign',f.check)).state,'ready');
    const op=await f.call('prepare',{campaignId:f.c.id,requestKey:'prepare-host'});
    f[change]();await f.store.db.acquireExecutor();
    const result=await f.server.dispatch('p',op.id);assert.equal(result.state,'blocked');
    assert.ok(f.http.trace.every(r=>r.method==='GET'));assert.deepEqual(await f.store.list('p','vault'),[]);
    assert.equal((await f.store.list('p','advertisingBudgetReservation')).length,0);
  }finally{await f.close();}
});

test('host revocation at the final evidence commit cannot retain ready proof',async()=>{
  const f=await hostFixture();try{
    f.beforeCommit(async()=>{f.revoke();});
    const result=await f.call('checkCampaign',f.check);assert.notEqual(result.state,'ready');assert.ok(f.guards()>0);
    assert.ok((await f.store.list<{view:{state:string}}>('p','campaignCheck')).every(r=>r.view.state!=='ready'));
    assert.ok(f.http.trace.every(r=>r.method==='GET'));
  }finally{await f.close();}
});

test('native host grants need exact prerequisite proof and cannot use legacy capability evidence instead',async()=>{
  const f=await hostFixture();try{
    await f.store.db.acquireExecutor();
    const op=await f.call('prepare',{campaignId:f.c.id,requestKey:'unchecked-host'});
    const result=await f.server.dispatch('p',op.id);assert.equal(result.state,'blocked');assert.equal(result.reason,'campaign_prerequisites_not_checked');
    assert.ok(f.http.trace.every(r=>r.method==='GET'));
  }finally{await f.close();}
});

test('host credential rotation after a provider write retains its IDs and never replays an uncertain operation',async()=>{
  const f=await hostFixture();try{
    assert.equal((await f.call('checkCampaign',f.check)).state,'ready');
    await f.store.db.acquireExecutor();
    const op=await f.call('prepare',{campaignId:f.c.id,requestKey:'rotating-write'});
    f.http.boundary=async(url,init)=>{if(init?.method==='POST'&&url.pathname.endsWith('/campaigns'))f.rotate();};
    const result=await f.server.dispatch('p',op.id);
    assert.equal(result.state,'unknown',JSON.stringify(result));assert.equal(result.receipt?.ids.campaign,'100');
    assert.equal(f.http.objects.size,1);
    const writes=f.http.trace.filter(r=>r.method==='POST').length;assert.equal(writes,2);
    assert.deepEqual(await f.server.dispatch('p',op.id),result);assert.equal(f.http.trace.filter(r=>r.method==='POST').length,writes);
    assert.equal((await f.store.list('p','advertisingBudgetReservation')).length,0);
  }finally{await f.close();}
});

for(const wrong of ['account','currency','session','receipts'] as const)test(`host access snapshot cannot substitute a mismatched ${wrong}`,async()=>{
  const f=await hostFixture();try{
    const original=f.access.campaignAuthority;
    f.access.campaignAuthority=async(...args)=>{
      const result=await original(...args);
      if(wrong==='account')result.account={...result.account!,id:'act_999'};
      if(wrong==='currency')result.account={...result.account!,currency:'EUR'};
      if(wrong==='session')result.sessions=[];
      if(wrong==='receipts')result.receiptReferences=[];
      return result;
    };
    const checked=await f.call('checkCampaign',f.check);assert.equal(checked.state,'blocked');
    assert.deepEqual(checked.reasons,['campaign_access_binding_invalid']);
    assert.equal(f.guards(),0);assert.equal((await f.store.list('p','operation')).length,0);
  }finally{await f.close();}
});

for(const change of ['none','custody-rotated'] as const)test(`activation-only host grant ${change} uses a distinct read-only check and cannot prepare`,async()=>{
  const f=await hostFixture();try{
    assert.equal((await f.call('checkCampaign',f.check)).state,'ready');await f.store.db.acquireExecutor();
    const prep=await f.call('prepare',{campaignId:f.c.id,requestKey:'initial-preparation'});
    assert.equal((await f.server.dispatch('p',prep.id)).state,'succeeded');
    const before=await f.store.get<Campaign>('p','campaign',f.c.id),originalIds=before.receipt!.ids;
    const preparationProof=await f.call('campaignCheck',{campaignId:f.c.id});assert.equal(preparationProof!.action,'prepare');
    f.grant.revision++;f.grant.permissions=['activate','report'];
    await f.store.put('p','grant',f.grant.id,f.grant);
    const reads=f.http.trace.length;
    await assert.rejects(f.call('checkCampaign',{...f.check,expectedGrantRevision:f.grant.revision,requestKey:'wrong-action'}),/permission|grant/);
    await assert.rejects(f.call('prepare',{campaignId:f.c.id,requestKey:'never-prepare-again'}),/permission|grant/);
    assert.equal(f.http.trace.length,reads);
    const checkInput={...f.check,action:'activate' as const,expectedGrantRevision:f.grant.revision,requestKey:'activation-only'};
    const checked=await f.call('checkCampaign',checkInput);assert.equal(checked.state,'ready',JSON.stringify(checked));assert.equal(checked.action,'activate');
    assert.ok(f.http.trace.slice(reads).every(r=>r.method==='GET'));
    const record=await f.store.get<import('../server/preflight.js').PrerequisiteRecord>('p','campaignCheck',checked.id);
    assert.equal(record.action,'activate');assert.equal(record.scope!.action,'activate');
    assert.deepEqual(await f.call('checkCampaign',checkInput),checked);
    await assert.rejects(f.call('checkCampaign',{...checkInput,action:'prepare'}),/request_key_payload_conflict/);
    const packet=await f.call('packet',{campaignId:f.c.id});
    await f.call('decide',{packetId:packet.id,digest:packet.digest,decision:'approved'});
    const operation=await f.call('execute',{packetId:packet.id,digest:packet.digest,requestKey:'activate-only'});
    const beforeWrites=f.http.trace.filter(r=>r.method==='POST').length;
    if(change==='custody-rotated')f.rotate();
    const result=await f.server.dispatch('p',operation.id);
    assert.equal(result.state,change==='none'?'succeeded':'blocked',JSON.stringify(result));
    const current=await f.store.get<Campaign>('p','campaign',f.c.id);
    assert.deepEqual(current.receipt!.ids,originalIds);assert.equal(current.state,change==='none'?'enabled':'paused');
    assert.equal(f.http.trace.filter(r=>r.method==='POST').length-beforeWrites,change==='none'?3:0);
    assert.deepEqual((await f.store.get<Grant>('p','grant',f.grant.id)).permissions,['activate','report']);
    assert.deepEqual(await f.store.list('p','vault'),[]);assert.deepEqual(await f.store.list('p','connection'),[]);
  }finally{await f.close();}
});

test('lost native activation acknowledgment reconciles through renewed report-only host custody without another POST',async()=>{
  const f=await hostFixture();try{
    assert.equal((await f.call('checkCampaign',f.check)).state,'ready');await f.store.db.acquireExecutor();
    const prep=await f.call('prepare',{campaignId:f.c.id,requestKey:'prepare-before-loss'});
    assert.equal((await f.server.dispatch('p',prep.id)).state,'succeeded');
    assert.equal((await f.call('checkCampaign',{...f.check,action:'activate',requestKey:'activation-before-loss'})).state,'ready');
    const packet=await f.call('packet',{campaignId:f.c.id});
    await f.call('decide',{packetId:packet.id,digest:packet.digest,decision:'approved'});
    const operation=await f.call('execute',{packetId:packet.id,digest:packet.digest,requestKey:'activation-lost'});
    f.http.loseActivation();
    const unknown=await f.server.dispatch('p',operation.id);assert.equal(unknown.state,'unknown');
    const writes=f.http.trace.filter(r=>r.method==='POST').length;
    const originalRevision=f.grant.revision;
    const originalIds=(await f.store.get<Campaign>('p','campaign',f.c.id)).receipt!.ids;
    f.grant.revision++;f.grant.campaignId=f.c.id;f.grant.permissions=['report'];f.rotate();
    await f.store.put('p','grant',f.grant.id,f.grant);
    const assertCurrent=async()=>{await f.vault.prerequisiteBinding!(f.grant);};
    const server=new MarketingServer(f.store,f.server.providers,f.server.generation,f.server.agent,'fixture',undefined,undefined,
      {campaignAccess:f.access,studio:{sessions:f.connections.sessionAuthority},tracking:f.source.options,
        executionAuthority:{assertCurrent,withCurrent:async(_p,_c,_a,local)=>{await assertCurrent();const result=await local();await assertCurrent();return result;}}});
    const result=await server.reconcile(f.principal,'p',{operationId:operation.id});
    assert.equal(result.id,operation.id);assert.equal(result.state,'succeeded');assert.equal(result.grantRevision,originalRevision);
    for(const key of ['campaign','adset','creative','ad','image','imageUploadDigest'])assert.equal(result.receipt?.ids[key],originalIds[key]);
    assert.ok(result.receipt?.ids.readbackDigest,'current readback evidence is distinct from preserved provider identities');
    assert.equal(f.http.trace.filter(r=>r.method==='POST').length,writes);
    assert.equal((await f.store.list('p','operation')).length,2);
    assert.deepEqual(await f.store.list('p','connection'),[]);assert.deepEqual(await f.store.list('p','vault'),[]);
    assert.equal((await f.store.get<Grant>('p','grant',f.grant.id)).permissions.join(','),'report');
  }finally{await f.close();}
});
