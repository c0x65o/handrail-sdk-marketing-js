import { randomBytes } from "node:crypto";
import { requireThat } from "./store.js";

/** Existing host CSRF policy, evaluated only after independent authentication.
 * The host still validates these headers on every mutation. Never return cookies
 * or provider credentials. Only bounded custom headers may be supplied. */
export type PrivateMutationHeaders = (request: Request) => Record<string, string> | Promise<Record<string, string>>;
export async function privateMutationHeaders(supply: PrivateMutationHeaders | undefined, request: Request) {
  const values = supply ? await supply(request) : {};
  requireThat(Object.keys(values).length <= 8, "invalid_mutation_headers");
  for (const [name, value] of Object.entries(values)) requireThat(/^x-[a-z0-9-]{1,64}$/i.test(name) && typeof value === "string" && value.length <= 1024 && !/[\u0000-\u001f\u007f]/.test(value), "invalid_mutation_headers");
  return values;
}
export const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

/** Only callback_landing GET may bypass cross-site authentication/origin middleware.
 * private routes retain all host guards, in addition to SDK validation. */
export function classifyConnectionRoute(pathname: string, method: string): "callback_landing" | "private" | null {
  const callback = /^\/api\/marketing\/oauth\/(meta|google|linkedin)\/callback$/.test(pathname) ||
    /^\/api\/oauth\/[^/]+\/(meta|google|linkedin)\/callback$/.test(pathname);
  if (callback) return method === "GET" ? "callback_landing" : "private";
  if (/^\/api\/projects\/[^/]+\/creative\/(openai|xai)(?:\/[a-f0-9]{64})?$/.test(pathname)) return "private";
  return /^\/api\/marketing\/oauth\/(meta|google|linkedin)\/complete$/.test(pathname) ||
    /^\/api\/oauth\/[^/]+\/(meta|google|linkedin)\/complete$/.test(pathname) ||
    /^\/api\/projects\/[^/]+\/connections\/[^/]+\/handoff$/.test(pathname) ? "private" : null;
}
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export function privatePage(title: string, body: string, script = "", status = 200): Response {
  const nonce = randomBytes(24).toString("base64");
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · Marketing</title>
<style nonce="${nonce}">*{box-sizing:border-box}body{margin:0;background:#eef3f4;color:#132d38;font:17px/1.55 system-ui,sans-serif}main{max-width:680px;margin:8vh auto;padding:32px;background:white;border:1px solid #c8d8dd;border-radius:16px}h1{font-size:clamp(1.65rem,5vw,2.2rem);line-height:1.2;overflow-wrap:anywhere}p,li{overflow-wrap:anywhere}a{color:#08616b}button,.action{display:inline-block;font:inherit;padding:12px 18px;border:0;border-radius:8px;background:#075e66;color:white;cursor:pointer;text-decoration:none;max-width:100%;white-space:normal}button:focus-visible,a:focus-visible{outline:3px solid #b54f00;outline-offset:4px}.label{font-size:.8rem;text-transform:uppercase;letter-spacing:.12em;color:#43636d}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}@media(max-width:720px){main{margin:20px 12px;padding:22px}}</style>
${script ? `<script nonce="${nonce}">${script}</script>` : ""}</head><body><main><p class="label">Marketing · Secure continuation</p><h1 tabindex="-1" autofocus>${escapeHtml(title)}</h1>${body}</main></body></html>`, {
    status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store, max-age=0", "pragma": "no-cache", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff",
      "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'` },
  });
}
/** The authorization response exists only in this private page's closure. It is
 * scrubbed before any async operation, never put into DOM/storage/React or logs. */
export function callbackLanding(loginPath: string, returnPath: string): Response {
  const script = `(()=>{'use strict';let raw=location.search;const clean=location.pathname;history.replaceState(null,'',clean);let query=new URLSearchParams(raw.length<=8192?raw:'');raw=null;let payload=null;
try{const fields=[...query.keys()];if(fields.length>6||new Set(fields).size!==fields.length||fields.some(k=>!['state','code','error','error_description','error_uri','scope','authuser','prompt'].includes(k)))throw 0;
const state=query.get('state')||'',code=query.get('code'),error=query.get('error');if(!/^[A-Za-z0-9_-]{43}$/.test(state)||code&&error||code&&code.length>4096||!code&&!error)throw 0;payload={state,code:code||null};}catch{}query=null;
addEventListener('DOMContentLoaded',async()=>{const message=document.getElementById('outcome');if(!payload){message.textContent='This response is no longer available. Check the saved outcome in Connections. If consent did not finish, sign in and restart it.';return;}
let response;try{const endpoint=clean.replace(/callback$/,'complete');const bootstrap=await fetch(endpoint,{credentials:'same-origin',redirect:'error',cache:'no-store'});if(!bootstrap.ok)throw 0;const host=await bootstrap.json();const requestBody=JSON.stringify(payload);payload=null;response=await fetch(endpoint,{method:'POST',credentials:'same-origin',redirect:'error',cache:'no-store',headers:{...host.headers,'content-type':'application/json'},body:requestBody});
const result=await response.json();if(!response.ok)throw 0;if(typeof result.correlator!=='string'||!/^[A-Za-z0-9:_-]{1,160}$/.test(result.correlator))throw 0;
message.textContent='Response recorded. Return to Connections in the original app or tab and check the saved outcome. This page does not confirm account readiness.';
const link=document.getElementById('return');const target=new URL(link.href);target.searchParams.set('correlator',result.correlator);link.href=target.href;
}catch{payload=null;message.textContent='Completion could not be confirmed. Check the saved outcome before retrying. If your browser session ended, sign in independently and restart consent; this page does not retain the response.';}});})();`;
  return privatePage("Check your connection", `<p id="outcome" role="status">Checking the response with your current browser session…</p><p><a id="return" class="action" href="${escapeHtml(returnPath)}">Return to Connections</a></p><p><a href="${escapeHtml(loginPath)}">Sign in to this host</a></p><p>Return links are navigation hints. The original authenticated session must resume setup.</p><noscript>JavaScript is required for private completion. The response cannot be recovered after leaving this page. Return to Connections and restart consent after enabling JavaScript.</noscript>`, script);
}
export function safeLocalPath(path: string) {
  requireThat(/^\/[a-zA-Z0-9/_-]*$/.test(path) && !path.startsWith("//"), "invalid_connection_return_path");
  return path;
}
export async function readPrivateJson(request: Request): Promise<Record<string, unknown>> {
  requireThat(request.headers.get("content-type")?.split(";")[0] === "application/json", "json_required", 415);
  const reader = request.body?.getReader(); let size = 0, body = "";
  requireThat(reader, "invalid_json", 400);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try { for (;;) { const part = await reader.read(); if (part.done) break;
    size += part.value.byteLength; requireThat(size <= 8192, "body_too_large", 413); body += decoder.decode(part.value, { stream: true });
  } body += decoder.decode(); } finally { await reader.cancel(); }
  // JSON.parse accepts duplicate keys. A closed scalar grammar rejects them and
  // nested objects before they can be interpreted as authority.
  const value = JSON.parse(body) as Record<string, unknown>;
  requireThat(value && typeof value === "object" && !Array.isArray(value), "invalid_json", 400);
  const fieldNames = [...body.matchAll(/"((?:[^"\\]|\\.)*)"\s*:/g)].map(m => JSON.parse(`"${m[1]}"`));
  requireThat(new Set(fieldNames).size === fieldNames.length, "duplicate_field", 400);
  return value;
}
