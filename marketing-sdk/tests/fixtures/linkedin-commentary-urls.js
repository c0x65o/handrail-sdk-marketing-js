import https from 'node:https';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import assert from 'node:assert/strict';

export const shortUrl = 'https://lnkd.in/eYpHTTxj';
export const interstitial = destination => `<html><head><meta name="pageKey" content="d_shortlink_frontend_external_link_redirect_interstitial"></head><body><a data-tracking-control-name="external_url_click" href="${destination.replaceAll('&','&amp;').replaceAll('"','&quot;')}">Continue</a></body></html>`;

// HTTP boundary simulation only. Never sends network requests or supplies auth.
export function mockCommentaryUrls(t, initial = {}) {
  let config = {destination:'https://handrail-daas.com/careers', ...initial};
  const calls = [];
  t.mock.method(https, 'get', (url, options, callback) => {
    const req = new EventEmitter();
    calls.push(url.href);
    assert.equal(options.agent,false);assert.equal(typeof options.lookup,'function');
    assert.equal(options.maxHeaderSize,8192);
    assert.deepEqual(Object.keys(options.headers).sort(),['accept','cache-control','user-agent']);
    queueMicrotask(async () => {
      try {
        await config.onRead?.(url, options);
        if (config.error) {req.emit('error',Object.assign(new Error('simulated network failure'),{code:config.error}));return;}
        if (config.waitForAbort) {options.signal.addEventListener('abort',()=>req.emit('error',new Error('aborted')),{once:true});return;}
        if (url.hostname === 'localhost') {
          options.lookup('localhost',{},error=>req.emit('error',error || new Error('expected private DNS rejection')));return;
        }
        const route = config.routes?.[url.href] || (url.hostname === 'lnkd.in'
          ? config.redirect ? {status:302,location:config.destination} : {body:config.body ?? interstitial(config.destination)}
          : {status:200});
        const res = Readable.from(route.chunks || [Buffer.from(route.body || '')]);
        res.statusCode=route.status || 200;
        res.headers={'content-type':'text/html; charset=utf-8',...route.headers,...(route.location?{location:route.location}:{})};
        callback(res);
      } catch(error) {req.emit('error',error);}
    });
    return req;
  });
  return {calls,set:next=>{config={...config,...next};}};
}
