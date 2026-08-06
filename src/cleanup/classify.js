import { isBlank, collapseWhitespace } from '../shared/text-utils.js';
import { isSupportedDeviceType, isHeatDetector, isVisualFunctionalDeviceType } from './device-type-matcher.js';
import { detectOneHitter } from './one-hitter.js';
import {
  hasConflictingResult,
  parseVisualFunctionalResult,
  buildCanonicalService,
} from './service-parser.js';
import { classifyCommsRecord } from './communications-parser.js';

// Classification buckets. Every record gets exactly one, mirroring the
// Preview summary categories in the spec.
export const Bucket = {
  UNSUPPORTED_DEVICE_TYPE: 'unsupportedDeviceType',
  BLANK: 'blank',
  ALREADY_CORRECT: 'alreadyCorrect',
  AMBIGUOUS_CONFLICT: 'ambiguousConflict',
  SAFE_CHANGE: 'safeChange',
  CUSTOM_PRESERVED: 'customPreserved',
  UNSUPPORTED_FIELD: 'unsupportedField',
  NEEDS_REVIEW: 'needsReview',
};

// Buckets that must never be written by Apply.
export const REVIEW_ONLY_BUCKETS = new Set([
  Bucket.UNSUPPORTED_DEVICE_TYPE,
  Bucket.BLANK,
  Bucket.ALREADY_CORRECT,
  Bucket.AMBIGUOUS_CONFLICT,
  Bucket.CUSTOM_PRESERVED,
  Bucket.UNSUPPORTED_FIELD,
  Bucket.NEEDS_REVIEW,
]);

function matchesPreservePhrase(value, profile) {
  const normalized = collapseWhitespace(value).toLowerCase();
  return profile.preservePhrases.some((phrase) => {
    const p = phrase.toLowerCase();
    return normalized === p || normalized.startsWith(`${p} `) || normalized.startsWith(`${p},`);
  });
}

// Classifies a single device record's Service field for the given profile.
// `record` is a plain object with at least: devicetype, service, description,
// location, direction, comment, note, solution, modelnumber.
//
// Returns { bucket, before, after, reason }. `after` is only set for
// safeChange (the value Apply would write).
export function classifyRecord(record, profile) {
  const deviceType = record.devicetype || '';
  const rawService = record.service || '';
  const before = rawService;

  if (!profile.enabled) {
    return { bucket: Bucket.NEEDS_REVIEW, before, after: null, reason: 'Profile is not configured' };
  }

  // Communicator/Communication Line/Monitoring have their own fixed
  // Service-field shape (not "Visual [& Functional], Passed/Failed") and
  // aren't in either profile's supportedDeviceTypeKeys - handled entirely
  // by communications-parser.js instead, identically under both profiles
  // (it doesn't take `profile` at all). See docs/cleanup-rules.md.
  const commsResult = classifyCommsRecord(record);
  if (commsResult) return commsResult;

  if (!isSupportedDeviceType(deviceType, profile)) {
    return { bucket: Bucket.UNSUPPORTED_DEVICE_TYPE, before, after: null, reason: `Unsupported device type "${deviceType}"` };
  }

  if (isBlank(rawService)) {
    return { bucket: Bucket.BLANK, before, after: null, reason: 'Service field is blank' };
  }

  if (hasConflictingResult(rawService)) {
    return { bucket: Bucket.AMBIGUOUS_CONFLICT, before, after: null, reason: 'Contains both Passed and Failed' };
  }

  const heatDetector = isHeatDetector(deviceType);
  const oneHitterState = heatDetector ? detectOneHitter(record, profile) : 'none';

  if (heatDetector && oneHitterState === 'ambiguous') {
    return {
      bucket: Bucket.NEEDS_REVIEW,
      before,
      after: null,
      reason: 'Possible One Hitter reference found but not clearly confirmed',
    };
  }

  const parsed = parseVisualFunctionalResult(rawService);
  if (parsed) {
    // Prefix precedence: a confirmed Heat Detector One Hitter exception
    // (Annual only - see one-hitter.js) wins first; otherwise a profile
    // that groups device types by prefix (Semi-Annual's Visual & Functional
    // subset) picks per device type; otherwise every supported device type
    // uses the profile's single standardPhrase (Annual's current behavior).
    const prefix =
      heatDetector && oneHitterState === 'confirmed'
        ? profile.oneHitterPhrase
        : isVisualFunctionalDeviceType(deviceType, profile)
          ? profile.visualFunctionalPhrase
          : profile.standardPhrase;
    const canonical = buildCanonicalService(prefix, parsed);
    if (canonical === before) {
      return { bucket: Bucket.ALREADY_CORRECT, before, after: null, reason: 'Already canonical' };
    }
    return { bucket: Bucket.SAFE_CHANGE, before, after: canonical, reason: 'Normalized standard result' };
  }

  if (matchesPreservePhrase(rawService, profile)) {
    return { bucket: Bucket.CUSTOM_PRESERVED, before, after: null, reason: 'Recognized preserve phrase' };
  }

  return { bucket: Bucket.UNSUPPORTED_FIELD, before, after: null, reason: 'Value does not match a supported Service format' };
}
