import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyRecord, Bucket } from '../src/cleanup/classify.js';
import { runCleanup } from '../src/cleanup/engine.js';
import { semiAnnualProfile } from '../src/config/inspection-profiles/semi-annual.js';
import { annualProfile } from '../src/config/inspection-profiles/annual.js';
import { makeRecord } from './fixtures.js';

// The five Semi-Annual "Visual & Functional" device types.
test('Annunciator with Visual, Passed becomes Visual & Functional, Passed', () => {
  const r = classifyRecord(
    makeRecord({ devicetype: 'Annunciator', service: 'Visual, Passed' }),
    semiAnnualProfile
  );
  assert.equal(r.bucket, Bucket.SAFE_CHANGE);
  assert.equal(r.after, 'Visual & Functional, Passed');
});

test('Battery with Visual, Failed becomes Visual & Functional, Failed', () => {
  const r = classifyRecord(
    makeRecord({ devicetype: 'Battery', service: 'Visual, Failed' }),
    semiAnnualProfile
  );
  assert.equal(r.bucket, Bucket.SAFE_CHANGE);
  assert.equal(r.after, 'Visual & Functional, Failed');
});

test('Control Panel with lowercase "visual & functional passed" normalizes correctly', () => {
  const r = classifyRecord(
    makeRecord({ devicetype: 'Control Panel', service: 'visual & functional passed' }),
    semiAnnualProfile
  );
  assert.equal(r.bucket, Bucket.SAFE_CHANGE);
  assert.equal(r.after, 'Visual & Functional, Passed');
});

test('Indicating Device with Visual Failed becomes Visual & Functional Failed', () => {
  const r = classifyRecord(
    makeRecord({ devicetype: 'Indicating Device', service: 'Visual Failed' }),
    semiAnnualProfile
  );
  assert.equal(r.bucket, Bucket.SAFE_CHANGE);
  assert.equal(r.after, 'Visual & Functional, Failed');
});

test('Power Supply already correct (Visual & Functional, Passed) remains unchanged', () => {
  const r = classifyRecord(
    makeRecord({ devicetype: 'Power Supply', service: 'Visual & Functional, Passed' }),
    semiAnnualProfile
  );
  assert.equal(r.bucket, Bucket.ALREADY_CORRECT);
  assert.equal(r.after, null);
});

// Every other Annual-supported device type: Visual-only fallback.
test('Smoke Detector with Visual & Functional Passed becomes Visual, Passed', () => {
  const r = classifyRecord(
    makeRecord({ devicetype: 'Smoke Detector', service: 'Visual & Functional Passed' }),
    semiAnnualProfile
  );
  assert.equal(r.bucket, Bucket.SAFE_CHANGE);
  assert.equal(r.after, 'Visual, Passed');
});

test('Pull Station with Visual & Functional Failed becomes Visual, Failed', () => {
  const r = classifyRecord(
    makeRecord({ devicetype: 'Pull Station', service: 'Visual & Functional Failed' }),
    semiAnnualProfile
  );
  assert.equal(r.bucket, Bucket.SAFE_CHANGE);
  assert.equal(r.after, 'Visual, Failed');
});

test('Duct Detector lowercase "visual passed" normalizes correctly', () => {
  const r = classifyRecord(
    makeRecord({ devicetype: 'Duct Detector', service: 'visual passed' }),
    semiAnnualProfile
  );
  assert.equal(r.bucket, Bucket.SAFE_CHANGE);
  assert.equal(r.after, 'Visual, Passed');
});

// Outcome preservation: every recognized variation for a device, in both
// directions, must never flip Passed<->Failed.
test('all recognized Passed variations for a Visual & Functional device normalize to Passed, never Failed', () => {
  const variants = ['Visual, Passed', 'visual passed', 'Visual and Functional, passed', 'visual & functional passed'];
  for (const service of variants) {
    const r = classifyRecord(makeRecord({ devicetype: 'Annunciator', service }), semiAnnualProfile);
    assert.equal(r.bucket, Bucket.SAFE_CHANGE, `expected safeChange for "${service}"`);
    assert.equal(r.after, 'Visual & Functional, Passed');
  }
});

test('all recognized Failed variations for a Visual & Functional device normalize to Failed, never Passed', () => {
  const variants = ['Visual, Failed', 'visual failed', 'Visual and Functional, failed', 'visual & functional failed'];
  for (const service of variants) {
    const r = classifyRecord(makeRecord({ devicetype: 'Annunciator', service }), semiAnnualProfile);
    assert.equal(r.bucket, Bucket.SAFE_CHANGE, `expected safeChange for "${service}"`);
    assert.equal(r.after, 'Visual & Functional, Failed');
  }
});

test('all recognized Passed variations for a Visual-only device normalize to Passed, never Failed', () => {
  const variants = ['Visual & Functional, Passed', 'Visual and Functional, passed', 'visual passed'];
  for (const service of variants) {
    const r = classifyRecord(makeRecord({ devicetype: 'Smoke Detector', service }), semiAnnualProfile);
    assert.equal(r.bucket, Bucket.SAFE_CHANGE, `expected safeChange for "${service}"`);
    assert.equal(r.after, 'Visual, Passed');
  }
});

test('all recognized Failed variations for a Visual-only device normalize to Failed, never Passed', () => {
  const variants = ['Visual & Functional, Failed', 'Visual and Functional, failed', 'visual failed'];
  for (const service of variants) {
    const r = classifyRecord(makeRecord({ devicetype: 'Smoke Detector', service }), semiAnnualProfile);
    assert.equal(r.bucket, Bucket.SAFE_CHANGE, `expected safeChange for "${service}"`);
    assert.equal(r.after, 'Visual, Failed');
  }
});

// Strict cleanup scope: never touch anything not confidently recognizable.
test('blank Service remains untouched under Semi-Annual', () => {
  const r = classifyRecord(makeRecord({ devicetype: 'Annunciator', service: '' }), semiAnnualProfile);
  assert.equal(r.bucket, Bucket.BLANK);
  assert.equal(r.after, null);
});

test('a custom technician note remains untouched under Semi-Annual', () => {
  const r = classifyRecord(
    makeRecord({ devicetype: 'Smoke Detector', service: 'Svc. By Hooper 2/25' }),
    semiAnnualProfile
  );
  assert.equal(r.bucket, Bucket.UNSUPPORTED_FIELD);
  assert.equal(r.after, null);
});

test('"Not Tested" remains untouched under Semi-Annual', () => {
  const r = classifyRecord(makeRecord({ devicetype: 'Battery', service: 'Not Tested' }), semiAnnualProfile);
  assert.equal(r.bucket, Bucket.CUSTOM_PRESERVED);
  assert.equal(r.after, null);
});

test('conflicting Passed and Failed remains untouched under Semi-Annual', () => {
  const r = classifyRecord(
    makeRecord({ devicetype: 'Control Panel', service: 'Visual, Failed, retested Passed' }),
    semiAnnualProfile
  );
  assert.equal(r.bucket, Bucket.AMBIGUOUS_CONFLICT);
  assert.equal(r.after, null);
});

test('an unsupported device type remains untouched under Semi-Annual', () => {
  const r = classifyRecord(
    makeRecord({ devicetype: 'Fire Extinguisher', service: 'visual passed' }),
    semiAnnualProfile
  );
  assert.equal(r.bucket, Bucket.UNSUPPORTED_DEVICE_TYPE);
  assert.equal(r.after, null);
});

// Annual must be completely unaffected by the Semi-Annual work.
test('Annual profile behavior remains unchanged (still always Visual & Functional)', () => {
  const battery = classifyRecord(
    makeRecord({ devicetype: 'Battery', service: 'visual passed' }),
    annualProfile
  );
  assert.equal(battery.bucket, Bucket.SAFE_CHANGE);
  assert.equal(battery.after, 'Visual & Functional, Passed');

  const smoke = classifyRecord(
    makeRecord({ devicetype: 'Smoke Detector', service: 'visual and functional, failed' }),
    annualProfile
  );
  assert.equal(smoke.bucket, Bucket.SAFE_CHANGE);
  assert.equal(smoke.after, 'Visual & Functional, Failed');
});

// Preview/Apply/Undo at the engine level, mirroring engine.test.js.
function buildSemiAnnualReport() {
  return [
    makeRecord({ scannumber: '1', devicetype: 'Annunciator', service: 'Visual, Passed' }), // safe change -> V&F
    makeRecord({ scannumber: '2', devicetype: 'Smoke Detector', service: 'Visual & Functional, Failed' }), // safe change -> Visual only
    makeRecord({ scannumber: '3', devicetype: 'Power Supply', service: 'Visual & Functional, Passed' }), // already correct
    makeRecord({ scannumber: '4', devicetype: 'Pull Station', service: '' }), // blank
    makeRecord({ scannumber: '5', devicetype: 'Battery', service: 'Custom note from tech' }), // unsupported field, preserved
    makeRecord({ scannumber: '6', devicetype: 'Waterflow Switch', service: 'visual passed' }), // unsupported device type
  ];
}

test('Preview (runCleanup) makes no changes to the input records', () => {
  const records = buildSemiAnnualReport();
  const snapshot = JSON.parse(JSON.stringify(records));
  runCleanup(records, semiAnnualProfile);
  assert.deepEqual(records, snapshot);
});

test('Apply (safeChanges) only writes the safe variations, preserving everything else', () => {
  const records = buildSemiAnnualReport();
  const summary = runCleanup(records, semiAnnualProfile);
  assert.equal(summary.totalWouldChange, 2);

  const bySn = new Map(summary.safeChanges.map((c) => [c.scannumber, c]));
  assert.equal(bySn.get('1').after, 'Visual & Functional, Passed');
  assert.equal(bySn.get('2').after, 'Visual, Failed');
  assert.equal([...bySn.keys()].sort().join(','), '1,2');
});

test('Undo restores the exact original Service values changed by Apply', () => {
  const records = buildSemiAnnualReport();
  const summary = runCleanup(records, semiAnnualProfile);
  const changes = summary.safeChanges.map((c) => ({ scannumber: c.scannumber, before: c.before, after: c.after }));

  const applied = records.map((r) => {
    const c = changes.find((x) => x.scannumber === r.scannumber);
    return c ? { ...r, service: c.after } : r;
  });

  const undone = applied.map((r) => {
    const c = changes.find((x) => x.scannumber === r.scannumber);
    return c ? { ...r, service: c.before } : r;
  });

  for (const original of records) {
    const restored = undone.find((r) => r.scannumber === original.scannumber);
    assert.equal(restored.service, original.service);
  }
});
