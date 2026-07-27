import test from 'node:test';
import assert from 'node:assert/strict';
import { runBatteryCleanup } from '../src/cleanup/battery-engine.js';
import { BatteryBucket, BatteryOutcome } from '../src/cleanup/rules/battery-cleanup.js';
import { makeBatteryRecord, makeRecord } from './fixtures.js';

const NOW = new Date(2026, 6, 24); // July 24, 2026 - fixed reference for deterministic expiration tests

function buildMixedReport() {
  return [
    makeBatteryRecord({ scannumber: 'b1' }), // already correct
    makeBatteryRecord({ scannumber: 'b2', ratedVoltage: '12', amps: '7.0', modelNumber: 'WRONG' }), // 3 field changes: voltage, amps, modelNumber (+ minAh unaffected since amps still valid)
    makeBatteryRecord({ scannumber: 'b3', preTest: '13.10' }), // 1 change: preTest cleared
    makeBatteryRecord({ scannumber: 'b4', amps: 'bad' }), // needs review
    makeRecord({ scannumber: 's1', devicetype: 'Smoke Detector' }), // not a battery at all
  ];
}

test('runBatteryCleanup never mutates input records', () => {
  const records = buildMixedReport();
  const snapshot = JSON.parse(JSON.stringify(records));
  runBatteryCleanup(records);
  assert.deepEqual(records, snapshot);
});

test('non-battery devices are excluded from battery totals entirely', () => {
  const records = buildMixedReport();
  const summary = runBatteryCleanup(records);
  assert.equal(summary.totalDevices, 5);
  assert.equal(summary.totalBatteryDevicesFound, 4);
});

test('counts alreadyCorrect, devicesRequiringReview, and per-field change totals', () => {
  const records = buildMixedReport();
  const summary = runBatteryCleanup(records);
  assert.equal(summary.alreadyCorrect, 1); // b1
  assert.equal(summary.devicesRequiringReview, 1); // b4
  assert.equal(summary.counts.preTestCleared, 1); // b3
  assert.equal(summary.counts.ratedVoltageFormattingChanges, 1); // b2
  assert.equal(summary.counts.ampsFormattingChanges, 1); // b2
  assert.equal(summary.counts.modelNumberCorrections, 1); // b2
});

test('a battery with several field changes contributes one changes[] entry with all its fields', () => {
  const records = buildMixedReport();
  const summary = runBatteryCleanup(records);
  const b2Change = summary.changes.find((c) => c.scannumber === 'b2');
  assert.ok(b2Change, 'expected a single combined change entry for b2');
  assert.ok('ratedVoltage' in b2Change.fields);
  assert.ok('amps' in b2Change.fields);
  assert.ok('modelNumber' in b2Change.fields);
  assert.equal(Object.keys(b2Change.fields).length, 3, 'one logical save covering all 3 fields');

  const b3Change = summary.changes.find((c) => c.scannumber === 'b3');
  assert.deepEqual(Object.keys(b3Change.fields), ['preTest']);
});

test('totalDevicesAffected counts devices, totalFieldsAffected counts fields', () => {
  const records = buildMixedReport();
  const summary = runBatteryCleanup(records);
  assert.equal(summary.totalDevicesAffected, 2); // b2 and b3 (b4 is review-only, no safe changes)
  assert.equal(summary.totalFieldsAffected, 4); // 3 (b2) + 1 (b3)
});

test('a device needing review is never included in changes[]', () => {
  const records = buildMixedReport();
  const summary = runBatteryCleanup(records);
  assert.equal(summary.changes.find((c) => c.scannumber === 'b4'), undefined);
  assert.ok(summary.reviewItems.some((r) => r.scannumber === 'b4'));
});

test('running the cleanup twice on its own output is a no-op', () => {
  const records = buildMixedReport();
  const first = runBatteryCleanup(records);

  const applied = records.map((r) => {
    const change = first.changes.find((c) => c.scannumber === r.scannumber);
    return change ? { ...r, ...change.fields } : r;
  });

  const second = runBatteryCleanup(applied);
  assert.equal(second.totalDevicesAffected, 0);
  assert.equal(second.totalFieldsAffected, 0);
});

// --- Pass/Fail outcome aggregation ---

function buildOutcomeReport() {
  return [
    makeBatteryRecord({ scannumber: 'pass1' }), // already-passing baseline
    makeBatteryRecord({ scannumber: 'expired1', inspectionDate: '2020-01-01' }),
    makeBatteryRecord({ scannumber: 'failedload1', testedAh: '1.00' }),
    makeBatteryRecord({ scannumber: 'both1', inspectionDate: '2020-01-01', testedAh: '1.00' }),
    makeBatteryRecord({ scannumber: 'review1', inspectionDate: '' }),
  ];
}

test('Preview counts each outcome bucket independently', () => {
  const summary = runBatteryCleanup(buildOutcomeReport(), NOW);
  assert.equal(summary.passingBatteries, 1);
  assert.equal(summary.dateExpiredCount, 1);
  assert.equal(summary.failedLoadTestCount, 1);
  assert.equal(summary.dateExpiredAndFailedLoadTestCount, 1);
  assert.equal(summary.outcomeRequiresReviewCount, 1);
});

test('Preview never mutates records (no changes made just by computing the summary)', () => {
  const records = buildOutcomeReport();
  const snapshot = JSON.parse(JSON.stringify(records));
  runBatteryCleanup(records, NOW);
  assert.deepEqual(records, snapshot);
});

test('a Battery needing both attribute fixes and an outcome change gets exactly one combined save', () => {
  const records = [
    makeBatteryRecord({ scannumber: 'combo1', ratedVoltage: '12', testedAh: '1.00' }), // formatting + failed load test
  ];
  const summary = runBatteryCleanup(records, NOW);
  assert.equal(summary.changes.length, 1, 'one logical save for this device');
  const change = summary.changes[0];
  assert.ok('ratedVoltage' in change.fields);
  assert.ok('passed' in change.fields);
  assert.ok('service' in change.fields);
  assert.ok('comment' in change.fields);
  assert.ok('solution' in change.fields);
  assert.ok('note' in change.fields);
});

test('Undo data (changes[].before) restores every exact original field, including the boolean Passed checkbox', () => {
  const original = makeBatteryRecord({ scannumber: 'undo1', testedAh: '1.00' }); // will fail load test
  const summary = runBatteryCleanup([original], NOW);
  const change = summary.changes.find((c) => c.scannumber === 'undo1');
  assert.ok(change);

  // Simulate applying, then undoing via `before` (exactly what background.js's
  // handleBatteryUndo does: write `before` back through the same apply path).
  const afterApply = { ...original, ...change.fields };
  const afterUndo = { ...afterApply, ...change.before };

  assert.equal(afterUndo.passed, true, 'passed restored as a real boolean, not the string "true"');
  assert.strictEqual(typeof afterUndo.passed, 'boolean');
  assert.equal(afterUndo.service, original.service);
  assert.equal(afterUndo.comment, original.comment);
  assert.equal(afterUndo.solution, original.solution);
  assert.equal(afterUndo.note, original.note);

  // Re-classifying the restored record should reproduce the exact same
  // outcome/changes as the original - a true round trip.
  const reclassified = runBatteryCleanup([afterUndo], NOW);
  assert.deepEqual(reclassified.changes, summary.changes);
});

test('non-battery devices are never included in changes[] or outcome counts', () => {
  const records = [...buildOutcomeReport(), makeRecord({ scannumber: 'smoke1', devicetype: 'Smoke Detector' })];
  const summary = runBatteryCleanup(records, NOW);
  assert.equal(summary.changes.find((c) => c.scannumber === 'smoke1'), undefined);
  assert.equal(summary.totalBatteryDevicesFound, 5);
});
