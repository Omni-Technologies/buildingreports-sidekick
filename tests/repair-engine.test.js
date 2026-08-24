import test from 'node:test';
import assert from 'node:assert/strict';
import { getRepairRuleKey, scanFailedDevices } from '../src/cleanup/repair-engine.js';
import { makeRecord, makeBatteryRecord } from './fixtures.js';

test('getRepairRuleKey returns "battery" for a Battery device type', () => {
  assert.equal(getRepairRuleKey('Battery'), 'battery');
});

test('getRepairRuleKey is tolerant of case/whitespace, same as every other device-type check', () => {
  assert.equal(getRepairRuleKey('  battery  '), 'battery');
});

test('getRepairRuleKey returns null for a device type with no rule yet', () => {
  assert.equal(getRepairRuleKey('Smoke Detector'), null);
});

test('scanFailedDevices only includes devices where passed is exactly false', () => {
  const records = [
    makeRecord({ scannumber: '1', passed: true }),
    makeRecord({ scannumber: '2', passed: false }),
    makeBatteryRecord({ scannumber: '3', passed: false }),
    makeBatteryRecord({ scannumber: '4', passed: true }),
  ];
  const result = scanFailedDevices(records);
  assert.deepEqual(result.map((r) => r.scannumber), ['2', '3']);
});

test('scanFailedDevices preserves report order (does not reorder or sort)', () => {
  const records = [
    makeBatteryRecord({ scannumber: 'B', passed: false }),
    makeRecord({ scannumber: 'A', passed: false }),
  ];
  const result = scanFailedDevices(records);
  assert.deepEqual(result.map((r) => r.scannumber), ['B', 'A']);
});

test('scanFailedDevices tags each failed device with its ruleKey (or null)', () => {
  const records = [
    makeBatteryRecord({ scannumber: '1', passed: false }),
    makeRecord({ scannumber: '2', devicetype: 'Smoke Detector', passed: false }),
  ];
  const result = scanFailedDevices(records);
  assert.equal(result.find((r) => r.scannumber === '1').ruleKey, 'battery');
  assert.equal(result.find((r) => r.scannumber === '2').ruleKey, null);
});

test('scanFailedDevices carries the full record through for the popup to use', () => {
  const record = makeBatteryRecord({ scannumber: '1', passed: false, amps: '9.00' });
  const result = scanFailedDevices([record]);
  assert.equal(result[0].record.amps, '9.00');
});

test('an empty report produces an empty list, not an error', () => {
  assert.deepEqual(scanFailedDevices([]), []);
});
