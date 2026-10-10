// Disposable SQL and synthetic key only. Parent SIGKILLs at the reported boundary.
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { testStore } from './datastore.js';
import { provision } from '../reference/provision.js';
import { CreativeConnections, EncryptedCredentialCustody, createCredentialCipher } from '../server/index.js';
const dir = await mkdtemp(join(tmpdir(), 'creative-crash-')), path = join(dir, 'store.sqlite');
const store = await testStore(path);
await provision(store, { projects: [{ id: 'p', name: 'Synthetic crash fixture' }], users: [{ username: 'human', password: '', memberships: [{ projectId: 'p', role: 'admin' }] }], accountGrants: [], generationGrants: [] });
const principal = await store.authenticate((await store.login('human', '', 'fixture'))!);
const key = randomBytes(32), custody = new EncryptedCredentialCustody(store, createCredentialCipher('fixture', () => key));
const policy = { revision: '1', environment: 'fixture', appLabel: 'Synthetic', models: ['fixture-model'], maxDurationSeconds: 3600, grantIds: [] };
const creative = new CreativeConnections({ store, custody, environment: 'fixture', accessPolicy: async () => policy });
const origin = 'https://sdk.example', base = '/api/projects/p/creative/openai';
const routes = creative.routes({ origin, authenticate: async () => principal });
const post = (path: string, body: Record<string, string>) => routes(new Request(origin + path, { method: 'POST', headers: { origin, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) }));
const start = await post(base, { requestKey: randomUUID(), model: 'fixture-model', expiresAt: new Date(Date.now() + 1800000).toISOString() });
const location = start!.headers.get('location')!;
const html = await (await routes(new Request(origin + location)))!.text();
const form = [...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)].find(m => m[1]!.includes('value="approve"'))![1]!;
const input = { ...Object.fromEntries([...form.matchAll(/type="hidden" name="([^"]+)" value="([^"]*)"/g)].map(m => [m[1], m[2]])), consent: 'approved', apiKey: 'SYNTHETIC_CRASH_KEY_NOT_REAL' };
const stop = async () => {
  process.send!({ path, principal, policy, fixtureKey: key.toString('base64'), location, input });
  await new Promise(() => { setInterval(() => {}, 1000); });
};
if (process.argv[2] === 'vault-write') {
  const retain = custody.retain.bind(custody);
  custody.retain = async (...args) => { await retain(...args); await stop(); };
} else {
  const transaction = store.transaction.bind(store);
  let depth = 0;
  store.transaction = async fn => { depth++; let value; try { value = await transaction(fn); } finally { depth--; } if (depth === 0 && (await store.get<any>("p", "creativeConnection", location.split("/").at(-1)!)).state === "configured") await stop(); return value; };
}
await post(location, input);
throw Error('Crash boundary was not reached');
