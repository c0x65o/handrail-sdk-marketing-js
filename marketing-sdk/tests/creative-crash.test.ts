import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { dirname } from 'node:path';
import { rmSync } from 'node:fs';
import { testStore } from './datastore.js';
import { CreativeConnections, EncryptedCredentialCustody, createCredentialCipher } from '../server/index.js';
for (const mode of ['vault-write', 'commit']) test(`review: creative SIGKILL after ${mode} retains the original intent and fences uncertain custody`, async () => {
  const child = fork(new URL('./creative-crash-child.js', import.meta.url), [mode], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let data: any, store: Awaited<ReturnType<typeof testStore>> | undefined;
  try {
    [data] = await Promise.race([once(child, 'message'), once(child, 'exit').then(() => { throw Error('Child exited before crash boundary'); }), new Promise<never>((_, reject) => { setTimeout(() => reject(Error('Crash boundary timeout')), 20000).unref(); })]);
    const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
    store = await testStore(data.path);
    const creative = new CreativeConnections({ store, environment: 'fixture', custody: new EncryptedCredentialCustody(store, createCredentialCipher('fixture', () => Buffer.from(data.fixtureKey, 'base64'))), accessPolicy: async () => data.policy });
    const cid = data.location.split('/').at(-1)!;
    const status = await creative.inspect(data.principal, 'p', cid);
    assert.equal(status.credential, mode === 'commit' ? 'configured' : 'unavailable');
    assert.equal((await store.list('p', 'vault')).length, 1);
    const before = await store.list('p', 'vault');
    const routes = creative.routes({ origin: 'https://sdk.example', authenticate: async () => data.principal });
    const response = await routes(new Request('https://sdk.example' + data.location, { method: 'POST', headers: { origin: 'https://sdk.example', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...data.input, apiKey: 'SYNTHETIC_RECOVERY_KEY_NOT_REAL' }) }));
    assert.equal(response!.status, mode === 'commit' ? 303 : 409);
    if (mode === 'commit') assert.deepEqual(await store.list('p', 'vault'), before);
    assert.equal((await store.list('p', 'vault')).length, 1);
    assert.equal((await store.list('p', 'creativeConnection')).length, 1);
    assert.equal((await store.list('p', 'generationGrant')).length, 0);
    assert.equal((await store.list('p', 'generationCostReservation')).length, 0);
  } finally { child.kill('SIGKILL'); await store?.close(); if (data) rmSync(dirname(data.path), { recursive: true, force: true }); }
});
