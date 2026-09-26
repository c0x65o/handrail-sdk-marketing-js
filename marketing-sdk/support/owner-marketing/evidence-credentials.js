import {AsyncLocalStorage} from 'node:async_hooks';
import {safeMarketingEvidence} from './evidence-projection.js';

// Only evidence reads collect lifecycle secrets. No history on the client,
// output, process environment, or persistence; concurrent requests are isolated.
const coverage = new AsyncLocalStorage();
export function recordMarketingCredentials(client, ...values) {
  const state = coverage.getStore();
  if (!state || state.client !== client) return;
  for (const value of values) {
    if (typeof value !== 'string' || !value || state.secrets.has(value)) continue;
    if (state.secrets.size >= 256 || state.bytes + value.length > 1024 * 1024) {
      state.exceeded = true;
      continue;
    }
    state.bytes += value.length;
    state.secrets.add(value);
  }
}
export async function withMarketingCredentialCoverage(client, read, redact) {
  const state = {client, secrets: new Set(), bytes: 0, exceeded: false};
  return coverage.run(state, async () => {
    try {
      recordMarketingCredentials(client, client.accessToken, client.refreshToken, client.clientId, client.clientSecret);
      const result = await read();
      if (state.exceeded) throw new Error('Marketing evidence credential coverage limit exceeded');
      return redact(result, {lifecycle_credentials: [...state.secrets]});
    } catch (error) {
      // Rebuild the error: never retain an unsanitized stack, cause or provider
      // property, including when bounded coverage cannot be established.
      const env = {lifecycle_credentials: [...state.secrets]};
      const message = state.exceeded ? 'Marketing evidence credential coverage limit exceeded' : safeMarketingEvidence(String(error?.message || 'Marketing evidence unavailable'),env);
      throw Object.assign(new Error(message), safeMarketingEvidence({code:state.exceeded?'marketing_evidence_credential_coverage_limit':typeof error?.code==='string'?error.code:undefined,statusCode:typeof error?.statusCode==='number'?error.statusCode:502},env));
    } finally {
      state.secrets.clear();
      state.client = null;
    }
  });
}
