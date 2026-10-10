import { CampaignStudio } from '../server/index.js';
import { testStore } from './datastore.js';
const store=await testStore(process.argv[2]!);await store.db.acquireExecutor();
const studio=new CampaignStudio(store,{planning:{evidence:'fixture',async submit(_r,_a,retain,before){await before();await retain('fixture-response-before-crash');process.exit(23);}}},'fixture');
await studio.dispatchPlanning('p',process.argv[3]!);
process.exit(24);
