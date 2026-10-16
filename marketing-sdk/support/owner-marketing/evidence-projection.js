import {redactSecretsInValue} from '../secret-redaction.js';

const credentialKey=/(?:auth|password|passwd|secret|token|credential|api[_-]?key|private[_-]?key|signature|^sig$|^key$)/i;
const evidenceUrl=/https?:\/\/[^\s<>"'`]+/gi;
// Each string has a bounded inspection budget. Malformed URL/encoding and
// exhausted budgets fail closed; opaque values without encoding remain intact.
function inspectText(value, env, depth=0, budget={remaining:256 * 1024, nodes:256}, kind='text') {
  if (depth > 8 || --budget.nodes < 0 || (budget.remaining -= value.length) < 0) return 'limit';
  if (kind==='credential_key' && credentialKey.test(value)) return 'url';
  // A decoded URL is already a single bounded URL token. Keep it whole even
  // when decoding introduces spaces, so its later query/fragment is inspected.
  for (const raw of kind==='decoded_url'?[value]:value.match(evidenceUrl) || []) {
    // Validate the URL's encoding before URLSearchParams can replace invalid
    // bytes. Literal percentages in surrounding prose are not URL encoding.
    let decodedUrl;
    try {
      if (kind!=='decoded_url') decodeURIComponent(raw);
      decodedUrl=raw.replace(/(?:%[0-9a-f]{2})+/gi,part=>decodeURIComponent(part));
    } catch { return 'malformed'; }
    let url;
    try { url = new URL(raw); } catch { return 'url'; }
    if (url.username || url.password) return 'url';
    const fragment = new URLSearchParams(url.hash.slice(1).replace(/^.*?\?/,''));
    for (const [key, nested] of [...url.searchParams, ...fragment]) {
      if (inspectText(key,env,depth+1,budget,'credential_key') || inspectText(nested,env,depth+1,budget)) return 'url';
    }
    for (const component of [url.hostname,url.pathname]) {
      if (inspectText(component,env,depth+1,budget)) return 'url';
    }
    // Also inspect the whole decoded URL: a configured secret may span URL
    // components. Its derived literal % is allowed only here; nested URLs from
    // query/fragment values still start with strict encoding validation above.
    if (decodedUrl!==raw) {
      const reason=inspectText(decodedUrl,env,depth+1,budget,'decoded_url');
      if (reason) return reason;
    }
  }
  if ((env.lifecycle_credentials || []).some(secret=>typeof secret==='string' && secret && value.includes(secret)) || redactSecretsInValue(value,env) !== value) return 'secret';
  // URL components were inspected above (including recursively encoded query
  // keys/values). Decode encoded runs in the remaining text without treating
  // ordinary "20%" as malformed or decoding a valid URL's %25 a second time.
  const prose=kind==='decoded_url'?'':value.replace(evidenceUrl,'');
  if (/%[0-9a-f]{2}/i.test(prose)) {
    let decoded;
    try { decoded = prose.replace(/(?:%[0-9a-f]{2})+/gi,part=>decodeURIComponent(part)); } catch { return 'malformed'; }
    if (decoded !== prose) return inspectText(decoded,env,depth+1,budget,kind==='credential_key'?kind:'text');
  }
  return null;
}
function safeText(value,env) {
  const reason=inspectText(value,env);
  if (!reason) return value;
  if (reason==='secret') return '[redacted]';
  if (reason==='limit') return '[redacted-inspection-limit]';
  if (reason==='malformed') return '[redacted-malformed-encoding]';
  return '[redacted-url]';
}
export function safeMarketingEvidence(value,env={}) {
  const walk=(item,depth=0)=>{
    if(depth>20)return '[redacted-depth-limit]';
    if(typeof item==='string')return safeText(item,env);
    if(Array.isArray(item))return item.map(v=>walk(v,depth+1));
    if(!item||typeof item!=='object'||item instanceof Date)return item;
    return Object.fromEntries(Object.entries(item).map(([k,v])=>[safeText(k,env),walk(v,depth+1)]));
  };
  return redactSecretsInValue(walk(value),env);
}

