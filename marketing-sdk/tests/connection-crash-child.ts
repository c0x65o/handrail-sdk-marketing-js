// Synthetic provider only. Parent kills this process at a durable boundary.
import { connectionFixture } from './connection-fixture.js';
const f = await connectionFixture();
const mode = process.argv[2];
const c = mode === 'grant' ? await f.approved() : (await f.authorize(await f.start())).c;
const input = f.change(c);
const stop = async () => {
  process.send!({ path: f.path, principal: f.principal, fixtureKey: f.fixtureKey, policy: f.currentPolicy(), connectionId: c.id, input });
  await new Promise(() => { setInterval(() => {}, 1000); });
};
if (mode === 'exchange') f.custody.retainConnectionCredentials = async () => { await stop(); };
const transaction = f.store.transaction.bind(f.store);
f.store.transaction = async fn => {
  const result = await transaction(fn);
  if (mode === 'receipt' && (await f.store.list<any>('p', 'connectionCallback')).some(x => x.status === 'received')) await stop();

  return result;
};
if (mode === 'grant') {
  const guarded = f.connections.sessionAuthority.withLiveSessions.bind(f.connections.sessionAuthority);
  f.connections.sessionAuthority.withLiveSessions = async (expected, local) => {
    const result = await guarded(expected, local);
    if ((await f.store.list('p', 'grant')).length) await stop();
    return result;
  };
}
if (mode === 'grant') await f.call('resumeConnection', input);
else {
  const raw = await f.store.get<any>('p', 'connection', c.id);
  const cb = await f.store.get<any>('p', 'connectionCallback', raw.callbackId);
  const auth = new URL(f.custody.connectionAuthorizationUrl(cb.sealed));
  const callback = new URL(auth.searchParams.get('redirect_uri')!);
  callback.searchParams.set('state', auth.searchParams.get('state')!); callback.searchParams.set('code', 'SYNTHETIC_CODE');
  await f.completeCallback(callback);
}
throw new Error('Crash boundary was not reached');
