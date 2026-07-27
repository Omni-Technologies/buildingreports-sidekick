// Parses a Service field value looking for a "Visual [& Functional], Passed/Failed"
// style result, tolerating the capitalization/spacing/punctuation variations
// called out in docs/cleanup-rules.md. Pure logic - no DOM/Ext dependency.

const RESULT_PATTERN =
  /^\s*visual\s*(?:(?:&|and)\s*functional)?\s*[,]?\s*(passed|failed)\b\s*(.*)$/i;

const HAS_PASSED = /\bpassed\b/i;
const HAS_FAILED = /\bfailed\b/i;

function capitalizeFirst(str) {
  return str.length ? str.charAt(0).toUpperCase() + str.slice(1) : str;
}

// True when the raw value mentions both a Passed and a Failed result
// anywhere - a genuine conflict that must never be auto-normalized.
export function hasConflictingResult(rawValue) {
  return HAS_PASSED.test(rawValue) && HAS_FAILED.test(rawValue);
}

// Attempts to parse a "Visual [& Functional], Passed/Failed <note>" value.
// Returns { resultWord: 'Passed'|'Failed', suffix: string } on match, or
// null when the value doesn't look like this kind of entry at all.
export function parseVisualFunctionalResult(rawValue) {
  const match = RESULT_PATTERN.exec(rawValue);
  if (!match) return null;
  const resultWord = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
  const rawSuffix = match[2] || '';
  const trimmedSuffix = rawSuffix.replace(/^[\s\-:;,]+/, '').trim();
  const suffix = trimmedSuffix ? capitalizeFirst(trimmedSuffix) : '';
  return { resultWord, suffix };
}

// Builds the canonical string for a given prefix ("Visual & Functional" or
// "Visual") and a parsed result.
export function buildCanonicalService(prefix, parsed) {
  const base = `${prefix}, ${parsed.resultWord}`;
  return parsed.suffix ? `${base} - ${parsed.suffix}` : base;
}
