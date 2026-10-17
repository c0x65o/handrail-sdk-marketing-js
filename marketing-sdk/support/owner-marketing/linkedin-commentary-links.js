import https from 'node:https';
import {BlockList,isIP} from 'node:net';
import {lookup} from 'node:dns/promises';
import {Parser} from 'htmlparser2';
// Keep the existing public-network policy at the socket boundary. This module
// is shared by SDK execution and native reporting; no host image-proxy dependency.
const blocked = new BlockList();
for (const [address,prefix] of [
 ['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],
 ['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],
 ['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],
 ['203.0.113.0',24],['224.0.0.0',3],
]) blocked.addSubnet(address,prefix,'ipv4');
const globalV6=new BlockList();globalV6.addSubnet('2000::',3,'ipv6');
for(const [address,prefix] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]])blocked.addSubnet(address,prefix,'ipv6');
function publicAddress(address){const family=isIP(address);return family===4?!blocked.check(address,'ipv4'):family===6&&globalV6.check(address,'ipv6')&&!blocked.check(address,'ipv6');}
/**
 * @param {(hostname:string,options:{all:true})=>Promise<Array<{address:string,family:number}>>} resolve
 * @returns {(hostname:string,options:{all?:boolean},callback:(error:Error|null,address?:Array<{address:string,family:number}>|string,family?:number)=>void)=>void}
 */
export function createLinkedInCommentaryLookup(resolve=lookup){
 return(hostname,options,callback)=>resolve(hostname,{all:true}).then(records=>{
  if(!records.length||records.some(({address})=>!publicAddress(address)))callback(Object.assign(new Error('private_address'),{code:'private_address'}));
  else if(options.all)callback(null,records);else callback(null,records[0].address,records[0].family);
 },callback);
}

const SHORT_LINK = /^https:\/\/lnkd\.in\/[A-Za-z0-9_-]+$/;
const MAX_BYTES = 32_768;
/** @param {string} code @returns {never} */
const fail = code => { throw Object.assign(new Error(code), {code}); };
function publicUrl(raw) {
  if(typeof raw!=='string'||raw.length>16_384)fail('unsafe_url');
  const url = new URL(raw);
  if(url.username||url.password||url.port)fail('unsafe_url');
  if (url.protocol !== 'https:') fail('https_required');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && !publicAddress(host)) fail('private_address');
  return url;
}

// This is the observed LinkedIn shortlink interstitial contract, not an
// arbitrary page link/canonical URL or executable redirect script.
function interstitialDestination(html) {
  const destinations = [], pageKeys = [];
  let unsafe = false;
  const parser = new Parser({onopentag(name, attrs) {
    if (name === 'base' || (name === 'meta' && attrs['http-equiv']?.toLowerCase() === 'refresh')) unsafe = true;
    if (name === 'meta' && attrs.name === 'pageKey') pageKeys.push(attrs.content);
    if (name === 'a' && attrs['data-tracking-control-name'] === 'external_url_click') destinations.push(attrs.href);
  }}, {decodeEntities: true});
  parser.end(html);
  if (unsafe || pageKeys.length !== 1 || pageKeys[0] !== 'd_shortlink_frontend_external_link_redirect_interstitial'
    || destinations.length !== 1 || !destinations[0]) fail('unresolved_interstitial');
  return destinations[0];
}

function read(url, signal, readBody) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {agent: false, lookup: createLinkedInCommentaryLookup(), signal, maxHeaderSize: 8192,
      headers: {accept: 'text/html', 'user-agent': 'Handrail-LinkVerification/1.0', 'cache-control': 'no-cache'}}, response => {
      const status = response.statusCode;
      const location = response.headers.location;
      if ([301,302,303,307,308].includes(status) && location) {
        resolve({status, location}); response.destroy(); return;
      }
      if (status !== 200) {reject(Object.assign(new Error('http_status'), {code: 'http_status', httpStatus: status})); response.destroy(); return;}
      if (!readBody) {resolve({status}); response.destroy(); return;}
      if (!/^text\/html(?:;|$)/i.test(response.headers['content-type'] || '')
        || Number(response.headers['content-length']) > MAX_BYTES) {
        reject(Object.assign(new Error('response_limit_or_type'), {code: 'response_limit_or_type'})); response.destroy(); return;
      }
      let size = 0; const chunks = [];
      response.on('error', reject);
      response.on('aborted', () => reject(Object.assign(new Error('response_aborted'), {code:'response_aborted'})));
      response.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_BYTES) {reject(Object.assign(new Error('response_limit'), {code: 'response_limit'})); response.destroy();}
        else chunks.push(chunk);
      });
      response.on('end', () => resolve({status, body: Buffer.concat(chunks).toString('utf8')}));
    });
    req.on('error', reject);
  });
}

// No cache: each comparison resolves again, without provider auth, cookies or
// forwarding response headers. One deadline covers DNS, sockets and all hops.
/**
 * @param {string} shortUrl
 * @param {{signal?:AbortSignal,guard?:()=>void|Promise<void>}} options
 * @returns {Promise<{status:'resolved'|'unresolved',final_url?:string,reason?:string,http_status?:number,hops:Array<{url:string,status:number,navigation?:string}>,observed_at:string}>}
 */
export async function resolveLinkedInCommentaryUrl(shortUrl, {signal = AbortSignal.timeout(8000),guard=()=>{}} = {}) {
  const hops = [];
  try {
    if (!SHORT_LINK.test(shortUrl)) fail('unsupported_short_url');
    let url = publicUrl(shortUrl);
    const seen = new Set();
    for (let count = 0; count <= 3; count++) {
      if (seen.has(url.href)) fail('redirect_loop');
      seen.add(url.href);
      const interstitial = ['lnkd.in','www.linkedin.com'].includes(url.hostname);
      await guard();
      const response = await read(url, signal, interstitial);
      await guard();
      hops.push({url: url.href, status: response.status});
      if (response.location) {
        const next = new URL(response.location, url);
        if (!response.location.includes('#')) next.hash = url.hash;
        url = publicUrl(next.href);
      }
      else if (interstitial) {
        url = publicUrl(interstitialDestination(response.body));
        hops.at(-1).navigation = 'linkedin_external_url_click';
      } else return {status: 'resolved', final_url: url.href, hops, observed_at: new Date().toISOString()};
    }
    fail('redirect_limit');
  } catch (error) {
    await guard();
    // Deliberately exclude exception messages: they can contain arbitrary URLs.
    return {status: 'unresolved', reason: signal.aborted ? 'timeout' : error.status === 400 ? 'unsafe_url' : error.code || 'network_error',
      ...(Number.isInteger(error.httpStatus) ? {http_status: error.httpStatus} : {}),
      hops, observed_at: new Date().toISOString()};
  }
}

function urls(text) {
  return [...text.matchAll(/https?:\/\/[^\s<>"\\]+/g)].map(match => {
    let value = match[0].replace(/[.,]+$/, '');
    for (const [open, close] of [['(',')'],['[',']'],['{','}']]) {
      while (value.endsWith(close) && value.split(close).length > value.split(open).length) value = value.slice(0,-1);
    }
    return {value, start: match.index, end: match.index + value.length};
  });
}

/** @param {string} expected @param {string} actual @param {{guard?:()=>void|Promise<void>}} options */
export async function compareLinkedInCommentaryUrls(expected, actual, {guard=()=>{}} = {}) {
  const evidence = [];
  if (expected === actual) return {equivalent: true, url_mismatch: false, evidence};
  const wanted = urls(expected), received = urls(actual);
  const urlMismatch = JSON.stringify(wanted.map(x=>x.value)) !== JSON.stringify(received.map(x=>x.value));
  const result = {equivalent: false, url_mismatch: urlMismatch, evidence};
  if (!urlMismatch || expected.length > 6000 || actual.length > 6000 || !wanted.length
    || wanted.length !== received.length || wanted.length > 8) return result;
  let expanded = '', offset = 0;
  for (let i = 0; i < wanted.length; i++) {
    expanded += actual.slice(offset, received[i].start) + wanted[i].value;
    offset = received[i].end;
    if (wanted[i].value !== received[i].value && !SHORT_LINK.test(received[i].value)) return result;
  }
  expanded += actual.slice(offset);
  // No whitespace, punctuation, compensation or disclosure normalization.
  if (expanded !== expected) return result;
  const signal = AbortSignal.timeout(8000);
  for (let i = 0; i < wanted.length; i++) {
    if (wanted[i].value === received[i].value) continue;
    let target;
    try {target = publicUrl(wanted[i].value).href;} catch {return result;}
    const proof = await resolveLinkedInCommentaryUrl(received[i].value, {signal,guard});
    const equivalent = proof.status === 'resolved' && proof.final_url === target;
    evidence.push({expected_url: wanted[i].value, provider_url: received[i].value, ...proof, equivalent});
    if (!equivalent) return result;
  }
  return {...result, equivalent: true};
}
