import { digest, requireThat, type Store, type TrackingOptions, type CollectorCompletion, type CollectorCheckpoint } from '@handrail/marketing/server';
import type { TrackingSource } from '@handrail/marketing';

/** Narrow external source/authentication fixture backed by real SQL. The website
 * creates completion facts after its no-send interaction. SDK receipts are never
 * inserted by this fixture. No real credentials or provider calls. */
export async function trackingFixture(store: Store, origin: string, now = () => Date.now(), initialize = true) {
  const source:TrackingSource={id:'site',projectId:'p',revision:'1',label:'Workshop website',domain:new URL(origin).hostname,environment:'production',active:true,collector:'available',reason:null,outcomes:['inquiry','purchase','mou','application','qualified','applicant_qualified','hire'],destinations:[{id:'tour',label:'Workshop enquiry and checkout',url:origin.replace('http:','https:')+'/tour',testUrl:origin+'/test'}],instructions:['Use the existing website server collector after the form or payment completes.','Retain the completion and consent receipt, then submit its reference using the existing server authentication.','The no-send fixture never sends email, places an order or contacts an ad provider.']};
  const producer={id:'existing-host-collector',revision:'1',active:true,permissions:['completion','coverage'] as ('completion'|'coverage')[]};
  if(initialize) {await store.put('p','fixtureHostSource','site',source);await store.put('p','fixtureHostCollector',producer.id,producer);}
  const readProducer=()=>store.get<typeof producer>('p','fixtureHostCollector',producer.id);
  const context=async()=>{const s=await read(),p=await readProducer();requireThat(p.active&&s.active,'collector_revoked',401);return{id:p.id,revision:digest([p.revision,s.revision,p.permissions]),permissions:p.permissions,expiresAt:now()+60000,source:s};};
  const read=()=>store.get<TrackingSource>('p','fixtureHostSource','site');
  const options:TrackingOptions={sources:{
    async inspectAccess(session,source){return session.projectId===source.projectId && source.active;},
    async inspectUniverse(project){requireThat(project==='p','source_denied',403);return [await read()];},
    async catalogue(s){return s.projectId==='p'&& (await read()).active?[await read()]:[];},
    async inspect(project,id){requireThat(project==='p'&&id==='site','source_denied',403);return read();},
    async withLiveSources(expected,local){return store.transaction(async()=>{for(const s of expected)requireThat(digest(await read())===digest(s),'source_changed',403);const r=await local();for(const s of expected)requireThat(digest(await read())===digest(s),'source_changed',403);return r;});},
  },collector:{
    async authenticateRequest(request){requireThat(request.headers.get('x-fixture-collector')==='synthetic-collector-only','collector_authentication_required',401);return context();},
    async inspectCollector(id){return id===producer.id?context():null;},
    async verifyCompletion(_context,receipt){return store.get<CollectorCompletion>('p','fixtureHostCompletion',receipt);},
    async verifyCheckpoint(_context,checkpoint){return store.get<CollectorCheckpoint>('p','fixtureHostCheckpoint',checkpoint);},
    async withLiveCollector(expected,local){return store.transaction(async()=>{const check=async()=>{const current=await context();requireThat(current.id===expected.id&&current.revision===expected.revision&&digest(current.source)===digest(expected.source),'collector_revoked',401);};await check();const result=await local();await check();return result;});},
  }};
  return {options,source,read,producer,saveProducer:(p:typeof producer)=>store.put('p','fixtureHostCollector',p.id,p),saveSource:(s:TrackingSource)=>store.put('p','fixtureHostSource','site',s),
    retainCompletion:(f:CollectorCompletion)=>store.put('p','fixtureHostCompletion',f.sourceReceipt,f),
    retainCheckpoint:(f:CollectorCheckpoint)=>store.put('p','fixtureHostCheckpoint',f.id,f)};
}
