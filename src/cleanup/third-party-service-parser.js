// Clean Up Service Entries' "third-party serviced device" rule - pure
// logic, no DOM/Ext/chrome dependency (see tests/third-party-service-parser.test.js).
// Applies identically under Annual and Semi-Annual (same profile-agnostic
// dispatch pattern as communications-parser.js's classifyCommsRecord -
// classify.js calls this before the ordinary supported-device-type check,
// since these device types are deliberately NOT in either profile's
// supported list). Full rule reference: docs/cleanup-rules.md.
//
// Air Pressure Switch / Tamper Switch / Waterflow Switch / Kitchen Hood are
// serviced by outside companies, not Passed/Failed tested - their Service
// field is normalized to "Svc. By <Company> <M>/<YY>" (e.g. "Svc. By
// Jefferson F&S 7/26"), abbreviating known fire-industry words to fit
// BuildingReports' 31-character Service limit. If the service date is more
// than a year past (using the last day of that service month), Comment/
// Solution/Note are set to flag it for investigation - independent of
// whether the Service text itself needs to change.
import { isBlank, collapseWhitespace, normalizeDeviceTypeKey } from '../shared/text-utils.js';
import { hasConflictingResult } from './service-parser.js';
import { ABBREVIATION_DICTIONARY } from '../config/third-party-service-abbreviations.js';

// Bucket values below are literal strings matching classify.js's exported
// Bucket enum (not imported, to avoid a circular import - see
// communications-parser.js for the same convention).
const SAFE_CHANGE = 'safeChange';
const ALREADY_CORRECT = 'alreadyCorrect';
const BLANK = 'blank';
const AMBIGUOUS_CONFLICT = 'ambiguousConflict';
const CUSTOM_PRESERVED = 'customPreserved';
const UNSUPPORTED_FIELD = 'unsupportedField';
const NEEDS_REVIEW = 'needsReview';

const THIRD_PARTY_SERVICE_DEVICE_TYPES = [
  'Air Pressure Switch',
  'Tamper Switch',
  'Waterflow Switch',
  'Kitchen Hood',
];
const THIRD_PARTY_SERVICE_DEVICE_TYPE_KEYS = new Set(
  THIRD_PARTY_SERVICE_DEVICE_TYPES.map(normalizeDeviceTypeKey)
);

export function isThirdPartyServiceDevice(deviceType) {
  return THIRD_PARTY_SERVICE_DEVICE_TYPE_KEYS.has(normalizeDeviceTypeKey(deviceType));
}

// Same free-text preserve phrases as annual.js's PRESERVE_PHRASES -
// duplicated rather than imported so this module stays independent of any
// one profile file, same as communications-parser.js.
const PRESERVE_PHRASES = [
  'Not Tested',
  'Unable To Test',
  'Tested By Others',
  'No Access',
  'See On-Site Service Records',
];

const SERVICE_LENGTH_LIMIT = 31;
const EXPIRED_COMMENT = 'Date Expired';
const EXPIRED_SOLUTION = 'Investigate';
const EXPIRED_NOTE = 'Customer To Investigate Maintenance On Device';

// Tolerant of an already-present "Svc. By"/"Svc By"/"Serviced By"/"Service
// By" prefix (case-insensitive, optional period) - stripped before
// re-parsing the company/date, then always rebuilt with the canonical
// "Svc. By " prefix.
const EXISTING_PREFIX_PATTERN = /^\s*(?:svc\.?|serviced|service)\s*by\s+/i;

// Requires the trailing token (after the last whitespace) to be exactly
// "M/YY" or "M/YYYY" - deliberately narrow (matches only the shape
// confirmed in real examples like "4/26", "7/26"), never a day-included
// date. Anything else falls through to unsupportedField rather than being
// guessed at.
const TRAILING_DATE_PATTERN = /^(.*\S)\s+(\d{1,2})\/(\d{2}|\d{4})$/;

function asStr(value) {
  return value == null ? '' : String(value);
}

function matchesPreservePhrase(value) {
  const normalized = collapseWhitespace(value).toLowerCase();
  return PRESERVE_PHRASES.some((phrase) => {
    const p = phrase.toLowerCase();
    return normalized === p || normalized.startsWith(`${p} `) || normalized.startsWith(`${p},`);
  });
}

// Abbreviates a run of consecutive ABBREVIATION_DICTIONARY words (joined
// with "&", "and"/"&" tokens acting as silent connectors), leaving every
// other word (proper/company names) byte-for-byte untouched. See
// docs/cleanup-rules.md for the confirmed examples this produces exactly:
// "Fire and Protection" -> "F&P", "Jefferson Fire And Safety" ->
// "Jefferson F&S", "Hooper" -> "Hooper" (no dictionary words, unchanged).
function abbreviateCompany(company) {
  const tokens = company.split(/\s+/).filter(Boolean);
  const outputParts = [];
  let pendingGroup = [];

  function flushGroup() {
    if (pendingGroup.length > 0) {
      outputParts.push(pendingGroup.join('&'));
      pendingGroup = [];
    }
  }

  for (const token of tokens) {
    const bare = token.replace(/[.,]+$/, '');
    const lower = bare.toLowerCase();
    if (lower === 'and' || bare === '&') {
      continue; // silent connector - doesn't flush, doesn't add on its own
    }
    const abbrev = ABBREVIATION_DICTIONARY[lower];
    if (abbrev) {
      pendingGroup.push(abbrev);
    } else {
      flushGroup();
      outputParts.push(bare);
    }
  }
  flushGroup();
  return outputParts.join(' ');
}

// Formats a parsed month/year into the canonical "M/YY" shape (no leading
// zero on the month, always a 2-digit year - a 4-digit year is truncated
// to its last two digits, same convention communications-parser.js uses).
function formatServiceDate(month, yearRaw) {
  const last2 = yearRaw.length === 4 ? yearRaw.slice(2) : yearRaw.padStart(2, '0');
  return `${month}/${last2}`;
}

// Local {y, m, d} integer-tuple helpers - deliberately not Date-object
// time-of-day math, so there's no timezone/DST edge case to worry about at
// all (see docs/battery-cleanup-rules.md for why Battery Cleanup's
// analogous expiration rule is careful about this same class of bug).
function lastDayOfMonth(year, month1based) {
  const d = new Date(year, month1based, 0);
  return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
}

function addYears(ymd, years) {
  return { y: ymd.y + years, m: ymd.m, d: ymd.d };
}

function compareYmd(a, b) {
  if (a.y !== b.y) return a.y < b.y ? -1 : 1;
  if (a.m !== b.m) return a.m < b.m ? -1 : 1;
  if (a.d !== b.d) return a.d < b.d ? -1 : 1;
  return 0;
}

function parseIsoDateOnly(isoStr) {
  if (isBlank(isoStr)) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoStr));
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

// Expired when Inspection Date is strictly after one year past the LAST
// DAY of the service month (e.g. "4/26" -> April 30, 2026 -> expired only
// once Inspection Date > April 30, 2027 - exactly one year later is not
// yet expired, matching "more than a year" literally).
function isExpired(serviceMonth, serviceYearFull, inspectionDateIso) {
  const inspectionYmd = parseIsoDateOnly(inspectionDateIso);
  if (!inspectionYmd) return false;
  const cutoff = addYears(lastDayOfMonth(serviceYearFull, serviceMonth), 1);
  return compareYmd(inspectionYmd, cutoff) > 0;
}

// Computes the expiration side-effect fields independent of whether the
// Service text itself needs to change (mirrors classifyMonitoringRecord's
// Confirmed Time sync in communications-parser.js). Deliberately
// conservative: only ever WRITES Comment/Solution/Note when a fresh
// expiration is detected - never auto-clears them otherwise, since these
// fields could hold unrelated pre-existing notes on a device type this
// extension has never touched before.
function computeExpirationFieldChanges(record, serviceMonth, serviceYearFull) {
  const changes = [];
  if (!isExpired(serviceMonth, serviceYearFull, record.inspectionDate)) return changes;
  if (asStr(record.comment) !== EXPIRED_COMMENT) {
    changes.push({ field: 'comment', before: record.comment, after: EXPIRED_COMMENT });
  }
  if (asStr(record.solution) !== EXPIRED_SOLUTION) {
    changes.push({ field: 'solution', before: record.solution, after: EXPIRED_SOLUTION });
  }
  if (asStr(record.note) !== EXPIRED_NOTE) {
    changes.push({ field: 'note', before: record.note, after: EXPIRED_NOTE });
  }
  return changes;
}

export function classifyThirdPartyServiceRecord(record) {
  const deviceType = record.devicetype || '';
  if (!isThirdPartyServiceDevice(deviceType)) return null;

  const rawService = asStr(record.service);
  const before = rawService;

  if (isBlank(rawService)) {
    return { bucket: BLANK, before, after: null, reason: 'Service field is blank', extraFieldChanges: [], suggestedFix: null };
  }

  if (hasConflictingResult(rawService)) {
    return {
      bucket: AMBIGUOUS_CONFLICT,
      before,
      after: null,
      reason: 'Contains both Passed and Failed',
      extraFieldChanges: [],
      suggestedFix: null,
    };
  }

  const withoutPrefix = collapseWhitespace(rawService.replace(EXISTING_PREFIX_PATTERN, '')).trim();
  const dateMatch = TRAILING_DATE_PATTERN.exec(withoutPrefix);
  const month = dateMatch ? Number(dateMatch[2]) : null;
  const monthValid = month != null && month >= 1 && month <= 12;
  const company = dateMatch ? dateMatch[1].trim() : '';

  if (!dateMatch || !monthValid || company.length === 0) {
    if (matchesPreservePhrase(rawService)) {
      return {
        bucket: CUSTOM_PRESERVED,
        before,
        after: null,
        reason: 'Recognized preserve phrase',
        extraFieldChanges: [],
        suggestedFix: null,
      };
    }
    return {
      bucket: UNSUPPORTED_FIELD,
      before,
      after: null,
      reason: 'No recognizable "<Company> <M>/<YY>" service date found',
      extraFieldChanges: [],
      suggestedFix: null,
    };
  }

  const yearRaw = dateMatch[3];
  const yearFull = 2000 + Number(yearRaw.length === 4 ? yearRaw.slice(2) : yearRaw);
  const dateStr = formatServiceDate(month, yearRaw);
  const abbreviated = abbreviateCompany(company);
  const candidate = `Svc. By ${abbreviated} ${dateStr}`;

  const extraFieldChanges = computeExpirationFieldChanges(record, month, yearFull);

  if (candidate.length > SERVICE_LENGTH_LIMIT) {
    return {
      bucket: NEEDS_REVIEW,
      before,
      after: null,
      reason: `Abbreviated company name still doesn't fit BuildingReports' ${SERVICE_LENGTH_LIMIT}-character Service limit (${candidate.length} chars) - needs a manual shorten`,
      extraFieldChanges,
      suggestedFix: candidate,
    };
  }

  if (candidate === before && extraFieldChanges.length === 0) {
    return { bucket: ALREADY_CORRECT, before, after: null, reason: 'Already canonical', extraFieldChanges: [], suggestedFix: null };
  }

  return {
    bucket: SAFE_CHANGE,
    before,
    after: candidate,
    reason: 'Normalized to "Svc. By <Company> <M>/<YY>"',
    extraFieldChanges,
    suggestedFix: null,
  };
}
