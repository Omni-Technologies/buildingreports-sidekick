import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyBatteryRecord, BatteryBucket, BatteryOutcome } from '../src/cleanup/rules/battery-cleanup.js';
import { makeBatteryRecord, makeRecord } from './fixtures.js';

function fieldChange(result, field) {
  return result.fieldChanges.find((c) => c.field === field);
}

function reviewFlag(result, field) {
  return result.reviewFlags.find((f) => f.field === field);
}

// Fixed reference "now" for every expiration test below, so they're
// deterministic regardless of when the suite actually runs.
const NOW = new Date(2026, 6, 24); // July 24, 2026 (month is 0-indexed)

test('an already-correct Battery has no field changes and no review flags', () => {
  const r = classifyBatteryRecord(makeBatteryRecord());
  assert.equal(r.isBattery, true);
  assert.equal(r.bucket, BatteryBucket.ALREADY_CORRECT);
  assert.deepEqual(r.fieldChanges, []);
  assert.deepEqual(r.reviewFlags, []);
});

test('Rated Voltage "12" becomes "12.00"', () => {
  const r = classifyBatteryRecord(makeBatteryRecord({ ratedVoltage: '12' }));
  const c = fieldChange(r, 'ratedVoltage');
  assert.ok(c, 'expected a ratedVoltage change');
  assert.equal(c.after, '12.00');
  assert.equal(c.bucket, BatteryBucket.SAFE_FORMATTING);
});

test('Amps "8.0" becomes "8.00"', () => {
  const r = classifyBatteryRecord(makeBatteryRecord({ amps: '8.0' }));
  const c = fieldChange(r, 'amps');
  assert.ok(c);
  assert.equal(c.after, '8.00');
});

test('Rated Voltage "12.000" also becomes "12.00"', () => {
  const r = classifyBatteryRecord(makeBatteryRecord({ ratedVoltage: '12.000' }));
  assert.equal(fieldChange(r, 'ratedVoltage').after, '12.00');
});

test('Pre Test is always cleared when non-blank', () => {
  const r = classifyBatteryRecord(makeBatteryRecord({ preTest: '13.20' }));
  const c = fieldChange(r, 'preTest');
  assert.ok(c);
  assert.equal(c.after, '');
  assert.equal(c.bucket, BatteryBucket.PRE_TEST_CLEARED);
});

test('Pre Test already blank produces no change', () => {
  const r = classifyBatteryRecord(makeBatteryRecord({ preTest: '' }));
  assert.equal(fieldChange(r, 'preTest'), undefined);
});

test('Post Test "12.7" becomes "12.70"', () => {
  const r = classifyBatteryRecord(makeBatteryRecord({ postTest: '12.7' }));
  const c = fieldChange(r, 'postTest');
  assert.ok(c);
  assert.equal(c.after, '12.70');
});

test('correct Post Test remains unchanged', () => {
  const r = classifyBatteryRecord(makeBatteryRecord({ postTest: '12.70' }));
  assert.equal(fieldChange(r, 'postTest'), undefined);
});

test('Post Test values outside the typical 11-13V range are preserved, not clamped or invented', () => {
  const r = classifyBatteryRecord(makeBatteryRecord({ postTest: '0.00' }));
  assert.equal(fieldChange(r, 'postTest'), undefined);
  assert.equal(reviewFlag(r, 'postTest'), undefined);
});

test('a negative Post Test reading is flagged as suspicious, not rewritten', () => {
  const r = classifyBatteryRecord(makeBatteryRecord({ postTest: '-1.00' }));
  assert.equal(fieldChange(r, 'postTest'), undefined);
  const flag = reviewFlag(r, 'postTest');
  assert.ok(flag);
  assert.equal(flag.bucket, BatteryBucket.SUSPICIOUS_READING);
});

test('a non-numeric Post Test is flagged invalid, not rewritten', () => {
  const r = classifyBatteryRecord(makeBatteryRecord({ postTest: 'n/a' }));
  assert.equal(fieldChange(r, 'postTest'), undefined);
  assert.equal(reviewFlag(r, 'postTest').bucket, BatteryBucket.INVALID_NUMERIC_VALUE);
});

test('Amps "8.00" calculates Min Ah as "5.20"', () => {
  const r = classifyBatteryRecord(makeBatteryRecord({ amps: '8.00', minAh: '5.20' }));
  assert.equal(fieldChange(r, 'minAh'), undefined, 'already correct, no change needed');
});

test('Amps "10.00" calculates Min Ah as "6.50"', () => {
  const r = classifyBatteryRecord(makeBatteryRecord({ amps: '10.00', minAh: '1.00' }));
  const c = fieldChange(r, 'minAh');
  assert.ok(c);
  assert.equal(c.after, '6.50');
});

test('an incorrect Min Ah is corrected to Amps x 0.65', () => {
  const r = classifyBatteryRecord(makeBatteryRecord({ amps: '7.00', minAh: '9.99' }));
  const c = fieldChange(r, 'minAh');
  assert.ok(c);
  assert.equal(c.after, '4.55');
  assert.equal(c.bucket, BatteryBucket.MIN_AH_RECALCULATION);
});

test('a blank Min Ah is filled in when Amps is valid', () => {
  const r = classifyBatteryRecord(makeBatteryRecord({ amps: '7.00', minAh: '' }));
  assert.equal(fieldChange(r, 'minAh').after, '4.55');
});

test('Tested Ah "9.3" becomes "9.30"', () => {
  const r = classifyBatteryRecord(makeBatteryRecord({ testedAh: '9.3' }));
  assert.equal(fieldChange(r, 'testedAh').after, '9.30');
});

test('blank Tested Ah remains blank and is flagged for review, never invented', () => {
  const r = classifyBatteryRecord(makeBatteryRecord({ testedAh: '' }));
  assert.equal(fieldChange(r, 'testedAh'), undefined);
  const flag = reviewFlag(r, 'testedAh');
  assert.ok(flag);
  assert.equal(flag.bucket, BatteryBucket.MISSING_REQUIRED_VALUE);
});

test('invalid Tested Ah is flagged, not invented', () => {
  const r = classifyBatteryRecord(makeBatteryRecord({ testedAh: 'unknown' }));
  assert.equal(fieldChange(r, 'testedAh'), undefined);
  assert.equal(reviewFlag(r, 'testedAh').bucket, BatteryBucket.INVALID_NUMERIC_VALUE);
});

test('Rated Voltage 12.00 and Amps 7.00 produce Model Number 12V-7Ah', () => {
  const r = classifyBatteryRecord(
    makeBatteryRecord({ ratedVoltage: '12.00', amps: '7.00', modelNumber: 'WRONG' })
  );
  assert.equal(fieldChange(r, 'modelNumber').after, '12V-7Ah');
});

test('Rated Voltage 12.00 and Amps 10.00 produce Model Number 12V-10Ah', () => {
  const r = classifyBatteryRecord(
    makeBatteryRecord({ ratedVoltage: '12.00', amps: '10.00', modelNumber: 'WRONG' })
  );
  assert.equal(fieldChange(r, 'modelNumber').after, '12V-10Ah');
});

test('Model Number is derived from actual values, not trusted as-is, even if it looks plausible', () => {
  const r = classifyBatteryRecord(
    makeBatteryRecord({ ratedVoltage: '6.00', amps: '4.00', modelNumber: '12V-7Ah' })
  );
  assert.equal(fieldChange(r, 'modelNumber').after, '6V-4Ah');
});

test('a genuinely fractional capacity keeps its decimal in Model Number', () => {
  const r = classifyBatteryRecord(
    makeBatteryRecord({ ratedVoltage: '12.00', amps: '7.50', minAh: '4.88', modelNumber: 'WRONG' })
  );
  assert.equal(fieldChange(r, 'modelNumber').after, '12V-7.5Ah');
});

test('invalid Rated Voltage prevents Model Number generation', () => {
  const r = classifyBatteryRecord(
    makeBatteryRecord({ ratedVoltage: 'abc', amps: '7.00', modelNumber: 'WRONG' })
  );
  assert.equal(fieldChange(r, 'modelNumber'), undefined);
  assert.equal(reviewFlag(r, 'ratedVoltage').bucket, BatteryBucket.INVALID_NUMERIC_VALUE);
});

test('blank Rated Voltage is flagged as missing and prevents Model Number generation', () => {
  const r = classifyBatteryRecord(makeBatteryRecord({ ratedVoltage: '', modelNumber: 'WRONG' }));
  assert.equal(fieldChange(r, 'modelNumber'), undefined);
  assert.equal(reviewFlag(r, 'ratedVoltage').bucket, BatteryBucket.MISSING_REQUIRED_VALUE);
});

test('invalid Amps prevents Min Ah and Model Number generation', () => {
  const r = classifyBatteryRecord(
    makeBatteryRecord({ ratedVoltage: '12.00', amps: 'bad', modelNumber: 'WRONG', minAh: 'WRONG' })
  );
  assert.equal(fieldChange(r, 'modelNumber'), undefined);
  assert.equal(fieldChange(r, 'minAh'), undefined);
  assert.equal(reviewFlag(r, 'amps').bucket, BatteryBucket.INVALID_NUMERIC_VALUE);
});

test('a record with several simultaneous issues reports each field independently', () => {
  const r = classifyBatteryRecord(
    makeBatteryRecord({ ratedVoltage: '12', amps: '7.0', preTest: '13.10', minAh: 'wrong' })
  );
  assert.ok(fieldChange(r, 'ratedVoltage'));
  assert.ok(fieldChange(r, 'amps'));
  assert.ok(fieldChange(r, 'preTest'));
  assert.ok(fieldChange(r, 'minAh'));
  assert.equal(r.fieldChanges.length, 4);
});

test('a Non-battery device type is left completely untouched', () => {
  const r = classifyBatteryRecord(
    makeBatteryRecord({ devicetype: 'Smoke Detector', ratedVoltage: '12', amps: '7', preTest: '13.0' })
  );
  assert.equal(r.isBattery, false);
  assert.equal(r.bucket, BatteryBucket.UNSUPPORTED_BATTERY_RECORD);
  assert.deepEqual(r.fieldChanges, []);
  assert.deepEqual(r.reviewFlags, []);
});

test('device type matching tolerates case and whitespace but is never fuzzy/substring', () => {
  const tolerant = classifyBatteryRecord(makeBatteryRecord({ devicetype: '  battery  ' }));
  assert.equal(tolerant.isBattery, true);

  const notSubstring = classifyBatteryRecord(makeBatteryRecord({ devicetype: 'Battery Charger' }));
  assert.equal(notSubstring.isBattery, false);
});

test('a Service-cleanup style record (no battery fields at all) is simply not a battery', () => {
  const r = classifyBatteryRecord(makeRecord({ devicetype: 'Battery' }));
  // Battery devicetype but missing/undefined semantic battery fields:
  // everything should be treated as blank/missing and flagged, never crash.
  assert.equal(r.isBattery, true);
  assert.equal(reviewFlag(r, 'ratedVoltage').bucket, BatteryBucket.MISSING_REQUIRED_VALUE);
  assert.equal(reviewFlag(r, 'amps').bucket, BatteryBucket.MISSING_REQUIRED_VALUE);
});

// --- Pass/Fail outcome: expiration date-only calendar logic ---

test('Install Date exactly three calendar years old fails (expired)', () => {
  const r = classifyBatteryRecord(makeBatteryRecord({ installDate: '2023-07-24' }), NOW);
  assert.equal(r.outcome, BatteryOutcome.DATE_EXPIRED);
});

test('Install Date more than three calendar years old fails (expired)', () => {
  const r = classifyBatteryRecord(makeBatteryRecord({ installDate: '2020-01-01' }), NOW);
  assert.equal(r.outcome, BatteryOutcome.DATE_EXPIRED);
});

test('Install Date one day less than three years old does not fail by date', () => {
  const r = classifyBatteryRecord(makeBatteryRecord({ installDate: '2023-07-25' }), NOW);
  assert.notEqual(r.outcome, BatteryOutcome.DATE_EXPIRED);
  assert.notEqual(r.outcome, BatteryOutcome.DATE_EXPIRED_AND_FAILED_LOAD_TEST);
  assert.equal(r.outcome, BatteryOutcome.PASSED);
});

// --- Pass/Fail outcome: load-test comparison against the newly calculated Min Ah ---

test('Tested Ah below Min Ah fails', () => {
  // amps 7.00 -> Min Ah 4.55; Tested Ah 4.00 < 4.55
  const r = classifyBatteryRecord(makeBatteryRecord({ testedAh: '4.00' }), NOW);
  assert.equal(r.outcome, BatteryOutcome.FAILED_LOAD_TEST);
});

test('Tested Ah equal to Min Ah passes', () => {
  const r = classifyBatteryRecord(makeBatteryRecord({ testedAh: '4.55' }), NOW);
  assert.equal(r.outcome, BatteryOutcome.PASSED);
});

test('Tested Ah above Min Ah passes', () => {
  const r = classifyBatteryRecord(makeBatteryRecord({ testedAh: '5.00' }), NOW);
  assert.equal(r.outcome, BatteryOutcome.PASSED);
});

test('a 0.00 Tested Ah fails against a positive Min Ah - no exemption', () => {
  const r = classifyBatteryRecord(makeBatteryRecord({ testedAh: '0.00' }), NOW);
  assert.equal(r.outcome, BatteryOutcome.FAILED_LOAD_TEST);
});

test('failure uses the newly calculated Min Ah, not a stale stored Min Ah value', () => {
  // amps 7.00 -> real Min Ah is 4.55, but the stored minAh field lies and
  // says 1.00. Tested Ah 3.00 is above the stale value but below the real one.
  const r = classifyBatteryRecord(makeBatteryRecord({ minAh: '1.00', testedAh: '3.00' }), NOW);
  assert.equal(r.outcome, BatteryOutcome.FAILED_LOAD_TEST);
  assert.equal(r.outcomeDetail.minAhDisplay, '4.55');
});

// --- Pass/Fail outcome: the three failure outputs ---

test('date expired only: Passed unchecked, Service/Comment/Solution/Note set accordingly', () => {
  const r = classifyBatteryRecord(makeBatteryRecord({ installDate: '2020-01-01' }), NOW);
  assert.equal(r.outcome, BatteryOutcome.DATE_EXPIRED);
  assert.equal(fieldChange(r, 'passed').after, false);
  assert.equal(fieldChange(r, 'service').after, 'Visual & Functional, Failed');
  assert.equal(fieldChange(r, 'comment').after, 'Date Expired');
  assert.equal(fieldChange(r, 'solution').after, 'Replace Battery');
  assert.equal(fieldChange(r, 'note').after, 'Date Expired - Replace Battery');
});

test('failed load test only: Passed unchecked, Service/Comment/Solution/Note set accordingly', () => {
  const r = classifyBatteryRecord(makeBatteryRecord({ testedAh: '1.00' }), NOW);
  assert.equal(r.outcome, BatteryOutcome.FAILED_LOAD_TEST);
  assert.equal(fieldChange(r, 'passed').after, false);
  assert.equal(fieldChange(r, 'service').after, 'Visual & Functional, Failed');
  assert.equal(fieldChange(r, 'comment').after, 'Failed Test');
  assert.equal(fieldChange(r, 'solution').after, 'Replace Battery');
  assert.equal(fieldChange(r, 'note').after, 'Failed Load Test - Replace Battery');
});

test('date expired and failed load test: Comment stays exactly "Date Expired", Note records both', () => {
  const r = classifyBatteryRecord(
    makeBatteryRecord({ installDate: '2020-01-01', testedAh: '1.00' }),
    NOW
  );
  assert.equal(r.outcome, BatteryOutcome.DATE_EXPIRED_AND_FAILED_LOAD_TEST);
  assert.equal(fieldChange(r, 'passed').after, false);
  assert.equal(fieldChange(r, 'service').after, 'Visual & Functional, Failed');
  assert.equal(fieldChange(r, 'comment').after, 'Date Expired');
  assert.equal(fieldChange(r, 'solution').after, 'Replace Battery');
  assert.equal(fieldChange(r, 'note').after, 'Date Expired/Failed Load Test - Replace Battery');
});

// --- Pass/Fail outcome: passing ---

test('a passing battery checks Passed and clears Comment/Solution', () => {
  const r = classifyBatteryRecord(
    makeBatteryRecord({ passed: false, service: 'Visual & Functional, Failed', comment: 'Failed Test', solution: 'Replace Battery' }),
    NOW
  );
  assert.equal(r.outcome, BatteryOutcome.PASSED);
  assert.equal(fieldChange(r, 'passed').after, true);
  assert.equal(fieldChange(r, 'service').after, 'Visual & Functional, Passed');
  assert.equal(fieldChange(r, 'comment').after, '');
  assert.equal(fieldChange(r, 'solution').after, '');
});

test('a passing battery preserves an existing Note untouched, even with replacement history text', () => {
  const existingNote = 'Failed Load Test - Replace Battery\nBattery Replaced By Chris Cobb With Omni Technologies - 8/6/25';
  const r = classifyBatteryRecord(makeBatteryRecord({ note: existingNote }), NOW);
  assert.equal(r.outcome, BatteryOutcome.PASSED);
  assert.equal(fieldChange(r, 'note'), undefined);
});

// --- Pass/Fail outcome: missing/invalid data is deterministic, never assumed Passed ---

test('missing Install Date with a proven failed load test still fails', () => {
  const r = classifyBatteryRecord(makeBatteryRecord({ installDate: '', testedAh: '1.00' }), NOW);
  assert.equal(r.outcome, BatteryOutcome.FAILED_LOAD_TEST);
});

test('invalid Tested Ah with a proven expired date still fails', () => {
  const r = classifyBatteryRecord(
    makeBatteryRecord({ installDate: '2020-01-01', testedAh: 'not-a-number' }),
    NOW
  );
  assert.equal(r.outcome, BatteryOutcome.DATE_EXPIRED);
});

test('missing Install Date with an otherwise-passing load test requires review, not Passed', () => {
  const r = classifyBatteryRecord(makeBatteryRecord({ installDate: '' }), NOW);
  assert.equal(r.outcome, BatteryOutcome.REVIEW);
  assert.equal(fieldChange(r, 'passed'), undefined);
  assert.equal(fieldChange(r, 'service'), undefined);
  const flag = reviewFlag(r, 'outcome');
  assert.ok(flag);
  assert.equal(flag.bucket, BatteryBucket.OUTCOME_REQUIRES_REVIEW);
});

test('missing Tested Ah with a valid, current Install Date requires review, not Passed', () => {
  const r = classifyBatteryRecord(makeBatteryRecord({ testedAh: '' }), NOW);
  assert.equal(r.outcome, BatteryOutcome.REVIEW);
  assert.equal(fieldChange(r, 'passed'), undefined);
  assert.ok(reviewFlag(r, 'outcome'));
});

test('outcome fields are left untouched (not just Passed) when the outcome requires review', () => {
  const r = classifyBatteryRecord(
    makeBatteryRecord({ testedAh: '', comment: 'some existing note', solution: 'some existing solution' }),
    NOW
  );
  assert.equal(r.outcome, BatteryOutcome.REVIEW);
  assert.equal(fieldChange(r, 'comment'), undefined);
  assert.equal(fieldChange(r, 'solution'), undefined);
  assert.equal(fieldChange(r, 'note'), undefined);
});

test('safe attribute formatting still applies even when the outcome requires review', () => {
  const r = classifyBatteryRecord(makeBatteryRecord({ testedAh: '', ratedVoltage: '12' }), NOW);
  assert.equal(r.outcome, BatteryOutcome.REVIEW);
  assert.equal(fieldChange(r, 'ratedVoltage').after, '12.00');
});
