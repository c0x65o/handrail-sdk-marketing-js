import { isPaymentDataKey, redactPaymentData } from './payment-data-redaction.js';

const REDACTED = "[redacted]";

const SENSITIVE_PAYLOAD_KEY_RE = /(?:authorization|password|passwd|secret|token|credential|connection[_-]?(?:uri|url|string)|database[_-]?url|private[_-]?key|api[_-]?key|encryption[_-]?key|plaid[_-]?client[_-]?id|passphrase|known[_-]?hosts|host[_-]?key[_-]?fingerprint|vault[_-]?(?:payload|value|json)|credential(?:s)?[_-]?(?:payload|value|json))/i;

const PRIVATE_KEY_PEM_RE = /-----BEGIN ((?:[A-Z0-9]+ )?PRIVATE KEY)-----[\s\S]*?-----END \1-----/g;

const SENSITIVE_TEXT_VALUE_KEY_RE = /((?:"|')?(?:private[_-]?key|privateKey|passphrase|known[_-]?hosts|knownHosts|host[_-]?key[_-]?fingerprint|hostKeyFingerprint|vault[_-]?(?:payload|value|json)|vault(?:Payload|Value|Json)|credential(?:s)?[_-]?(?:payload|value|json)|credential(?:Payload|Value|Json)|credentials(?:Payload|Value|Json))(?:"|')?\s*[:=]\s*)(["'`])(?:\\.|(?!\2)[\s\S])*?\2/gi;

const SENSITIVE_TEXT_BARE_VALUE_KEY_RE = /((?:"|')?(?:passphrase|known[_-]?hosts|knownHosts|host[_-]?key[_-]?fingerprint|hostKeyFingerprint)(?:"|')?\s*[:=]\s*)(?!["'`])[^\s,;}\]"']{4,}/gi;

const GENERIC_SECRET_PATTERNS = [
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\b(?:sk|rk)_(?:test|live)_[A-Za-z0-9_]{16,}\b/g,
  /\bwhsec_[A-Za-z0-9_]{16,}\b/g,
  /\b(?:postgres|postgresql):\/\/[^\s"'`]+/gi,
  /\bmysql:\/\/[^\s"'`]+/gi,
];

const SAFE_CREDENTIAL_KEYS = [
  "host",
  "port",
  "http_port",
  "native_port",
  "database",
  "db",
  "username",
  "admin_username",
  "backup_username",
  "container_name",
  "volume_name",
  "version",
  "tls",
];

const SAFE_PUBLIC_PAYLOAD_KEYS = new Set([
  ...SAFE_CREDENTIAL_KEYS,
  "credentialvaultid",
  "credentialvaultname",
  "credentialvaultentryid",
  "credentialvaultentryname",
  "vaultentryid",
  "vaultentryname",
  "vaultid",
  "vaultname",
  "secretsincluded",
  "automationtoken",
]);

const AUDIT_PROVENANCE_QUOTE_KEYS = new Set([
  "explicitownerauthorizationtext",
  "matchedauthorizationquote",
  "matchedauthorizationtext",
  "matchedownerquote",
  "matchedquote",
  "matchedquotestring",
  "matchedquotetext",
  "ownerauthorizationevidence",
  "ownerauthorizationquote",
  "ownerauthorizationquoteevidence",
  "ownerauthorizationtext",
  "ownerquote",
  "productionintentquote",
]);

function normalizedPayloadKey(key) {
  return String(key || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

export function isAuditProvenanceQuoteKey(key) {
  return AUDIT_PROVENANCE_QUOTE_KEYS.has(normalizedPayloadKey(key));
}

function isSafePublicPayloadKey(key) {
  return SAFE_PUBLIC_PAYLOAD_KEYS.has(normalizedPayloadKey(key));
}

function isSensitivePayloadKey(key) {
  if (isPaymentDataKey(key)) return true;
  if (isSafePublicPayloadKey(key)) return false;
  return SENSITIVE_PAYLOAD_KEY_RE.test(String(key || ""));
}

function isPublicBooleanGate(key, value) {
  return key === "execution_authorization_required" && typeof value === "boolean";
}

const TOKEN_USAGE_COUNTER_KEYS = new Set([
  "inputtokens", "outputtokens", "totaltokens", "cachedinputtokens",
  "cachewriteinputtokens", "reasoningoutputtokens", "cachedtokens",
  "reasoningtokens", "contextwindowtokens", "modelcontextwindow",
]);

function isPublicTokenUsage(key, value) {
  const normalized = normalizedPayloadKey(key);
  if (TOKEN_USAGE_COUNTER_KEYS.has(normalized)) {
    return Number.isSafeInteger(value) && value >= 0;
  }
  // Native tokenUsage notifications are accounting, not credentials. Only
  // accept their closed numeric shape; arbitrary token-named objects and
  // string values must still fail closed.
  if (normalized !== "tokenusage" || !value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.length > 0 && entries.every(([field, raw]) => {
    if (field === "modelContextWindow") return raw === null || isPublicTokenUsage(field, raw);
    if (!["total", "last"].includes(field) || !raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const counters = Object.entries(raw);
    return counters.length > 0 && counters.every(([name, count]) => TOKEN_USAGE_COUNTER_KEYS.has(normalizedPayloadKey(name))
      && isPublicTokenUsage(name, count));
  });
}

function shouldRedactPayloadKey(key) {
  return isSensitivePayloadKey(key) && !isAuditProvenanceQuoteKey(key);
}

function collectExplicitSecrets(context = {}) {
  const secrets = [];
  const addSecret = (raw) => {
    const secret = String(raw || "");
    if (secret.length < 4) return;
    secrets.push(secret);
    const escaped = JSON.stringify(secret).slice(1, -1);
    if (escaped !== secret && escaped.length >= 4) secrets.push(escaped);
  };
  const visit = (value, inheritedSensitive = false) => {
    if (!value || typeof value !== "object") return;
    for (const [key, raw] of Object.entries(value)) {
      if (isPublicBooleanGate(key, raw)) continue;
      // Do not turn public usage numbers into explicit secrets: doing so
      // corrupts unrelated UUIDs, hashes and paths containing those digits.
      if (!inheritedSensitive && isPublicTokenUsage(key, raw)) continue;
      const redactKey = shouldRedactPayloadKey(key);
      const redactValue = (inheritedSensitive || redactKey) && !isSafePublicPayloadKey(key);
      if (raw && typeof raw === "object") {
        visit(raw, redactValue);
        continue;
      }
      if (!redactValue) continue;
      addSecret(raw);
    }
  };
  visit(context);
  return secrets.sort((a, b) => b.length - a.length);
}

function redactSecretsInTextWithExplicitSecrets(text, explicitSecrets) {
  let out = String(text || "");
  for (const secret of explicitSecrets) {
    out = out.split(secret).join(REDACTED);
  }
  out = out.replace(PRIVATE_KEY_PEM_RE, REDACTED);
  out = out.replace(SENSITIVE_TEXT_VALUE_KEY_RE, `$1"${REDACTED}"`);
  out = out.replace(SENSITIVE_TEXT_BARE_VALUE_KEY_RE, `$1${REDACTED}`);
  for (const pattern of GENERIC_SECRET_PATTERNS) {
    out = out.replace(pattern, REDACTED);
  }
  return redactPaymentData(out).text;
}

export function redactSecretsInText(text, context = {}) {
  return redactSecretsInTextWithExplicitSecrets(text, collectExplicitSecrets(context));
}

function parseJsonEnvelope(text) {
  const raw = String(text || "");
  const trimmed = raw.trim();
  if (trimmed) {
    try {
      const value = JSON.parse(trimmed);
      const start = raw.indexOf(trimmed);
      return { start, end: start + trimmed.length, value };
    } catch { /* try a JSON document surrounded by command chatter */ }
  }

  const envelopes = [["{", "}"], ["[", "]"]]
    .map(([opening, closing]) => ({ opening, closing, first: raw.indexOf(opening) }))
    .filter(({ first }) => first >= 0)
    .sort((left, right) => left.first - right.first);
  for (const { opening, closing, first } of envelopes) {
    const end = raw.lastIndexOf(closing);
    if (end < 0) continue;
    let start = first;
    while (start >= 0 && start < end) {
      try {
        return { start, end: end + 1, value: JSON.parse(raw.slice(start, end + 1)) };
      } catch {
        start = raw.indexOf(opening, start + 1);
      }
    }
  }
  return null;
}

// Machine-readable command output must remain valid JSON after redaction.
// Text regexes can consume an escaped closing quote in a connection URL.
// Retain ordinary command chatter around each document, but redact the parsed
// values before serializing. Invalid/truncated documents still fail closed.
export function redactSecretsInJsonOutput(text, delimiter = "") {
  const parts = delimiter ? String(text || "").split(delimiter) : [String(text || "")];
  return parts.map((part) => {
    const envelope = parseJsonEnvelope(part);
    if (!envelope) return redactSecretsInText(part);
    return redactSecretsInText(part.slice(0, envelope.start))
      + JSON.stringify(redactSecretsInValue(envelope.value))
      + redactSecretsInText(part.slice(envelope.end));
  }).join(delimiter);
}

// Redact several related text fields while traversing a potentially large
// structured context only once. Run/event summaries use this to keep explicit
// secret discovery bounded when the same event trace protects prompt, result,
// and error text.
export function redactSecretsInTexts(texts, context = {}) {
  const explicitSecrets = collectExplicitSecrets(context);
  return (Array.isArray(texts) ? texts : []).map((text) => (
    redactSecretsInTextWithExplicitSecrets(text, explicitSecrets)
  ));
}

function redactSecretsInValueWithExplicitSecrets(value, explicitSecrets, depth) {
  if (depth > 20) return `${REDACTED}-depth-limit`;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return redactPaymentData(String(value)).text === String(value) ? value : REDACTED;
  }
  if (typeof value === "string") {
    return redactSecretsInTextWithExplicitSecrets(value, explicitSecrets);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSecretsInValueWithExplicitSecrets(item, explicitSecrets, depth + 1));
  }
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    if (key === "credential_summary" && raw && typeof raw === "object" && !Array.isArray(raw)) {
      out[key] = redactSecretsInValueWithExplicitSecrets(raw, explicitSecrets, depth + 1);
      continue;
    }
    if (isPublicBooleanGate(key, raw) || isPublicTokenUsage(key, raw)) {
      out[key] = raw;
      continue;
    }
    if (shouldRedactPayloadKey(key)) {
      out[key] = REDACTED;
      continue;
    }
    out[key] = redactSecretsInValueWithExplicitSecrets(raw, explicitSecrets, depth + 1);
  }
  return out;
}

export function redactSecretsInValue(value, context = {}, depth = 0) {
  const explicitSecrets = collectExplicitSecrets(context);
  return redactSecretsInValueWithExplicitSecrets(value, explicitSecrets, depth);
}

