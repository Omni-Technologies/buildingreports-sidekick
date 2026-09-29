import test from 'node:test';
import assert from 'node:assert/strict';
import { runCleanup } from '../src/cleanup/engine.js';
import { Bucket } from '../src/cleanup/classify.js';
import { annualProfile } from '../src/config/inspection-profiles/annual.js';
import { makeRecord } from './fixtures.js';

function buildMixedReport() {
  return [
    makeRecord({ scannumber: '1', service: 'visual and functional, passed' }), // safe change
    makeRecord({ scannumber: '2', service: 'Visual & Functional, Passed' }), // already correct
    makeRecord({ scannumber: '3', service: '' }), // blank
    makeRecord({ scannumber: '4', service: 'visual and functional, failed - no response' }), // safe change (failed)
    makeRecord({ scannumber: '5', service: 'Tested By Others' }), // preserved
    makeRecord({ scannumber: '6', devicetype: 'Fire Extinguisher', service: 'visual and functional, passed' }), // unsupported type
    makeRecord({ scannumber: '7', service: 'Passed then Failed on retest' }), // conflict
    makeRecord({ scannumber: '8', service: 'Svc. By Hooper 2/25' }), // unsupported field
  ];
}

test('preview (runCleanup) never mutates input records', () => {
  const records = buildMixedReport();
  const snapshot = JSON.parse(JSON.stringify(records));
  runCleanup(records, annualProfile);
  assert.deepEqual(records, snapshot);
});

test('preview classifies each bucket correctly and computes totals', () => {
  const records = buildMixedReport();
  const summary = runCleanup(records, annualProfile);
  assert.equal(summary.totalDevices, 8);
  assert.equal(summary.totalWouldChange, 2);
  assert.equal(summary.passedNormalized, 1);
  assert.equal(summary.failedNormalized, 1);
  assert.equal(summary.counts[Bucket.SAFE_CHANGE], 2);
  assert.equal(summary.counts[Bucket.ALREADY_CORRECT], 1);
  assert.equal(summary.counts[Bucket.BLANK], 1);
  assert.equal(summary.counts[Bucket.CUSTOM_PRESERVED], 1);
  assert.equal(summary.counts[Bucket.UNSUPPORTED_DEVICE_TYPE], 1);
  assert.equal(summary.counts[Bucket.AMBIGUOUS_CONFLICT], 1);
  assert.equal(summary.counts[Bucket.UNSUPPORTED_FIELD], 1);
});

test('running preview twice on its own output is a no-op (idempotent apply target)', () => {
  const records = buildMixedReport();
  const first = runCleanup(records, annualProfile);

  // Simulate Apply: only write back the safeChange results.
  const applied = records.map((r) => {
    const change = first.results.find((c) => c.scannumber === r.scannumber && c.bucket === Bucket.SAFE_CHANGE);
    return change ? { ...r, service: change.after } : r;
  });

  const second = runCleanup(applied, annualProfile);
  assert.equal(second.totalWouldChange, 0, 'nothing left to change after apply');
  assert.equal(second.counts[Bucket.ALREADY_CORRECT], first.counts[Bucket.ALREADY_CORRECT] + first.counts[Bucket.SAFE_CHANGE]);
});

test('apply only ever touches safeChange entries (failed stays Failed, others untouched)', () => {
  const records = buildMixedReport();
  const summary = runCleanup(records, annualProfile);
  const changed = summary.safeChanges;
  assert.equal(changed.length, 2);
  for (const c of changed) {
    assert.notEqual(c.bucket, Bucket.BLANK);
    assert.notEqual(c.bucket, Bucket.AMBIGUOUS_CONFLICT);
    assert.notEqual(c.bucket, Bucket.UNSUPPORTED_DEVICE_TYPE);
    assert.notEqual(c.bucket, Bucket.CUSTOM_PRESERVED);
  }
  const failedChange = changed.find((c) => c.scannumber === '4');
  assert.ok(failedChange.after.includes('Failed'));
  assert.ok(!failedChange.after.includes('Passed'));
});

test('undo restores the exact original values from safeChange.before', () => {
  const records = buildMixedReport();
  const summary = runCleanup(records, annualProfile);
  const changes = summary.safeChanges.map((c) => ({ scannumber: c.scannumber, before: c.before, after: c.after }));

  // Apply
  let applied = records.map((r) => {
    const c = changes.find((x) => x.scannumber === r.scannumber);
    return c ? { ...r, service: c.after } : r;
  });

  // Undo: write `before` back for every tracked change.
  const undone = applied.map((r) => {
    const c = changes.find((x) => x.scannumber === r.scannumber);
    return c ? { ...r, service: c.before } : r;
  });

  for (const original of records) {
    const restored = undone.find((r) => r.scannumber === original.scannumber);
    assert.equal(restored.service, original.service);
  }
});
