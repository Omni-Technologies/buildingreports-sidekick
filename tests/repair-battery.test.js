import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBatteryRepairChange } from '../src/cleanup/repair-battery.js';
import { makeBatteryRecord } from './fixtures.js';

const VALID_INPUT = { amps: '8.00', installDate: '2026-08-24', tech: 'Tech A', company: 'Acme Fire & Safety' };

test('a valid repair input produces the full expected write payload', () => {
  const record = makeBatteryRecord({
    ratedVoltage: '12.00',
    amps: '7.00',
    modelNumber: '12V-7Ah',
    passed: false,
    service: 'Visual & Functional, Failed',
    comment: 'Failed Test',
    solution: 'Replace Battery',
    note: 'Failed Load Test - Replace Battery',
  });
  const r = buildBatteryRepairChange(record, VALID_INPUT);
  assert.equal(r.ok, true);
  assert.deepEqual(r.writeValue, {
    amps: '8.00',
    postTest: '0.00',
    testedAh: '0.00',
    minAh: '5.20',
    installDate: '2026-08-24',
    passed: true,
    comment: '',
    solution: '',
    service: 'Visual & Functional, Passed',
    note: 'Failed Load Test - Replace Battery\nBattery Replaced By Tech A With Acme Fire & Safety - 8/24/26',
    modelNumber: '12V-8Ah',
  });
});

test('Rated Voltage is never included in the write payload - stays unchanged', () => {
  const record = makeBatteryRecord({ ratedVoltage: '24.00' });
  const r = buildBatteryRepairChange(record, VALID_INPUT);
  assert.equal(r.ok, true);
  assert.equal('ratedVoltage' in r.writeValue, false);
});

test('an empty existing Note gets just the repair line, no leading blank line', () => {
  const record = makeBatteryRecord({ note: '' });
  const r = buildBatteryRepairChange(record, VALID_INPUT);
  assert.equal(r.writeValue.note, 'Battery Replaced By Tech A With Acme Fire & Safety - 8/24/26');
});

test('Min Ah is recalculated from the NEW Amps, not the record\'s existing Amps', () => {
  const record = makeBatteryRecord({ amps: '7.00' });
  const r = buildBatteryRepairChange(record, { ...VALID_INPUT, amps: '10.00' });
  assert.equal(r.writeValue.amps, '10.00');
  assert.equal(r.writeValue.minAh, '6.50');
});

test('Model Number is derived from Rated Voltage + the new Amps', () => {
  const record = makeBatteryRecord({ ratedVoltage: '12.00', amps: '7.00' });
  const r = buildBatteryRepairChange(record, { ...VALID_INPUT, amps: '8.00' });
  assert.equal(r.writeValue.modelNumber, '12V-8Ah');
});

test('Model Number is left out of the write payload when Rated Voltage is invalid/missing', () => {
  const record = makeBatteryRecord({ ratedVoltage: '' });
  const r = buildBatteryRepairChange(record, VALID_INPUT);
  assert.equal(r.ok, true);
  assert.equal('modelNumber' in r.writeValue, false);
});

test('the install date is passed through as an ISO string for the write, and M/D/YY for the Note', () => {
  const record = makeBatteryRecord();
  const r = buildBatteryRepairChange(record, { ...VALID_INPUT, installDate: '2026-01-05' });
  assert.equal(r.writeValue.installDate, '2026-01-05');
  assert.match(r.summary.installDate, /^1\/5\/26$/);
  assert.match(r.writeValue.note, /- 1\/5\/26$/);
});

test('priorValue captures the exact before-values for every field being written, for Undo', () => {
  const record = makeBatteryRecord({
    amps: '7.00',
    postTest: '12.70',
    testedAh: '9.30',
    minAh: '4.55',
    installDate: '2020-01-01',
    passed: false,
    comment: 'Failed Test',
    solution: 'Replace Battery',
    service: 'Visual & Functional, Failed',
    note: 'Old note',
    modelNumber: '12V-7Ah',
  });
  const r = buildBatteryRepairChange(record, VALID_INPUT);
  assert.deepEqual(r.priorValue, {
    amps: '7.00',
    postTest: '12.70',
    testedAh: '9.30',
    minAh: '4.55',
    installDate: '2020-01-01',
    passed: false,
    comment: 'Failed Test',
    solution: 'Replace Battery',
    service: 'Visual & Functional, Failed',
    note: 'Old note',
    modelNumber: '12V-7Ah',
  });
});

test('priorValue.passed stays a real boolean, never stringified', () => {
  const record = makeBatteryRecord({ passed: false });
  const r = buildBatteryRepairChange(record, VALID_INPUT);
  assert.strictEqual(r.priorValue.passed, false);
});

// --- Validation: nothing is ever partially applied ---

test('blank Amps is rejected with an error, nothing written', () => {
  const r = buildBatteryRepairChange(makeBatteryRecord(), { ...VALID_INPUT, amps: '' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /Amps/.test(e)));
});

test('negative Amps is rejected', () => {
  const r = buildBatteryRepairChange(makeBatteryRecord(), { ...VALID_INPUT, amps: '-1' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /Amps/.test(e)));
});

test('non-numeric Amps is rejected', () => {
  const r = buildBatteryRepairChange(makeBatteryRecord(), { ...VALID_INPUT, amps: 'eight' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /Amps/.test(e)));
});

test('a blank install date is rejected', () => {
  const r = buildBatteryRepairChange(makeBatteryRecord(), { ...VALID_INPUT, installDate: '' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /date/i.test(e)));
});

test('an impossible calendar date (e.g. Feb 30) is rejected, never silently rolled over', () => {
  const r = buildBatteryRepairChange(makeBatteryRecord(), { ...VALID_INPUT, installDate: '2026-02-30' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /date/i.test(e)));
});

test('a blank technician/customer name is rejected', () => {
  const r = buildBatteryRepairChange(makeBatteryRecord(), { ...VALID_INPUT, tech: '  ' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /[Tt]echnician/.test(e)));
});

test('a blank company name is rejected', () => {
  const r = buildBatteryRepairChange(makeBatteryRecord(), { ...VALID_INPUT, company: '' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /[Cc]ompany/.test(e)));
});

test('multiple invalid fields all get reported at once, not just the first', () => {
  const r = buildBatteryRepairChange(makeBatteryRecord(), { amps: '', installDate: '', tech: '', company: '' });
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 4);
});
