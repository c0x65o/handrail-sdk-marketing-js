import { MarketingServer, HostAgent, NativeProvider, createConnections, createCredentialCipher } from "../server/index.js";
import { testStore } from "./datastore.js";
import { trackingFixture } from "./tracking-fixture.js";

const input = JSON.parse(process.argv[2]!);
const store = await testStore(input.path);
process.on("message", () => {}); // Keep the IPC process alive until the parent kills it.
const fetcher: typeof fetch = async () => {
  process.send?.({ reading: true });
  return new Promise<Response>(() => {}); // External read boundary; never opens a socket.
};
const custody = new HostAgent(store, "https://sdk.example", { meta: { clientId: "SYNTHETIC_APP", clientSecret: "SYNTHETIC_APP_SECRET" } },
  createCredentialCipher("fixture", () => Buffer.from(input.key, "base64")), fetcher);
const connections = createConnections({ store, custody, evidence: "fixture", accessPolicy: async () => input.policy });
const source = await trackingFixture(store, "http://127.0.0.1:12345", () => Date.now(), false);
const base = MarketingServer.unconnected(store), provider = new NativeProvider("meta", custody, store, fetcher);
const server = new MarketingServer(store, { meta: provider, google: provider, linkedin: provider }, base.generation, base.agent, "fixture",
  undefined, undefined, { connections, tracking: source.options });
await server.call(input.principal, "p", "checkCampaign", input.check);
