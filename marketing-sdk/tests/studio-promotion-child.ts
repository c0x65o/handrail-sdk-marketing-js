import { MarketingServer } from '@handrail/marketing/server';
import type { Commands } from '@handrail/marketing';
import { testStore } from './datastore.js';
const store=await testStore(process.argv[2]!);
const principal=JSON.parse(process.argv[3]!);
const input=JSON.parse(process.argv[4]!) as Commands['promoteStudio']['input'];
process.send?.({ready:true});
process.once('message',async()=>{
 try {const campaign=await MarketingServer.unconnected(store).call(principal,'p','promoteStudio',input);process.send?.({id:campaign.id});}
 catch(e){process.send?.({error:(e as Error).message});}
 finally{await store.close();process.disconnect?.();}
});
