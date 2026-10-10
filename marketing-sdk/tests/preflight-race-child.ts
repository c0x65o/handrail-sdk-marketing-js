import { MarketingServer } from "../server/index.js";
import { testStore } from "./datastore.js";
import type { Campaign } from "../core/index.js";
const [path,campaignId]=process.argv.slice(2);
const store=await testStore(path!);
try {
  if (process.argv[4] === "replay") {
    const base=MarketingServer.unconnected(store);
    const server=new MarketingServer(store,base.providers,base.generation,base.agent,"fixture");
    const result=await server.call(JSON.parse(process.argv[5]!),"p","checkCampaign",JSON.parse(process.argv[6]!));
    process.send?.({result});
  } else {
  const c=await store.get<Campaign>("p","campaign",campaignId!);
  c.material.headline="Independent process edit while native read is delayed";
  await store.transaction(()=>store.put("p","campaign",c.id,c));
  process.send?.({changed:true});
  }
}finally{await store.close();}
