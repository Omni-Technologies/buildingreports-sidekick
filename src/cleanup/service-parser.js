// Parses a Service field value looking for a "Visual [& Functional], Passed/Failed"
// style result, tolerating the capitalization/spacing/punctuation variations
// called out in docs/cleanup-rules.md. Pure logic - no DOM/Ext dependency.

// Tolerates the real-world typo "Visually" (confirmed live on a Strobe
// record: "Visually & Functional, Passed") alongside the correct "Visual" -
// `(?:ly)?` is non-capturing so it doesn't shift the numbered groups below.
const RESULT_PATTERN =
  /^\s*visual(?:ly)?\s*((?:&|and)\s*functional)?\s*[,]?\s*(passed|failed)\b\s*(.*)$/i;

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
// Returns { resultWord: 'Passed'|'Failed', suffix: string, hasFunctional:
// boolean } on match, or null when the value doesn't look like this kind
// of entry at all. `hasFunctional` records whether the raw value actually
// said "& Functional"/"and functional" - used by classify.js's Annual Heat
// Detector rule to tell an already-Visual-only entry (a deliberate
// restorable/non-restorable signal - see docs/cleanup-rules.md) apart from
// one that simply hasn't been normalized yet.
export function parseVisualFunctionalResult(rawValue) {
  const match = RESULT_PATTERN.exec(rawValue);
  if (!match) return null;
  const hasFunctional = !!match[1];
  const resultWord = match[2].charAt(0).toUpperCase() + match[2].slice(1).toLowerCase();
  const rawSuffix = match[3] || '';
  const trimmedSuffix = rawSuffix.replace(/^[\s\-:;,]+/, '').trim();
  const suffix = trimmedSuffix ? capitalizeFirst(trimmedSuffix) : '';
  return { resultWord, suffix, hasFunctional };
}

// Builds the canonical string for a given prefix ("Visual & Functional" or
// "Visual") and a parsed result.
export function buildCanonicalService(prefix, parsed) {
  const base = `${prefix}, ${parsed.resultWord}`;
  return parsed.suffix ? `${base} - ${parsed.suffix}` : base;
}

// Real-world example: a technician enters a bare "Tested" (or, added
// 2026-09-11, "Tested/Cleaned"/"Cleaned/Tested" - a real-world combined
// placeholder covering devices that get wiped down as part of the same
// visit) in Service instead of a real result, relying entirely on the
// Passed checkbox for the actual outcome. Recognized ONLY when Passed is
// checked (`passed === true`) - deliberately not extended to a Failed
// guess, since nothing in the raw text says why it failed (mirrors
// Monitoring's "Passed unchecked with no Note -> needsReview, never
// guessed" convention). Returns a parsed-result-shaped object usable with
// buildCanonicalService, or null.
//
// `hasFunctional` is set to `true` (not a reflection of any real "&
// Functional" text - there isn't any) purely so classify.js's Annual Heat
// Detector Visual-only-preserved check (which requires `hasFunctional ===
// false` to fire) never mistakes this placeholder for that deliberate
// restorable/non-restorable signal - a bare "Tested"/"Tested/Cleaned"
// carries no such signal, so a Heat Detector with this text should get the
// profile's ordinary standard/visualFunctional phrase, not be preserved
// Visual-only.
//
// Tolerates either word order ("Tested/Cleaned" or "Cleaned/Tested") and
// any amount of whitespace around the slash (e.g. "Tested/ Cleaned",
// "Tested / Cleaned") - real-world technician entries observed with both.
// Deliberately does NOT match a bare "Cleaned" alone (no real-world example
// of that shorthand seen yet - only ever paired with "Tested" or standing
// alone as "Tested").
const GENERIC_TESTED_PATTERN =
  /^\s*(?:tested\s*\/\s*cleaned|cleaned\s*\/\s*tested|tested)\s*$/i;
export function parseGenericTestedPlaceholder(rawValue, passed) {
  if (passed !== true) return null;
  if (!GENERIC_TESTED_PATTERN.test(rawValue)) return null;
  return { resultWord: 'Passed', suffix: '', hasFunctional: true };
}
