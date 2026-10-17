import dns from "node:dns/promises";
import https from "node:https";
import { isIP } from "node:net";
import { Store, byteDigest, digest, requireThat, DomainError } from "./store.js";

import type {DestinationRedirect, DestinationSnapshot} from '../core/index.js';
export type {DestinationRedirect, DestinationSnapshot} from '../core/index.js';
function publicUrl(value: string) {
  const url = new URL(value);
  requireThat(url.protocol === 'https:' && !url.username && !url.password &&
    (!url.port || url.port === '443'), 'invalid_destination_url', 422);
  return url;
}
function redirectChain(url: string, redirects: DestinationRedirect[]) {
  const origin=publicUrl(url).origin, visited=new Set([url]); let current=url;
  requireThat(Array.isArray(redirects)&&redirects.length<=5,'destination_redirect_limit');
  for(const hop of redirects) {
    requireThat(hop && Object.keys(hop).sort().join(',')==='from,status,to' &&
      hop.from===current && [301,302,303,307,308].includes(hop.status) &&
      publicUrl(hop.to).origin===origin, 'destination_redirect_scope');
    requireThat(!visited.has(hop.to),'destination_redirect_loop');
    visited.add(hop.to);current=hop.to;
  }
}
/** Content identity includes the original URL and, when present, the observed
 * redirect chain. Historical direct snapshots retain their immutable identity. */
export function destinationSnapshot(url: string, bytes: Uint8Array, source: DestinationSnapshot['source'], observedAt: string, redirects: DestinationRedirect[]=[]): DestinationSnapshot {
  const contentDigest=byteDigest(bytes);
  if(redirects.length){
    redirectChain(url,redirects);
    return {version:3,digest:digest(['destination-v3',url,contentDigest,source,redirects]),contentDigest,url,source,observedAt,redirects:structuredClone(redirects)};
  }
  return {version:2,digest:digest(['destination-v2',url,contentDigest,source]),contentDigest,url,source,observedAt};
}
export function destinationContentDigest(snapshot: {version?:number;digest?:string;contentDigest?:string;url:string;source:string;redirects?:DestinationRedirect[]}, expected: string, url: string) {
  requireThat(snapshot.url===url,'destination_snapshot_mismatch');
  if(snapshot.version===3){
    requireThat(Array.isArray(snapshot.redirects)&&snapshot.redirects.length>0,'destination_snapshot_mismatch');
    redirectChain(url,snapshot.redirects!);
    requireThat(snapshot.digest===expected && /^[a-f0-9]{64}$/.test(snapshot.contentDigest??'') &&
      digest(['destination-v3',url,snapshot.contentDigest,snapshot.source,snapshot.redirects])===expected,'destination_snapshot_mismatch');
    return snapshot.contentDigest!;
  }
  requireThat(snapshot.redirects===undefined,'destination_snapshot_mismatch');
  if(snapshot.version===2) {
    requireThat(snapshot.digest===expected && /^[a-f0-9]{64}$/.test(snapshot.contentDigest??'')
      && digest(['destination-v2',url,snapshot.contentDigest,snapshot.source])===expected,'destination_snapshot_mismatch');
    return snapshot.contentDigest!;
  }
  // Read original historical facts without rewriting material or approvals.
  requireThat(snapshot.version===undefined && (!snapshot.digest || snapshot.digest===expected),'destination_snapshot_mismatch');
  return expected;
}
export async function retainDestinationSnapshot(store: Store, project: string, snapshot: DestinationSnapshot, bytes: Uint8Array) {
  requireThat(destinationContentDigest(snapshot,snapshot.digest,snapshot.url)===byteDigest(bytes),'destination_bytes_changed');
  const previous=await store.get<DestinationSnapshot>(project,'destination',snapshot.digest).catch(error=>{
    if(error.code==='not_found')return null;throw error;
  });
  if(previous) {
    requireThat(destinationContentDigest(previous,snapshot.digest,snapshot.url)===snapshot.contentDigest,'destination_snapshot_mismatch');
    return previous;
  }
  await store.db.prepare('INSERT OR IGNORE INTO blobs VALUES(?,?,?)').run(project,snapshot.contentDigest,bytes);
  await store.put(project,'destination',snapshot.digest,snapshot);
  return snapshot;
}

export function publicAddress(address: string): boolean {
  if (isIP(address) === 6)
    return (
      /^[23][0-9a-f]{3}:/i.test(address) &&
      !address.toLowerCase().startsWith("2001:db8:")
    );
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split(".").map(Number) as [
    number,
    number,
    number,
    number,
  ];
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0 || b === 2)) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}
/** Public HTTPS HTML with bounded same-origin redirects. Resolve and pin DNS
 * independently on every hop. Hosts retain onRedirect evidence in the snapshot;
 * credentials, private addresses and cross-origin redirects are never admitted. */
export async function capturePublicDestination(value: string, onRedirect?: (hop: DestinationRedirect)=>void): Promise<Uint8Array> {
  let current=value;
  const redirects:DestinationRedirect[]=[];
  for(;;){
    const url=publicUrl(current);
    const addresses=await dns.lookup(url.hostname,{all:true});
    requireThat(addresses.length>0&&addresses.every(a=>publicAddress(a.address)),'private_destination_denied',403);
    const selected=addresses[0]!;
    const result=await new Promise<Uint8Array|DestinationRedirect>((resolve,reject)=>{
      const req=https.request(url,{
        method:'GET',headers:{accept:'text/html','user-agent':'Handrail-Marketing-Snapshot/1'},
        lookup:((_host:any,options:any,callback:any)=>options.all?callback(null,[selected]):callback(null,selected.address,selected.family)) as any,
      },res=>{
        if([301,302,303,307,308].includes(res.statusCode??0)){
          res.resume();
          if(!res.headers.location){reject(new DomainError('destination_redirect_location_missing',422));return;}
          try{
            const hop={from:current,to:new URL(res.headers.location,url).href,status:res.statusCode as DestinationRedirect['status']};
            redirectChain(value,[...redirects,hop]);resolve(hop);
          }catch(error){reject(error);}return;
        }
        if(res.statusCode!==200||!res.headers['content-type']?.startsWith('text/html')){
          res.resume();reject(new DomainError('destination_requires_html_response',422));return;
        }
        const chunks:Buffer[]=[];let size=0;
        res.on('data',chunk=>{
          size+=chunk.length;
          if(size>2*1024*1024)req.destroy(new DomainError('destination_snapshot_too_large',422));
          else chunks.push(chunk);
        });
        res.on('end',()=>resolve(Buffer.concat(chunks)));res.on('error',reject);
      });
      req.setTimeout(15000,()=>req.destroy(new DomainError('destination_timeout',504)));
      req.on('error',reject);req.end();
    });
    if(result instanceof Uint8Array)return result;
    redirects.push(result);onRedirect?.(structuredClone(result));current=result.to;
  }
}
