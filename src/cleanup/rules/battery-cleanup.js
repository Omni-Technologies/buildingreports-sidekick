// Battery Cleanup rule - pure logic, no DOM/Ext/chrome dependency so it can
// run under plain `node --test` (see tests/battery-cleanup.test.js).
//
// This is the file to edit when adding a NEW Battery rule (a new field check,
// or a new tolerance on an existing one). See docs/battery-cleanup-rules.md
// for the full rule reference and "how to add the next rule" instructions.
//
// Records passed in here use semantic field names (ratedVoltage, amps,
// preTest, postTest, minAh, testedAh, modelNumber, installDate, passed,
// service, comment, solution, note) - never BuildingReports' internal
// dataIndex names (voltage, pretestvoltage, velocity1door, ...).
// That translation is owned entirely by
// src/site-adapters/buildingreports/adapter.js's BATTERY_FIELD_MAP (or, for
// installDate's Date->string conversion, toLocalDateOnlyString there).

import { isBlank, collapseWhitespace } from '../../shared/text-utils.js';
import { normalizeDeviceTypeKey } from '../../shared/text-utils.js';

export const BatteryBucket = {
  ALREADY_CORRECT: 'alreadyCorrect',
  SAFE_FORMATTING: 'safeFormatting',
  MIN_AH_RECALCULATION: 'minAhRecalculation',
  MODEL_NUMBER_CORRECTION: 'modelNumberCorrection',
  PRE_TEST_CLEARED: 'preTestWillBeCleared',
  MISSING_REQUIRED_VALUE: 'missingRequiredValue',
  INVALID_NUMERIC_VALUE: 'invalidNumericValue',
  SUSPICIOUS_READING: 'suspiciousReading',
  UNSUPPORTED_BATTERY_RECORD: 'unsupportedBatteryRecord',
  UPDATE_OR_SAVE_FAILURE: 'updateOrSaveFailure',
  // Pass/fail outcome buckets - see BatteryOutcome below for the
  // record-level decision these correspond to.
  OUTCOME_PASSED: 'outcomePassed',
  OUTCOME_DATE_EXPIRED: 'outcomeDateExpired',
  OUTCOME_FAILED_LOAD_TEST: 'outcomeFailedLoadTest',
  OUTCOME_DATE_EXPIRED_AND_FAILED_LOAD_TEST: 'outcomeDateExpiredAndFailedLoadTest',
  OUTCOME_REQUIRES_REVIEW: 'outcomeRequiresReview',
};

// The record-level pass/fail decision, distinct from `bucket` (which is a
// single representative label for the field-formatting concerns above).
// See docs/battery-cleanup-rules.md "Pass/Fail outcome" section.
export const BatteryOutcome = {
  PASSED: 'passed',
  DATE_EXPIRED: 'dateExpired',
  FAILED_LOAD_TEST: 'failedLoadTest',
  DATE_EXPIRED_AND_FAILED_LOAD_TEST: 'dateExpiredAndFailedLoadTest',
  REVIEW: 'review',
};

// Device-level bucket is just a single representative label (for compact
// list views); the per-field fieldChanges/reviewFlags below are the source
// of truth for what Preview/Apply actually do. Priority order used to pick
// that one label when a device has several simultaneous issues/changes.
// The outcome-requires-review flag and the four outcome changes take
// priority over the plain attribute-level buckets: whether a Battery
// passed/failed is the most important thing to surface in a compact view.
const REVIEW_PRIORITY = [
  BatteryBucket.OUTCOME_REQUIRES_REVIEW,
  BatteryBucket.MISSING_REQUIRED_VALUE,
  BatteryBucket.INVALID_NUMERIC_VALUE,
  BatteryBucket.SUSPICIOUS_READING,
];
const CHANGE_PRIORITY = [
  BatteryBucket.OUTCOME_DATE_EXPIRED_AND_FAILED_LOAD_TEST,
  BatteryBucket.OUTCOME_DATE_EXPIRED,
  BatteryBucket.OUTCOME_FAILED_LOAD_TEST,
  BatteryBucket.OUTCOME_PASSED,
  BatteryBucket.MODEL_NUMBER_CORRECTION,
  BatteryBucket.MIN_AH_RECALCULATION,
  BatteryBucket.PRE_TEST_CLEARED,
  BatteryBucket.SAFE_FORMATTING,
];

const BATTERY_DEVICE_TYPE_KEY = normalizeDeviceTypeKey('Battery');
const NUMERIC_PATTERN = /^-?\d+(\.\d+)?$/;
const MIN_AH_FACTOR = 0.65;
const EXPIRATION_YEARS = 3;
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const FAILURE_SERVICE = 'Visual & Functional, Failed';
const PASSED_SERVICE = 'Visual & Functional, Passed';
const FAILURE_SOLUTION = 'Replace Battery';
const DATE_EXPIRED_COMMENT = 'Date Expired';
const FAILED_LOAD_TEST_COMMENT = 'Failed Test';
const DATE_EXPIRED_NOTE = 'Date Expired - Replace Battery';
const FAILED_LOAD_TEST_NOTE = 'Failed Load Test - Replace Battery';
const BOTH_FAILED_NOTE = 'Date Expired/Failed Load Test - Replace Battery';

export function isBattery(deviceType) {
  return normalizeDeviceTypeKey(deviceType) === BATTERY_DEVICE_TYPE_KEY;
}

function parseNumericField(raw) {
  if (isBlank(raw)) return { state: 'blank' };
  const trimmed = collapseWhitespace(String(raw));
  if (!NUMERIC_PATTERN.test(trimmed)) return { state: 'invalid' };
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return { state: 'invalid' };
  return { state: 'valid', value, raw: trimmed };
}

// Parses the adapter's "YYYY-MM-DD" local-calendar-date string (see
// adapter.js's toLocalDateOnlyString) using the multi-arg Date constructor
// (year, monthIndex, day), which builds the Date from local wall-clock
// components directly - unlike `new Date("YYYY-MM-DD")`, which parses as
// UTC midnight per the ISO 8601 spec and can shift a day near local
// midnight. This is the "parse it reliably without timezone errors" path.
function parseDateOnly(raw) {
  if (isBlank(raw)) return { state: 'blank' };
  const trimmed = collapseWhitespace(String(raw));
  const m = DATE_ONLY_PATTERN.exec(trimmed);
  if (!m) return { state: 'invalid' };
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const date = new Date(year, month - 1, day);
  // Reject impossible calendar dates (e.g. 2023-02-30) that the Date
  // constructor would otherwise silently roll over into March.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return { state: 'invalid' };
  }
  return { state: 'valid', year, month, day };
}

// Date-only calendar comparison: expired when Install Date <= (today
// minus 3 calendar years). Both sides are constructed at local midnight via
// the multi-arg Date constructor so the comparison is unaffected by
// time-of-day or DST - only the calendar date matters.
function isDateExpired(parsedDate, now) {
  const cutoff = new Date(now.getFullYear() - EXPIRATION_YEARS, now.getMonth(), now.getDate());
  const installDate = new Date(parsedDate.year, parsedDate.month - 1, parsedDate.day);
  return installDate.getTime() <= cutoff.getTime();
}

function formatDateDisplay(parsedDate) {
  if (!parsedDate || parsedDate.state !== 'valid') return '';
  const mm = String(parsedDate.month).padStart(2, '0');
  const dd = String(parsedDate.day).padStart(2, '0');
  return `${mm}/${dd}/${parsedDate.year}`;
}

function formatTwoDecimals(value) {
  return value.toFixed(2);
}

// Compares two already-rounded-to-2-decimal numbers as integer hundredths
// to avoid binary floating-point comparison artifacts (e.g. 0.1 + 0.2).
function toHundredths(value) {
  return Math.round(value * 100);
}

// Strips insignificant trailing zeros for Model Number generation (12.00 ->
// "12", 7.50 -> "7.5") while preserving a genuinely meaningful decimal.
function trimTrailingZeros(value) {
  return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function asDisplayString(value) {
  // Booleans (the Passed checkbox) are kept as real booleans rather than
  // stringified: Undo replays a fieldChange's `before` verbatim as the
  // value to write back, and BuildingReports' `passed` dataIndex is a
  // genuinely boolean-typed field - writing back the string "true"/"false"
  // instead of the real boolean would corrupt it on Undo.
  if (typeof value === 'boolean') return value;
  return value == null ? '' : String(value);
}

// Classifies a single device record for Battery Cleanup. `record` must have
// at least: scannumber, devicetype, modelNumber, ratedVoltage, amps,
// preTest, postTest, minAh, testedAh, installDate, passed, service,
// comment, solution, note (semantic names - see file header).
// `now` (a Date) is the reference point for the expiration calculation -
// pass a fixed value in tests, defaults to the current moment.
// `options.forcedFailureOutcome` is used only by the report-level pair rule
// after another Battery in an unambiguous Left/Right pair has proven a
// failure; `pairedWithScannumber` identifies that source in Preview.
//
// Returns { scannumber, devicetype, isBattery, bucket, fieldChanges,
// reviewFlags, outcome, outcomeDetail }. `fieldChanges` are the only changes
// Apply is ever allowed to write; `reviewFlags` are surfaced to the user and
// never auto-applied. `outcome` is one of BatteryOutcome.* (or null for a
// non-battery record).
export function classifyBatteryRecord(record, now = new Date(), options = {}) {
  const devicetype = record.devicetype || '';
  const scannumber = record.scannumber;

  if (!isBattery(devicetype)) {
    return {
      scannumber,
      devicetype,
      isBattery: false,
      bucket: BatteryBucket.UNSUPPORTED_BATTERY_RECORD,
      fieldChanges: [],
      reviewFlags: [],
      outcome: null,
      intrinsicOutcome: null,
      pairedFailure: null,
      outcomeDetail: null,
    };
  }

  const fieldChanges = [];
  const reviewFlags = [];

  function addChange(field, bucket, before, after) {
    fieldChanges.push({ field, bucket, before: asDisplayString(before), after });
  }
  function addFlag(field, bucket, before, reason) {
    reviewFlags.push({ field, bucket, before: asDisplayString(before), reason });
  }

  // --- Rated Voltage: numeric, required, formatted to 2 decimals ---
  const voltageParsed = parseNumericField(record.ratedVoltage);
  let voltageValue = null;
  if (voltageParsed.state === 'blank') {
    addFlag('ratedVoltage', BatteryBucket.MISSING_REQUIRED_VALUE, record.ratedVoltage, 'Rated Voltage is blank');
  } else if (voltageParsed.state === 'invalid' || voltageParsed.value < 0) {
    addFlag('ratedVoltage', BatteryBucket.INVALID_NUMERIC_VALUE, record.ratedVoltage, 'Rated Voltage is not a valid non-negative number');
  } else {
    voltageValue = voltageParsed.value;
    const formatted = formatTwoDecimals(voltageValue);
    if (voltageParsed.raw !== formatted) {
      addChange('ratedVoltage', BatteryBucket.SAFE_FORMATTING, record.ratedVoltage, formatted);
    }
  }

  // --- Amps: numeric, required, formatted to 2 decimals ---
  const ampsParsed = parseNumericField(record.amps);
  let ampsValue = null;
  if (ampsParsed.state === 'blank') {
    addFlag('amps', BatteryBucket.MISSING_REQUIRED_VALUE, record.amps, 'Amps is blank');
  } else if (ampsParsed.state === 'invalid' || ampsParsed.value < 0) {
    addFlag('amps', BatteryBucket.INVALID_NUMERIC_VALUE, record.amps, 'Amps is not a valid non-negative number');
  } else {
    ampsValue = ampsParsed.value;
    const formatted = formatTwoDecimals(ampsValue);
    if (ampsParsed.raw !== formatted) {
      addChange('amps', BatteryBucket.SAFE_FORMATTING, record.amps, formatted);
    }
  }

  // --- Pre Test: must always be blank ---
  if (!isBlank(record.preTest)) {
    addChange('preTest', BatteryBucket.PRE_TEST_CLEARED, record.preTest, '');
  }

  // --- Post Test: preserve reading, format to 2 decimals, flag if invalid/suspicious ---
  const postTestParsed = parseNumericField(record.postTest);
  if (postTestParsed.state === 'invalid') {
    addFlag('postTest', BatteryBucket.INVALID_NUMERIC_VALUE, record.postTest, 'Post Test is not a valid number');
  } else if (postTestParsed.state === 'valid') {
    if (postTestParsed.value < 0) {
      addFlag('postTest', BatteryBucket.SUSPICIOUS_READING, record.postTest, 'Post Test reading is negative');
    } else {
      const formatted = formatTwoDecimals(postTestParsed.value);
      if (postTestParsed.raw !== formatted) {
        addChange('postTest', BatteryBucket.SAFE_FORMATTING, record.postTest, formatted);
      }
    }
  }
  // blank Post Test: left blank, not flagged - not every battery has been
  // load-tested yet, and this is not one of the values required downstream.

  // --- Min Ah: always Amps x 0.65, only computable when Amps is valid ---
  const minAhValue = ampsValue != null ? ampsValue * MIN_AH_FACTOR : null;
  if (minAhValue != null) {
    const expected = formatTwoDecimals(minAhValue);
    const minAhParsed = parseNumericField(record.minAh);
    const current = minAhParsed.state === 'valid' ? minAhParsed.raw : null;
    if (current !== expected) {
      addChange('minAh', BatteryBucket.MIN_AH_RECALCULATION, record.minAh, expected);
    }
  }
  // Amps invalid/blank: Min Ah is left untouched - already flagged via Amps.

  // --- Tested Ah: preserve reading, format to 2 decimals; blank/invalid is flagged, never invented ---
  const testedAhParsed = parseNumericField(record.testedAh);
  if (testedAhParsed.state === 'blank') {
    addFlag('testedAh', BatteryBucket.MISSING_REQUIRED_VALUE, record.testedAh, 'Tested Ah is blank');
  } else if (testedAhParsed.state === 'invalid') {
    addFlag('testedAh', BatteryBucket.INVALID_NUMERIC_VALUE, record.testedAh, 'Tested Ah is not a valid number');
  } else if (testedAhParsed.value < 0) {
    addFlag('testedAh', BatteryBucket.SUSPICIOUS_READING, record.testedAh, 'Tested Ah reading is negative');
  } else {
    const formatted = formatTwoDecimals(testedAhParsed.value);
    if (testedAhParsed.raw !== formatted) {
      addChange('testedAh', BatteryBucket.SAFE_FORMATTING, record.testedAh, formatted);
    }
  }
  // A 0.00 (or any non-negative) Tested Ah is a real, confirmed reading -
  // it is used as-is below for the pass/fail comparison, never exempted.
  const testedAhValue = testedAhParsed.state === 'valid' && testedAhParsed.value >= 0 ? testedAhParsed.value : null;

  // --- Model Number: derived from Rated Voltage + Amps, never trusted as-is ---
  if (voltageValue != null && ampsValue != null) {
    const expected = `${trimTrailingZeros(voltageValue)}V-${trimTrailingZeros(ampsValue)}Ah`;
    const current = record.modelNumber == null ? '' : String(record.modelNumber).trim();
    if (current !== expected) {
      addChange('modelNumber', BatteryBucket.MODEL_NUMBER_CORRECTION, record.modelNumber, expected);
    }
  }
  // Rated Voltage or Amps missing/invalid: Model Number is left untouched -
  // already flagged via whichever of the two is the problem.

  // --- Install Date / expiration: date-only, using the newly parsed value.
  // Expiration is keyed off Install Date, not Inspection Date - a battery's
  // 3-year service life is measured from when it was installed, and
  // Inspection Date is effectively the same for every device in one visit
  // (see docs/battery-cleanup-rules.md). ---
  const dateParsed = parseDateOnly(record.installDate);
  const dateExpiredProven = dateParsed.state === 'valid' && isDateExpired(dateParsed, now);

  // --- Load test: Tested Ah vs the newly CALCULATED Min Ah (never the
  // stale stored value) - both sides must be known numbers to prove a fail. ---
  const loadTestFailedProven = minAhValue != null && testedAhValue != null
    && toHundredths(testedAhValue) < toHundredths(minAhValue);

  // --- Determine Passed / Failed / Review ---
  let intrinsicOutcome;
  if (dateExpiredProven && loadTestFailedProven) {
    intrinsicOutcome = BatteryOutcome.DATE_EXPIRED_AND_FAILED_LOAD_TEST;
  } else if (dateExpiredProven) {
    intrinsicOutcome = BatteryOutcome.DATE_EXPIRED;
  } else if (loadTestFailedProven) {
    intrinsicOutcome = BatteryOutcome.FAILED_LOAD_TEST;
  } else if (dateParsed.state === 'valid' && minAhValue != null && testedAhValue != null) {
    // Neither failure is proven, and every value needed to prove a pass is
    // itself known valid - safe to pass.
    intrinsicOutcome = BatteryOutcome.PASSED;
  } else {
    // No failure proven, but not everything needed to prove a pass is
    // known either - never assume missing data means Passed.
    intrinsicOutcome = BatteryOutcome.REVIEW;
  }

  // Report-level Battery Cleanup may force the otherwise-passing/review
  // half of an unambiguous Left/Right pair to share its counterpart's
  // proven failure. A Battery's own proven failure always remains its
  // source of truth; pairing never replaces one intrinsic failure with
  // another Battery's reason.
  const forcedFailureOutcome = options.forcedFailureOutcome;
  const forcedByPair = !isFailureOutcome(intrinsicOutcome) && isFailureOutcome(forcedFailureOutcome);
  const outcome = forcedByPair ? forcedFailureOutcome : intrinsicOutcome;

  // --- Generate the outcome's Passed/Service/Comment/Solution/Note changes ---
  if (outcome === BatteryOutcome.PASSED) {
    if (record.passed !== true) addChange('passed', BatteryBucket.OUTCOME_PASSED, record.passed, true);
    if (asDisplayString(record.service) !== PASSED_SERVICE) {
      addChange('service', BatteryBucket.OUTCOME_PASSED, record.service, PASSED_SERVICE);
    }
    if (!isBlank(record.comment)) {
      addChange('comment', BatteryBucket.OUTCOME_PASSED, record.comment, '');
    }
    if (!isBlank(record.solution)) {
      addChange('solution', BatteryBucket.OUTCOME_PASSED, record.solution, '');
    }
    // Note is deliberately left untouched on a pass - see
    // docs/battery-cleanup-rules.md "Note preservation".
  } else if (
    outcome === BatteryOutcome.DATE_EXPIRED
    || outcome === BatteryOutcome.FAILED_LOAD_TEST
    || outcome === BatteryOutcome.DATE_EXPIRED_AND_FAILED_LOAD_TEST
  ) {
    const outcomeBucket = {
      [BatteryOutcome.DATE_EXPIRED]: BatteryBucket.OUTCOME_DATE_EXPIRED,
      [BatteryOutcome.FAILED_LOAD_TEST]: BatteryBucket.OUTCOME_FAILED_LOAD_TEST,
      [BatteryOutcome.DATE_EXPIRED_AND_FAILED_LOAD_TEST]: BatteryBucket.OUTCOME_DATE_EXPIRED_AND_FAILED_LOAD_TEST,
    }[outcome];
    // Comment stays exactly "Date Expired" whenever the date failure is
    // present, even alongside a failed load test - date expiration always
    // wins the Comment slot; only the Note differs to record both causes.
    const commentValue = outcome === BatteryOutcome.FAILED_LOAD_TEST ? FAILED_LOAD_TEST_COMMENT : DATE_EXPIRED_COMMENT;
    const noteValue = {
      [BatteryOutcome.DATE_EXPIRED]: DATE_EXPIRED_NOTE,
      [BatteryOutcome.FAILED_LOAD_TEST]: FAILED_LOAD_TEST_NOTE,
      [BatteryOutcome.DATE_EXPIRED_AND_FAILED_LOAD_TEST]: BOTH_FAILED_NOTE,
    }[outcome];

    if (record.passed !== false) addChange('passed', outcomeBucket, record.passed, false);
    if (asDisplayString(record.service) !== FAILURE_SERVICE) {
      addChange('service', outcomeBucket, record.service, FAILURE_SERVICE);
    }
    if (asDisplayString(record.comment) !== commentValue) {
      addChange('comment', outcomeBucket, record.comment, commentValue);
    }
    if (asDisplayString(record.solution) !== FAILURE_SOLUTION) {
      addChange('solution', outcomeBucket, record.solution, FAILURE_SOLUTION);
    }
    if (asDisplayString(record.note) !== noteValue) {
      addChange('note', outcomeBucket, record.note, noteValue);
    }
  } else {
    // REVIEW: never touch Passed/Service/Comment/Solution/Note - only flag.
    const unknown = [];
    if (dateParsed.state !== 'valid') unknown.push('Install Date');
    if (minAhValue == null) unknown.push('Min Ah (Amps is invalid/blank)');
    if (testedAhValue == null) unknown.push('Tested Ah');
    addFlag(
      'outcome',
      BatteryBucket.OUTCOME_REQUIRES_REVIEW,
      '',
      `Cannot determine Pass/Fail - unknown/invalid: ${unknown.join(', ')}`
    );
  }

  const bucket = pickDeviceBucket(fieldChanges, reviewFlags);

  return {
    scannumber,
    devicetype,
    isBattery: true,
    bucket,
    fieldChanges,
    reviewFlags,
    outcome,
    intrinsicOutcome,
    pairedFailure: forcedByPair
      ? { sourceScannumber: options.pairedWithScannumber, outcome: forcedFailureOutcome }
      : null,
    outcomeDetail: {
      installDateDisplay: formatDateDisplay(dateParsed),
      testedAhDisplay: testedAhValue != null ? formatTwoDecimals(testedAhValue) : '',
      minAhDisplay: minAhValue != null ? formatTwoDecimals(minAhValue) : '',
    },
  };
}

export function isFailureOutcome(outcome) {
  return outcome === BatteryOutcome.DATE_EXPIRED
    || outcome === BatteryOutcome.FAILED_LOAD_TEST
    || outcome === BatteryOutcome.DATE_EXPIRED_AND_FAILED_LOAD_TEST;
}

function pickDeviceBucket(fieldChanges, reviewFlags) {
  for (const b of REVIEW_PRIORITY) {
    if (reviewFlags.some((f) => f.bucket === b)) return b;
  }
  for (const b of CHANGE_PRIORITY) {
    if (fieldChanges.some((f) => f.bucket === b)) return b;
  }
  return BatteryBucket.ALREADY_CORRECT;
}
