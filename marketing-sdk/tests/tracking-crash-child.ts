// Separate process/connection: die after durable public HTTP acceptance, before ACK.
import { createServer } from 'node:http';
import { MarketingServer, handleTrackingCollector } from '@handrail/marketing/server';
import { testStore } from './datastore.js';
import { externalSessionFixture } from './external-session-fixture.js';
import { trackingFixture } from './tracking-fixture.js';
const store=await testStore(process.argv[2]!);
const host=await externalSessionFixture(store,store,store,false);
const source=await trackingFixture(store,process.argv[3]!,undefined,false);
const base=MarketingServer.unconnected(store);
const service=new MarketingServer(store,base.providers,base.generation,base.agent,'fixture',undefined,undefined,{studio:{sessions:host.authority},tracking:source.options});
const server=createServer(async(req)=>{
  let body='';for await(const b of req)body+=b;
  await handleTrackingCollector(service.tracking,new Request('http://127.0.0.1/receipt',{method:'POST',headers:{'content-type':'application/json','x-fixture-collector':String(req.headers['x-fixture-collector']??'')},body}),'receipt');
  process.send!({event:'committed'});process.exit(0);
});
await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));process.send!({event:'listening',port:(server.address() as {port:number}).port});
