// Detection evidence contains counts only: no PAN, last four digits, or hashes
// of low-entropy payment data. This is a privacy boundary, not PCI certification.
const PAYMENT_KEYS = new Set(['pan', 'cardnumber', 'creditcard', 'creditcardnumber', 'paymentcardnumber',
  'primaryaccountnumber', 'cardpan', 'cvv', 'cvc', 'cvv2', 'cvc2', 'cardsecuritycode', 'securitycode']);
export const isPaymentDataKey = key => PAYMENT_KEYS.has(String(key).replace(/[^a-z0-9]/gi, '').toLowerCase());

function plausiblePan(value) {
  const digits = value.replace(/[ -]/g, '');
  if (!/^\d{13,19}$/.test(digits) || /^(\d)\1+$/.test(digits)) return false;
  let total = 0, double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (double) { n *= 2; if (n > 9) n -= 9; }
    total += n;
    double = !double;
  }
  return total % 10 === 0;
}

export function redactPaymentData(value) {
  let paymentFields = 0, cardCandidates = 0;
  // Known fields are removed even for malformed/checksum-invalid values.
  let text = String(value ?? '').replace(
    /((?:["']?)(?:card[_ -]?number|credit[_ -]?card(?:[_ -]?number)?|payment[_ -]?card[_ -]?number|primary[_ -]?account[_ -]?number|card[_ -]?pan|pan|cvv2?|cvc2?|card[_ -]?security[_ -]?code|security[_ -]?code)["']?\s*[:=]\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[\d][\d -]*\d|[^\s,;&}\]]+)/gi,
    (match, prefix, raw, offset, original) => {
      // A suffix of an unrelated identifier (e.g. lifespan) is not a field.
      if (offset > 0 && /[a-zA-Z0-9_]/.test(original[offset - 1])) return match;
      if (/^['"]?\[(?:redacted|REDACTED)\]['"]?$/.test(raw)) return match;
      paymentFields++;
      return `${prefix}"[redacted]"`;
    },
  );
  // Common contiguous, four-digit-grouped and Amex display formats. Do not
  // consume whitespace between two independent contiguous PAN candidates.
  // Canonical UUIDs and full SHA-1/SHA-256 digests can contain checksum-valid
  // numeric groups by chance. Preserve complete identities, never arbitrary
  // alphanumeric wrappers around a PAN. Explicit payment fields were removed
  // above; the secret redactor still removes sensitive keys and known secrets.
  const identities = [...text.matchAll(/(?<![a-zA-Z0-9])(?:[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}|[a-f0-9]{64}|[a-f0-9]{40})(?![a-zA-Z0-9])/gi)]
    .map(match => ({start: match.index, end: match.index + match[0].length}));
  let identityIndex = 0;
  text = text.replace(/(?<!\d)(?:\d{13,19}|\d{4}(?:[ -]\d{4}){2,3}[ -]\d{1,4}|\d{4}[ -]\d{6}[ -]\d{5})(?!\d)/g, (candidate, offset) => {
    while (identities[identityIndex]?.end <= offset) identityIndex++;
    const identity = identities[identityIndex];
    if (identity && offset >= identity.start && offset + candidate.length <= identity.end) return candidate;
    if (!plausiblePan(candidate)) return candidate;
    cardCandidates++;
    return '[redacted]';
  });
  return { text, payment_fields: paymentFields, card_candidates: cardCandidates };
}
