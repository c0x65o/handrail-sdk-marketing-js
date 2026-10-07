// Test-only egress boundary. No DNS lookup or upstream socket is made for a
// denied target. Unlike Playwright routing, the proxy sees every redirect hop.
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { connect } from 'node:net';

export async function loopbackGuard(origin) {
  const allowed = new URL(origin);
  assert.equal(allowed.hostname, '127.0.0.1'); assert.equal(allowed.protocol, 'http:');
  const blocked = [];
  const proxy = createServer((req, res) => {
    let target;
    try { target = new URL(req.url); } catch { res.writeHead(403); return res.end(); }
    if (target.origin !== origin || target.username || target.password) {
      blocked.push(target.origin + target.pathname); res.writeHead(403); return res.end('Blocked by local qualification guard');
    }
    const upstream = request({ hostname: '127.0.0.1', port: allowed.port, path: target.pathname + target.search, method: req.method,
      headers: { ...req.headers, host: allowed.host } }, response => {
      res.writeHead(response.statusCode, response.headers); response.pipe(res);
    });
    upstream.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(upstream);
  });
  proxy.on('connect', (req, socket, head) => {
    // Playwright APIRequestContext tunnels even its HTTP fixture requests.
    // Only this single loopback socket is allowed; no supplied DNS name resolves.
    if (req.url !== allowed.host) { blocked.push('CONNECT ' + req.url); socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    const upstream = connect({ host: '127.0.0.1', port: Number(allowed.port) }, () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) upstream.write(head); socket.pipe(upstream); upstream.pipe(socket);
    });
    upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy()); socket.on('close', () => upstream.destroy());
  });
  proxy.on('upgrade', (req, socket) => { blocked.push('UPGRADE'); socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); });
  const sockets = new Set();
  proxy.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise(r => proxy.listen(0, '127.0.0.1', r));
  return { server: `http://127.0.0.1:${proxy.address().port}`, blocked,
    close: () => new Promise(r => { proxy.close(r); for (const socket of sockets) socket.destroy(); proxy.closeAllConnections(); }) };
}

// All negative-control destinations are local. If the guard regresses, the only
// possible receiver is this disposable sentinel, never a provider or public IP.
export async function qualifyGuard(context, origin, guard) {
  await context.routeWebSocket('**/*', socket => { guard.blocked.push('WEBSOCKET ' + new URL(socket.url()).origin); socket.close(); });
  let hits = 0;
  const sentinel = createServer((_req, res) => { hits++; res.end('UNEXPECTED'); });
  sentinel.on('upgrade', (_req, socket) => { hits++; socket.destroy(); });
  await new Promise(r => sentinel.listen(0, '127.0.0.1', r));
  const target = `http://127.0.0.1:${sentinel.address().port}`;
  const page = await context.newPage();
  try {
    // Context interception supplies a local redirect, but the second hop must
    // be denied by the proxy itself. Do not install the handoff fixture yet.
    await context.route(origin + '/guard-redirect', route => route.fulfill({ status: 303, headers: { location: target + '/redirect' } }));
    await page.goto(origin + '/guard-redirect');
    await page.waitForLoadState('load');
    await page.goto(origin + '/');
    await page.evaluate(async target => {
      const popup = window.open(target + '/popup');
      const img = new Image(); img.src = target + '/image'; document.body.append(img);
      const frame = document.createElement('iframe'); frame.src = target + '/frame'; document.body.append(frame);
      await fetch(target + '/fetch').catch(() => {});
      await fetch(target.replace('http:', 'https:') + '/https').catch(() => {});
      const ws = new WebSocket(target.replace('http:', 'ws:') + '/socket'); ws.onerror = () => {};
      try { await navigator.serviceWorker.register('/guard-worker.js'); } catch { /* blocked by context */ }
      await new Promise(r => setTimeout(r, 500)); popup?.close();
    }, target);
    assert.equal(hits, 0, 'Network isolation failed: forbidden loopback sentinel reached');
    for (const path of ['/redirect', '/popup', '/image', '/frame', '/fetch']) assert.ok(guard.blocked.some(x => x === target + path), `Missing guard proof: ${path}`);
    assert.ok(guard.blocked.some(x => x.startsWith('CONNECT ')), 'HTTPS tunnel must be denied');
    assert.ok(guard.blocked.some(x => x.startsWith('WEBSOCKET ')), 'WebSocket must be denied');
    assert.equal(context.serviceWorkers().length, 0);
    return { result: 'passed', sentinelHits: hits, controls: ['redirect', 'popup', 'image', 'iframe', 'fetch', 'HTTPS CONNECT', 'WebSocket', 'service workers disabled'], blocked: [...guard.blocked] };
  } finally {
    await page.close(); await context.unroute(origin + '/guard-redirect');
    await new Promise(r => { sentinel.close(r); sentinel.closeAllConnections(); });
  }
}
