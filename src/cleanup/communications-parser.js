// Clean Up Service Entries' Communicator / Communication Line / Monitoring
// rules - pure logic, no DOM/Ext/chrome dependency, so it can run under
// plain `node --test` (see tests/communications-cleanup.test.js). Applies
// identically under Annual and Semi-Annual (see classify.js's early
// dispatch) - unlike every other supported device type, these three have
// their own fixed Service-field shape rather than "Visual [& Functional],
// Passed/Failed", so they're handled entirely separately from
// device-type-matcher.js/service-parser.js/one-hitter.js. Full rule
// reference: docs/cleanup-rules.md.
import { isBlank, collapseWhitespace, normalizeDeviceTypeKey } from '../shared/text-utils.js';

// Bucket values below are literal strings matching classify.js's exported
// Bucket enum (not imported, to avoid a circular import between this file
// and classify.js - classify.js imports classifyCommsRecord from here).
// Keep them in sync if classify.js's Bucket values ever change.
const SAFE_CHANGE = 'safeChange';
const ALREADY_CORRECT = 'alreadyCorrect';
const BLANK = 'blank';
const NEEDS_REVIEW = 'needsReview';

const COMMUNICATOR_KEY = normalizeDeviceTypeKey('Communicator');
const COMMUNICATION_LINE_KEY = normalizeDeviceTypeKey('Communication Line');
const MONITORING_KEY = normalizeDeviceTypeKey('Monitoring');

export function isCommunicator(deviceType) {
  return normalizeDeviceTypeKey(deviceType) === COMMUNICATOR_KEY;
}
export function isCommunicationLine(deviceType) {
  return normalizeDeviceTypeKey(deviceType) === COMMUNICATION_LINE_KEY;
}
export function isMonitoring(deviceType) {
  return normalizeDeviceTypeKey(deviceType) === MONITORING_KEY;
}

// Confirmed live (a real report, 2026-08-06, no customer/report
// identifiers recorded here): "Restored @ 11:29 AM 5/1/25", "Yes, 11:02
// AM", "Yes, 6:11 AM". Tolerant of missing/extra spacing and lowercase
// am/pm - never fuzzy about which digits are the time, just where the
// whitespace/case falls. Also tolerates an optional `:SS` seconds group
// (real technician entries have included one, e.g. "15:14:26 pm") so the
// regex captures the whole H:MM:SS run instead of drifting onto the wrong
// H:MM pair when seconds are present - see extractTime below.
const TIME_PATTERN = /(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp]\.?[Mm]\.?)?/;
const NA_LEADING_PATTERN = /^n\/?a\b/i;
const DATE_PATTERN = /\b(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})\b/;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const FAILED_TEST_COMMENT = 'Failed Test';
const SEE_NOTES_SOLUTION = 'See Notes/Recommendations';

function asStr(value) {
  return value == null ? '' : String(value);
}

// Extracts an "H:MM AM/PM" time from anywhere in free text and normalizes
// it: no leading zero on the hour, minutes always 2 digits, uppercase
// AM/PM, single space - matching the confirmed-live examples above.
// Returns null when no plausible time is found (never invented).
//
// Also tolerates a bare 24-hour-clock hour (00, or 13-23) - confirmed live
// a technician entry can read "15:14:26 pm" (24-hour time with a redundant
// trailing am/pm marker and seconds). A 24-hour hour outside 1-12 is
// unambiguous regardless of whether a marker follows it, so it's converted
// straight to 12-hour form; an ordinary 1-12 hour still requires an
// explicit am/pm marker nearby and is never guessed, same as before.
function extractTime(text) {
  if (isBlank(text)) return null;
  const m = TIME_PATTERN.exec(String(text));
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;

  if (hour === 0) return `12:${String(minute).padStart(2, '0')} AM`;
  if (hour >= 13) return `${hour - 12}:${String(minute).padStart(2, '0')} PM`;

  const ampmRaw = m[3];
  if (!ampmRaw) return null;
  const ampm = ampmRaw.toUpperCase().replace(/\./g, '');
  return `${hour}:${String(minute).padStart(2, '0')} ${ampm}`;
}

// Extracts an M/D/Y-ish date from free text and normalizes it to "M/D/YY"
// (no leading zeros, 2-digit year) - matching the confirmed-live
// Communicator example "5/1/25". A 4-digit year is truncated to its last
// two digits for the same canonical shape.
function extractDateFromText(text) {
  if (isBlank(text)) return null;
  const m = DATE_PATTERN.exec(String(text));
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const year = m[3].length === 4 ? m[3].slice(2) : m[3];
  return `${month}/${day}/${year.padStart(2, '0')}`;
}

// Converts the adapter's read-only "YYYY-MM-DD" inspectionDate string (see
// adapter.js's toLocalDateOnlyString) to the same "M/D/YY" canonical shape,
// for the Communicator fallback when Service has a time but no date.
function formatDateFromIso(isoDateStr) {
  if (isBlank(isoDateStr)) return null;
  const m = ISO_DATE_PATTERN.exec(String(isoDateStr));
  if (!m) return null;
  const year = m[1].slice(2);
  const month = Number(m[2]);
  const day = Number(m[3]);
  return `${month}/${day}/${year}`;
}

// Communicator: always "Restored @ <time> <date>". If Service has a time
// but no date, the date is filled in from Inspection Date (never invented
// from nothing) - see docs/cleanup-rules.md. Also mirrors the normalized
// time into the Restore Time device-attribute field (adapter semantic name
// `restoreTime`, real dataIndex 'seconds').
export function classifyCommunicatorRecord(record) {
  const rawService = asStr(record.service);
  const before = rawService;

  if (isBlank(rawService)) {
    return { bucket: BLANK, before, after: null, reason: 'Service field is blank', extraFieldChanges: [] };
  }

  const time = extractTime(rawService);
  if (!time) {
    return {
      bucket: NEEDS_REVIEW,
      before,
      after: null,
      reason: 'No recognizable restore time (H:MM AM/PM) found in Service field',
      extraFieldChanges: [],
    };
  }

  let date = extractDateFromText(rawService);
  let usedFallback = false;
  if (!date) {
    date = formatDateFromIso(record.inspectionDate);
    usedFallback = true;
  }
  if (!date) {
    return {
      bucket: NEEDS_REVIEW,
      before,
      after: null,
      reason: 'No date found in Service field, and Inspection Date is unavailable to fall back to',
      extraFieldChanges: [],
    };
  }

  const canonicalService = `Restored @ ${time} ${date}`;
  const currentRestoreTime = asStr(record.restoreTime).trim();
  const extraFieldChanges = [];
  if (currentRestoreTime !== time) {
    extraFieldChanges.push({ field: 'restoreTime', before: record.restoreTime, after: time });
  }

  if (canonicalService === before && extraFieldChanges.length === 0) {
    return { bucket: ALREADY_CORRECT, before, after: null, reason: 'Already canonical', extraFieldChanges: [] };
  }

  return {
    bucket: SAFE_CHANGE,
    before,
    after: canonicalService,
    reason: usedFallback
      ? 'Normalized restore time/date (date filled in from Inspection Date)'
      : 'Normalized restore time/date',
    extraFieldChanges,
  };
}

// Communication Line: always "Yes, <time>". No device-attribute field
// (confirmed live - #deviceAttrGrid only shows Manufacture Date for this
// device type), so it only ever writes Service.
export function classifyCommunicationLineRecord(record) {
  const rawService = asStr(record.service);
  const before = rawService;

  if (isBlank(rawService)) {
    return { bucket: BLANK, before, after: null, reason: 'Service field is blank', extraFieldChanges: [] };
  }

  const time = extractTime(rawService);
  if (!time) {
    return {
      bucket: NEEDS_REVIEW,
      before,
      after: null,
      reason: 'No recognizable time (H:MM AM/PM) found in Service field',
      extraFieldChanges: [],
    };
  }

  const canonical = `Yes, ${time}`;
  if (canonical === before) {
    return { bucket: ALREADY_CORRECT, before, after: null, reason: 'Already canonical', extraFieldChanges: [] };
  }
  return { bucket: SAFE_CHANGE, before, after: canonical, reason: 'Normalized to "Yes, <time>"', extraFieldChanges: [] };
}

// Monitoring: same baseline as Communication Line ("Yes, <time>"), plus
// three extra rules (see docs/cleanup-rules.md):
//   - Service already "N/A" is a valid passing value as-is - just keep the
//     Confirmed Time attribute field in sync with it.
//   - Passed unchecked WITH an explanatory Note -> Service "N/A", Comment
//     "Failed Test", Solution "See Notes/Recommendations", Confirmed Time
//     "N/A". The Note itself is never touched (it already explains why).
//   - Passed unchecked with NO Note -> can't tell what happened; needsReview.
// A passing "Yes, <time>" record also mirrors <time> into Confirmed Time
// (adapter semantic name `confirmedTime`, real dataIndex 'time') and clears
// any stale Comment/Solution left over from an earlier failure.
export function classifyMonitoringRecord(record) {
  const rawService = asStr(record.service);
  const before = rawService;
  const currentConfirmedTime = asStr(record.confirmedTime).trim();

  if (isBlank(rawService)) {
    return { bucket: BLANK, before, after: null, reason: 'Service field is blank', extraFieldChanges: [] };
  }

  const passed = record.passed === true;
  const hasNote = !isBlank(record.note);

  // Failing takes priority over everything else, including an already-"N/A"
  // Service value - Passed unchecked + an explanatory Note is the
  // authoritative failure signal regardless of what Service currently says.
  if (!passed && hasNote) {
    const extraFieldChanges = [];
    if (currentConfirmedTime.toLowerCase() !== 'n/a') {
      extraFieldChanges.push({ field: 'confirmedTime', before: record.confirmedTime, after: 'N/A' });
    }
    if (asStr(record.comment) !== FAILED_TEST_COMMENT) {
      extraFieldChanges.push({ field: 'comment', before: record.comment, after: FAILED_TEST_COMMENT });
    }
    if (asStr(record.solution) !== SEE_NOTES_SOLUTION) {
      extraFieldChanges.push({ field: 'solution', before: record.solution, after: SEE_NOTES_SOLUTION });
    }
    // Note is deliberately left untouched - it already explains the failure.

    if (before === 'N/A' && extraFieldChanges.length === 0) {
      return { bucket: ALREADY_CORRECT, before, after: null, reason: 'Already correct failing state', extraFieldChanges: [] };
    }
    return {
      bucket: SAFE_CHANGE,
      before,
      after: 'N/A',
      reason: 'Unchecked with an explanatory Note - set to N/A / Failed Test / See Notes/Recommendations',
      extraFieldChanges,
    };
  }

  // Tolerates a leading "N/A"/"NA" followed by free-text explanation - a
  // real-world example was "Na - no available devices". The explanation is
  // discarded; the canonical N/A value never carries a suffix, same as an
  // exact "N/A" always has. `\b` after the pattern means a word like "Name"
  // (which also starts "Na") is correctly NOT treated as N/A.
  const isNA = NA_LEADING_PATTERN.test(collapseWhitespace(rawService));
  if (isNA) {
    const extraFieldChanges = [];
    if (currentConfirmedTime.toLowerCase() !== 'n/a') {
      extraFieldChanges.push({ field: 'confirmedTime', before: record.confirmedTime, after: 'N/A' });
    }
    if (!isBlank(record.comment)) extraFieldChanges.push({ field: 'comment', before: record.comment, after: '' });
    if (!isBlank(record.solution)) extraFieldChanges.push({ field: 'solution', before: record.solution, after: '' });

    if (extraFieldChanges.length === 0) {
      return { bucket: ALREADY_CORRECT, before, after: null, reason: 'Already N/A and consistent', extraFieldChanges: [] };
    }
    return {
      bucket: SAFE_CHANGE,
      before,
      after: 'N/A',
      reason: 'N/A is a valid passing value for Monitoring - syncing Confirmed Time',
      extraFieldChanges,
    };
  }

  if (passed) {
    const time = extractTime(rawService);
    if (!time) {
      return {
        bucket: NEEDS_REVIEW,
        before,
        after: null,
        reason: 'No recognizable time (H:MM AM/PM) found in Service field',
        extraFieldChanges: [],
      };
    }
    const canonicalService = `Yes, ${time}`;
    const extraFieldChanges = [];
    if (currentConfirmedTime !== time) {
      extraFieldChanges.push({ field: 'confirmedTime', before: record.confirmedTime, after: time });
    }
    if (!isBlank(record.comment)) extraFieldChanges.push({ field: 'comment', before: record.comment, after: '' });
    if (!isBlank(record.solution)) extraFieldChanges.push({ field: 'solution', before: record.solution, after: '' });

    if (canonicalService === before && extraFieldChanges.length === 0) {
      return { bucket: ALREADY_CORRECT, before, after: null, reason: 'Already canonical', extraFieldChanges: [] };
    }
    return {
      bucket: SAFE_CHANGE,
      before,
      after: canonicalService,
      reason: 'Normalized to "Yes, <time>" - synced Confirmed Time',
      extraFieldChanges,
    };
  }

  // passed === false, note blank, Service isn't N/A: no rule above covers
  // this combination confidently - never guess.
  return {
    bucket: NEEDS_REVIEW,
    before,
    after: null,
    reason: 'Passed checkbox is unchecked but Note is blank - cannot safely determine outcome',
    extraFieldChanges: [],
  };
}

// Dispatches to the right classifier for Communicator/Communication
// Line/Monitoring, or returns null for every other device type so
// classify.js falls through to the ordinary Visual/Functional pipeline.
export function classifyCommsRecord(record) {
  const deviceType = record.devicetype || '';
  if (isCommunicator(deviceType)) return classifyCommunicatorRecord(record);
  if (isCommunicationLine(deviceType)) return classifyCommunicationLineRecord(record);
  if (isMonitoring(deviceType)) return classifyMonitoringRecord(record);
  return null;
}
