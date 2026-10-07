import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { dirname } from 'node:path';
import { rmSync } from 'node:fs';
import { testStore } from './datastore.js';
import { HostAgent, createConnections, createCredentialCipher } from '../server/index.js';

for (const mode of ['exchange', 'receipt', 'grant']) test(`review: SIGKILL at ${mode} boundary preserves original effect identity`, async t => {
  const child = fork(new URL('./connection-crash-child.js', import.meta.url), [mode], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let data: any, store: Awaited<ReturnType<typeof testStore>> | undefined;
  try {
    [data] = await Promise.race([once(child, 'message'), once(child, 'exit').then(() => { throw new Error('Child exited before crash boundary'); }),
      new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(new Error('Crash boundary timed out')), 20000); timer.unref(); })]);
    const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
    store = await testStore(data.path);
    const denyNetwork: typeof fetch = async () => { throw new Error('No network permitted during crash recovery'); };
    const custody = new HostAgent(store, 'https://sdk.example', { meta: { clientId: 'SYNTHETIC_APP', clientSecret: 'SYNTHETIC_APP_SECRET' } }, createCredentialCipher('fixture', () => Buffer.from(data.fixtureKey, 'base64')), denyNetwork);
    const service = createConnections({ store, custody, evidence: 'fixture', accessPolicy: async () => data.policy });
    let c = await service.call(data.principal, 'p', 'connection', { connectionId: data.connectionId });
    const callbacks = await store.list<any>('p', 'connectionCallback');
    if (mode === 'exchange') {
      assert.equal(callbacks[0].status, 'exchanging'); assert.equal((await store.list('p', 'vault')).length, 0);
      t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 301000 });
      c = await service.call(data.principal, 'p', 'reconcileConnection', { connectionId: c.id, expectedRevision: c.revision, requestKey: 'recover-original' });
      assert.equal(c.phase, 'needs_reauthorization');
    } else if (mode === 'receipt') {
      assert.equal(callbacks[0].status, 'received');
      c = await service.call(data.principal, 'p', 'reconcileConnection', { connectionId: c.id, expectedRevision: c.revision, requestKey: 'recover-original' });
      assert.equal(c.phase, 'choosing_account'); assert.equal(c.providerAuthorized.status, 'verified');
    } else {
      assert.equal(c.phase, 'verified');
      const replay = await service.call(data.principal, 'p', 'resumeConnection', data.input);
      assert.equal(replay.grantId, c.grantId);
    }
    assert.equal((await store.list('p', 'grant')).length, mode === 'grant' ? 1 : 0);
  } finally {
    child.kill('SIGKILL'); t.mock.timers.reset(); await store?.close(); if (data) rmSync(dirname(data.path), { recursive: true, force: true });
  }
});
