import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyRecord, Bucket } from '../src/cleanup/classify.js';
import { runCleanup } from '../src/cleanup/engine.js';
import { annualProfile } from '../src/config/inspection-profiles/annual.js';
import { semiAnnualProfile } from '../src/config/inspection-profiles/semi-annual.js';
import { isUntestedService, UNTESTED_NOTES } from '../src/cleanup/untested-device-parser.js';
import { makeRecord } from './fixtures.js';

function fieldsAfter(result) {
  return Object.fromEntries(result.extraFieldChanges.map((c) => [c.field, c.after]));
}

test('trigger recognizes Not Tested / Barcoded variants', () => {
  for (const s of [
    'Not Tested', 'not tested', 'NOT TESTED', 'Not-Tested', 'Nottested', 'Untested',
    'Bar Coded', 'Barcoded', 'bar-coded', 'Bar Code', 'Barcode', 'Not Tested - door locked',
    'Barcoded (locked)', 'Not tested, room occupied', '  Not   Tested  ',
  ]) {
    assert.equal(isUntestedService(s), true, `expected trigger for "${s}"`);
  }
});

test('trigger ignores unrelated text and anything carrying a result word', () => {
  for (const s of [
    '', 'Visual & Functional, Passed', 'Tested', 'Tested By Others', 'Unable To Test', 'No Access',
    'Not Tested, Failed', 'Barcoded, Passed', 'Barcodes scanned', 'Notable',
  ]) {
    assert.equal(isUntestedService(s), false, `expected no trigger for "${s}"`);
  }
});

test('Note is picked from keyword context and the other three fields are canonical', () => {
  const cases = [
    [{ service: 'Not Tested', note: 'could not locate' }, UNTESTED_NOTES.locate],
    [{ service: 'Not Tested', comment: "Can't find device" }, UNTESTED_NOTES.locate],
    [{ service: 'Not Tested - door locked' }, UNTESTED_NOTES.locked],
    [{ service: 'Barcoded', note: 'Locked' }, UNTESTED_NOTES.locked],
    [{ service: 'Not tested', note: 'room occupied' }, UNTESTED_NOTES.occupied],
    [{ service: 'Bar Coded', solution: 'inside RTU-2' }, UNTESTED_NOTES.rtu],
    [{ service: 'Not Tested', note: 'in roof top unit, need hvac' }, UNTESTED_NOTES.rtu],
  ];
  for (const [overrides, expectedNote] of cases) {
    const r = classifyRecord(makeRecord(overrides), annualProfile);
    assert.equal(r.bucket, Bucket.SAFE_CHANGE, JSON.stringify(overrides));
    assert.equal(r.after, 'Bar Coded');
    const f = fieldsAfter(r);
    assert.equal(f.comment, 'Special Note');
    assert.equal(f.solution, 'See Notes/Recommendations');
    assert.equal(f.note, expectedNote, JSON.stringify(overrides));
  }
});

test('canonical notes all use a plain hyphen', () => {
  assert.equal(
    UNTESTED_NOTES.locate,
    'Unable To Locate Device For Functional Testing - Maintenance To Locate Device So That It Can Be Tested Or Removed From Programing'
  );
  assert.equal(UNTESTED_NOTES.locked, 'Unable To Access - Door Locked');
  assert.equal(UNTESTED_NOTES.occupied, 'Unable To Access - Room Occupied During Inspection');
  assert.equal(
    UNTESTED_NOTES.rtu,
    'Unable To Safely Access Device For Functional Testing - Device Is Inside RTU - Will Need HVAC Technician On-Site'
  );
  assert.equal(UNTESTED_NOTES.elevator, 'Unable To Test Without An Elevator Technician Present');
});

test('an en/em-dash variant of a canonical Note is rewritten to the plain-hyphen form', () => {
  for (const note of ['Unable To Access – Door Locked', 'Unable To Access—Door Locked']) {
    const r = classifyRecord(makeRecord({ service: 'Not Tested', location: 'Elevator Lobby', note }), annualProfile);
    assert.equal(r.bucket, Bucket.SAFE_CHANGE);
    assert.equal(fieldsAfter(r).note, UNTESTED_NOTES.locked);
  }
});

test('Passed is always checked - an untested device is never marked Failed', () => {
  const r = classifyRecord(makeRecord({ service: 'Not Tested', passed: false, note: 'locked' }), annualProfile);
  assert.equal(r.bucket, Bucket.SAFE_CHANGE);
  const passedChange = r.extraFieldChanges.find((c) => c.field === 'passed');
  assert.deepEqual(passedChange, { field: 'passed', before: false, after: true });

  const alreadyPassed = classifyRecord(makeRecord({ service: 'Not Tested', passed: true, note: 'locked' }), annualProfile);
  assert.equal(alreadyPassed.extraFieldChanges.find((c) => c.field === 'passed'), undefined);

  const canonicalButFailed = classifyRecord(
    makeRecord({
      service: 'Bar Coded', passed: false, comment: 'Special Note',
      solution: 'See Notes/Recommendations', note: UNTESTED_NOTES.rtu,
    }),
    annualProfile
  );
  assert.equal(canonicalButFailed.bucket, Bucket.SAFE_CHANGE);
  assert.deepEqual(canonicalButFailed.extraFieldChanges.map((c) => c.field), ['passed']);
});

test('elevator context (device type or location-ish columns) gets the elevator Note', () => {
  const cases = [
    { devicetype: 'Elevator', service: 'Not Tested' },
    { devicetype: 'Heat Detector', service: 'Barcoded', location: 'Elevator Shaft' },
    { devicetype: 'Smoke Detector', service: 'Not Tested', direction: 'top of elev shaft' },
    { devicetype: 'Smoke Detector', service: 'Not Tested', description: 'Elevator Machine Room' },
    { devicetype: 'Smoke Detector', service: 'Not Tested', areasuite: 'Hoistway 2' },
    // Elevator wins over a keyword that would otherwise pick another Note.
    { devicetype: 'Heat Detector', service: 'Not Tested', location: 'Elevator Pit', note: 'locked' },
  ];
  for (const overrides of cases) {
    const r = classifyRecord(makeRecord(overrides), annualProfile);
    assert.equal(r.bucket, Bucket.SAFE_CHANGE, JSON.stringify(overrides));
    assert.equal(fieldsAfter(r).note, UNTESTED_NOTES.elevator, JSON.stringify(overrides));
  }
});

test('elevator matching does not fire on look-alike words', () => {
  const r = classifyRecord(
    makeRecord({ service: 'Not Tested', location: 'Elevation 3', note: 'locked' }),
    annualProfile
  );
  assert.equal(fieldsAfter(r).note, UNTESTED_NOTES.locked);
});

test('an already-canonical Note is kept as-is, even with elevator context', () => {
  const r = classifyRecord(
    makeRecord({ service: 'Not Tested', location: 'Elevator Lobby', note: UNTESTED_NOTES.locked }),
    annualProfile
  );
  assert.equal(r.bucket, Bucket.SAFE_CHANGE);
  assert.equal(fieldsAfter(r).note, undefined);
});

test('no recognizable reason, or more than one, is flagged needsReview with no write', () => {
  for (const overrides of [
    { service: 'Not Tested' },
    { service: 'Bar Coded', note: 'behind ceiling tile' },
    { service: 'Not Tested', note: 'locked and occupied' },
  ]) {
    const r = classifyRecord(makeRecord(overrides), annualProfile);
    assert.equal(r.bucket, Bucket.NEEDS_REVIEW, JSON.stringify(overrides));
    assert.equal(r.after, null);
    assert.deepEqual(r.extraFieldChanges, []);
  }
});

test('fully canonical untested device is alreadyCorrect', () => {
  const r = classifyRecord(
    makeRecord({
      service: 'Bar Coded',
      comment: 'Special Note',
      solution: 'See Notes/Recommendations',
      note: UNTESTED_NOTES.occupied,
    }),
    annualProfile
  );
  assert.equal(r.bucket, Bucket.ALREADY_CORRECT);
  assert.equal(r.after, null);
});

test('Service already "Bar Coded" but Comment/Solution differ is still a safeChange', () => {
  const r = classifyRecord(
    makeRecord({ service: 'Bar Coded', comment: '', solution: '', note: UNTESTED_NOTES.rtu }),
    annualProfile
  );
  assert.equal(r.bucket, Bucket.SAFE_CHANGE);
  assert.equal(r.after, 'Bar Coded');
  assert.deepEqual(r.extraFieldChanges.map((c) => c.field), ['comment', 'solution']);
});

test('applying the result is idempotent under both profiles', () => {
  for (const profile of [annualProfile, semiAnnualProfile]) {
    const records = [
      makeRecord({ scannumber: '1', service: 'Not tested', passed: false, note: 'door locked' }),
      makeRecord({ scannumber: '2', devicetype: 'Heat Detector', service: 'barcoded', passed: false, location: 'Elev shaft' }),
    ];
    const first = runCleanup(records, profile);
    assert.equal(first.totalWouldChange, 2);
    const applied = records.map((r) => {
      const c = first.safeChanges.find((x) => x.scannumber === r.scannumber);
      return { ...r, service: c.after, ...fieldsAfter(c) };
    });
    const second = runCleanup(applied, profile);
    assert.equal(second.totalWouldChange, 0);
    assert.equal(second.counts[Bucket.ALREADY_CORRECT], 2);
  }
});

test('unsupported and third-party device types are not touched by this rule', () => {
  const r = classifyRecord(makeRecord({ devicetype: 'Fire Extinguisher', service: 'Not Tested', note: 'locked' }), annualProfile);
  assert.equal(r.bucket, Bucket.UNSUPPORTED_DEVICE_TYPE);
  const t = classifyRecord(makeRecord({ devicetype: 'Tamper Switch', service: 'Not Tested', note: 'locked' }), annualProfile);
  assert.equal(t.bucket, Bucket.CUSTOM_PRESERVED);
});
