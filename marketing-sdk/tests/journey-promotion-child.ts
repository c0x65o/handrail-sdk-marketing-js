import { MarketingServer } from '../server/index.js';
import { testStore } from './datastore.js';
import { trackingFixture } from './tracking-fixture.js';
const store=await testStore(process.argv[2]!);
const source=await trackingFixture(store,'http://127.0.0.1:12345',()=>Date.now(),false);
const base=MarketingServer.unconnected(store);
const server=new MarketingServer(store,base.providers,base.generation,base.agent,'fixture',undefined,undefined,{tracking:source.options});
process.send?.('ready');
process.once('message',async()=>{
  try{const c=await server.call(JSON.parse(process.argv[3]!), 'p', 'promoteStudio', JSON.parse(process.argv[4]!));process.send?.({id:c.id});}
  catch(e){process.send?.({error:(e as Error).message});process.exitCode=1;}
  finally{await store.close();process.disconnect?.();}
});
