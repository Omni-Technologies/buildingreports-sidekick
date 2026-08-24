import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGenericRepairChange } from '../src/cleanup/repair-generic.js';
import { makeRecord } from './fixtures.js';

test('a valid note produces the full expected write payload', () => {
  const record = makeRecord({
    devicetype: 'Smoke Detector',
    passed: false,
    service: 'Visual & Functional, Failed',
    comment: 'Failed Test',
    solution: 'Replace Detector',
    note: '',
  });
  const r = buildGenericRepairChange(record, { note: 'Cleaned and retested' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.writeValue, {
    passed: true,
    comment: '',
    solution: '',
    service: 'Visual & Functional, Passed',
    note: 'Cleaned and retested',
  });
});

test('an existing Note gets the new line appended below it, never overwritten', () => {
  const record = makeRecord({ note: 'Prior inspection note' });
  const r = buildGenericRepairChange(record, { note: 'Cleaned and retested' });
  assert.equal(r.writeValue.note, 'Prior inspection note\nCleaned and retested');
});

test('an empty existing Note gets just the typed line, no leading blank line', () => {
  const record = makeRecord({ note: '' });
  const r = buildGenericRepairChange(record, { note: 'Cleaned and retested' });
  assert.equal(r.writeValue.note, 'Cleaned and retested');
});

test('priorValue captures the exact before-values for every field being written, for Undo', () => {
  const record = makeRecord({
    passed: false,
    comment: 'Failed Test',
    solution: 'Replace Detector',
    service: 'Visual & Functional, Failed',
    note: 'Old note',
  });
  const r = buildGenericRepairChange(record, { note: 'Fixed' });
  assert.deepEqual(r.priorValue, {
    passed: false,
    comment: 'Failed Test',
    solution: 'Replace Detector',
    service: 'Visual & Functional, Failed',
    note: 'Old note',
  });
});

test('priorValue.passed stays a real boolean, never stringified', () => {
  const record = makeRecord({ passed: false });
  const r = buildGenericRepairChange(record, { note: 'Fixed' });
  assert.strictEqual(r.priorValue.passed, false);
});

test('a blank note is rejected, nothing written', () => {
  const r = buildGenericRepairChange(makeRecord(), { note: '' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /note/i.test(e)));
});

test('a whitespace-only note is rejected', () => {
  const r = buildGenericRepairChange(makeRecord(), { note: '   ' });
  assert.equal(r.ok, false);
});

test('note whitespace is collapsed the same way as every other free-text field in this codebase', () => {
  const record = makeRecord({ note: '' });
  const r = buildGenericRepairChange(record, { note: '  Cleaned   and   retested  ' });
  assert.equal(r.writeValue.note, 'Cleaned and retested');
});
