import { classifyRecord, Bucket } from './classify.js';

const BUCKET_ORDER = [
  Bucket.SAFE_CHANGE,
  Bucket.ALREADY_CORRECT,
  Bucket.BLANK,
  Bucket.AMBIGUOUS_CONFLICT,
  Bucket.UNSUPPORTED_DEVICE_TYPE,
  Bucket.CUSTOM_PRESERVED,
  Bucket.UNSUPPORTED_FIELD,
  Bucket.NEEDS_REVIEW,
];

// Runs classification over every device record and produces a Preview-style
// summary plus the list of individual results. Never mutates `records`.
export function runCleanup(records, profile) {
  const counts = {};
  for (const b of BUCKET_ORDER) counts[b] = 0;

  const results = records.map((record) => {
    const classification = classifyRecord(record, profile);
    counts[classification.bucket] += 1;
    return {
      scannumber: record.scannumber,
      devicetype: record.devicetype,
      ...classification,
    };
  });

  const safeChanges = results.filter((r) => r.bucket === Bucket.SAFE_CHANGE);
  const passedNormalized = safeChanges.filter((r) => /,\s*Passed\b/.test(r.after)).length;
  const failedNormalized = safeChanges.filter((r) => /,\s*Failed\b/.test(r.after)).length;

  return {
    profileKey: profile.key,
    profileEnabled: profile.enabled,
    totalDevices: records.length,
    totalServiceFieldsFound: records.filter((r) => r.service != null).length,
    counts,
    totalWouldChange: safeChanges.length,
    passedNormalized,
    failedNormalized,
    results,
    safeChanges,
    examples: pickExamples(safeChanges),
  };
}

function pickExamples(safeChanges, limit = 8) {
  // A representative spread rather than just the first N: dedupe by the
  // (before-pattern, resultWord) shape so the popup shows variety.
  const seen = new Set();
  const examples = [];
  for (const change of safeChanges) {
    const shapeKey = `${change.before.toLowerCase().replace(/[a-z]/gi, 'x')}`;
    if (seen.has(shapeKey) && examples.length > 2) continue;
    seen.add(shapeKey);
    examples.push({ scannumber: change.scannumber, before: change.before, after: change.after });
    if (examples.length >= limit) break;
  }
  return examples;
}
