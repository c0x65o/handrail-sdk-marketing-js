import {redactSecretsInValue} from '../secret-redaction.js';

const credentialKey=/(?:auth|password|passwd|secret|token|credential|api[_-]?key|private[_-]?key|signature|^sig$|^key$)/i;
// Each string has a bounded inspection budget. Malformed URL/encoding and
// exhausted budgets fail closed; opaque values without encoding remain intact.
function inspectText(value, env, depth=0, budget={remaining:256 * 1024, nodes:256}) {
  if (depth > 8 || --budget.nodes < 0 || (budget.remaining -= value.length) < 0) return 'limit';
  for (const raw of value.match(/https?:\/\/[^\s<>"'`]+/gi) || []) {
    let url;
    try { url = new URL(raw); } catch { return 'url'; }
    if (url.username || url.password) return 'url';
    const fragment = new URLSearchParams(url.hash.slice(1).replace(/^.*?\?/,''));
    for (const [key, nested] of [...url.searchParams, ...fragment]) {
      if (credentialKey.test(key)) return 'url';
      if (inspectText(key,env,depth+1,budget) || inspectText(nested,env,depth+1,budget)) return 'url';
    }
  }
  if ((env.lifecycle_credentials || []).some(secret=>typeof secret==='string' && secret && value.includes(secret)) || redactSecretsInValue(value,env) !== value) return 'secret';
  if (/%[0-9a-f]{2}/i.test(value)) {
    let decoded;
    try { decoded = decodeURIComponent(value); } catch { return 'malformed'; }
    if (decoded !== value) return inspectText(decoded,env,depth+1,budget);
  } else if (/https?:\/\//i.test(value) && /%(?![0-9a-f]{2})/i.test(value)) return 'malformed';
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

