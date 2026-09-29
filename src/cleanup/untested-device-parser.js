// Clean Up Service Entries' "untested device" rule - pure logic, no
// DOM/Ext/chrome dependency (see tests/untested-device-parser.test.js).
// Applies identically under Annual and Semi-Annual to every supported
// device type whose Service field says "Not Tested"/"Barcoded" (or a
// variant): Service -> "Bar Coded", Comment -> "Special Note", Solution ->
// "See Notes/Recommendations", Note -> one of UNTESTED_NOTES picked from
// context, and Passed -> checked (an untested device is never marked
// Failed - the Note carries the reason). Full rule reference:
// docs/cleanup-rules.md.
import { collapseWhitespace, normalizeDeviceTypeKey } from '../shared/text-utils.js';

// Bucket values below are literal strings matching classify.js's exported
// Bucket enum (not imported, to avoid a circular import - see
// communications-parser.js for the same convention).
const SAFE_CHANGE = 'safeChange';
const ALREADY_CORRECT = 'alreadyCorrect';
const NEEDS_REVIEW = 'needsReview';

export const UNTESTED_SERVICE = 'Bar Coded';
export const UNTESTED_COMMENT = 'Special Note';
export const UNTESTED_SOLUTION = 'See Notes/Recommendations';

// Exact text as supplied by the user, every dash a plain hyphen.
export const UNTESTED_NOTES = {
  locate:
    'Unable To Locate Device For Functional Testing - Maintenance To Locate Device So That It Can Be Tested Or Removed From Programing',
  locked: 'Unable To Access - Door Locked',
  occupied: 'Unable To Access - Room Occupied During Inspection',
  rtu: 'Unable To Safely Access Device For Functional Testing - Device Is Inside RTU - Will Need HVAC Technician On-Site',
  elevator: 'Unable To Test Without An Elevator Technician Present',
};
const CANONICAL_NOTE_VALUES = new Set(Object.values(UNTESTED_NOTES));

// "Not Tested"/"Not-Tested"/"Untested"/"Bar Coded"/"Barcoded"/"Bar-Code"
// etc. as the whole Service value or its leading phrase (anything after it,
// e.g. "Not Tested - door locked", is still read as Note context).
const TRIGGER_PATTERN = /^(?:not[\s-]*tested|untested|bar[\s-]*cod(?:e|ed)|barcod(?:e|ed))(?=$|[\s,.:;()\/\-–])/i;

// A Service that also carries a real result word isn't a plain untested
// marker - left to the ordinary parse path rather than discarding the result.
const RESULT_WORD_PATTERN = /\b(?:pass|passed|fail|failed)\b/i;

const ELEVATOR_PATTERN = /\b(?:elevators?|elev|elavators?|hoist\s*way)\b/i;

// Order matters only for reporting; more than one category matching is
// treated as ambiguous and flagged, never guessed.
const NOTE_CATEGORY_PATTERNS = [
  ['locate', /\b(?:locate|located|locating|find|found|missing)\b/i],
  ['locked', /\block(?:ed)?\b/i],
  ['occupied', /\b(?:occupied|occupant|occupants)\b/i],
  ['rtu', /\b(?:rtus?|roof\s*top\s*units?|hvac)\b/i],
];

function asStr(value) {
  return value == null ? '' : String(value);
}

export function isUntestedService(service) {
  const text = collapseWhitespace(asStr(service));
  return TRIGGER_PATTERN.test(text) && !RESULT_WORD_PATTERN.test(text);
}

function hasElevatorContext(record) {
  if (normalizeDeviceTypeKey(record.devicetype) === 'elevator') return true;
  return [record.direction, record.location, record.description, record.areasuite, record.service, record.note, record.comment]
    .some((v) => ELEVATOR_PATTERN.test(asStr(v)));
}

// Picks the Note for an untested device. An already-canonical Note is kept
// as-is (a deliberate earlier choice); otherwise elevator context wins;
// otherwise exactly one keyword category across Service/Note/Comment/
// Solution picks it. Returns { note } or { reason } when it can't decide.
function pickNote(record) {
  const currentNote = collapseWhitespace(asStr(record.note));
  // En/em-dash variants of a canonical Note count as that Note (and get
  // rewritten to the plain-hyphen form).
  const dashNormalizedNote = currentNote.replace(/\s*[–—]\s*/g, ' - ');
  if (CANONICAL_NOTE_VALUES.has(dashNormalizedNote)) return { note: dashNormalizedNote };
  if (hasElevatorContext(record)) return { note: UNTESTED_NOTES.elevator };

  const serviceRemainder = collapseWhitespace(asStr(record.service)).replace(TRIGGER_PATTERN, '');
  const comment = asStr(record.comment) === UNTESTED_COMMENT ? '' : asStr(record.comment);
  const solution = asStr(record.solution) === UNTESTED_SOLUTION ? '' : asStr(record.solution);
  const context = [serviceRemainder, currentNote, comment, solution].join(' ');

  const matched = NOTE_CATEGORY_PATTERNS.filter(([, pattern]) => pattern.test(context)).map(([key]) => key);
  if (matched.length === 1) return { note: UNTESTED_NOTES[matched[0]] };
  if (matched.length > 1) {
    return { reason: `Untested device - Note context matches more than one reason (${matched.join(', ')}); pick the Note manually` };
  }
  return { reason: 'Untested device - no recognizable reason (locate/locked/occupied/RTU/elevator) found for the Note; pick it manually' };
}

// Returns null when the Service field isn't an untested marker, so
// classify.js falls through to its ordinary rules.
export function classifyUntestedDeviceRecord(record) {
  if (!isUntestedService(record.service)) return null;

  const before = asStr(record.service);
  const picked = pickNote(record);
  if (!picked.note) {
    return { bucket: NEEDS_REVIEW, before, after: null, reason: picked.reason, extraFieldChanges: [] };
  }

  const extraFieldChanges = [];
  for (const [field, target] of [
    ['comment', UNTESTED_COMMENT],
    ['solution', UNTESTED_SOLUTION],
    ['note', picked.note],
  ]) {
    if (asStr(record[field]) !== target) {
      extraFieldChanges.push({ field, before: record[field], after: target });
    }
  }

  if (record.passed !== true) {
    extraFieldChanges.push({ field: 'passed', before: record.passed, after: true });
  }

  if (before === UNTESTED_SERVICE && extraFieldChanges.length === 0) {
    return { bucket: ALREADY_CORRECT, before, after: null, reason: 'Already canonical', extraFieldChanges: [] };
  }
  return {
    bucket: SAFE_CHANGE,
    before,
    after: UNTESTED_SERVICE,
    reason: 'Normalized untested device to "Bar Coded"',
    extraFieldChanges,
  };
}
