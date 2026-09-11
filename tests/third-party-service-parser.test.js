import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyThirdPartyServiceRecord } from '../src/cleanup/third-party-service-parser.js';
import { makeRecord } from './fixtures.js';

function extraField(result, field) {
  return result.extraFieldChanges.find((c) => c.field === field);
}

function makeThirdPartyRecord(overrides = {}) {
  return makeRecord({ devicetype: 'Tamper Switch', ...overrides });
}

// --- Device type recognition ---

test('recognizes all nine third-party device types, tolerant of case/whitespace', () => {
  const types = [
    'Air Pressure Switch',
    'tamper switch',
    'Waterflow  Switch',
    'KITCHEN HOOD',
    'Fire Pump Phase Reversal',
    'fire pump power',
    'Fire  Pump Running',
    'FIRE PUMP TROUBLE',
    'pre-action system',
  ];
  for (const devicetype of types) {
    const r = classifyThirdPartyServiceRecord(makeRecord({ devicetype, service: 'Hooper 4/26' }));
    assert.notEqual(r, null, `expected a result for "${devicetype}"`);
  }
});

test('returns null for device types this rule does not cover', () => {
  const r = classifyThirdPartyServiceRecord(makeRecord({ devicetype: 'Smoke Detector', service: 'Hooper 4/26' }));
  assert.equal(r, null);
});

// --- Basic shape / blank / conflict ---

test('blank Service is left untouched', () => {
  const r = classifyThirdPartyServiceRecord(makeThirdPartyRecord({ service: '' }));
  assert.equal(r.bucket, 'blank');
  assert.equal(r.after, null);
});

test('a value containing both Passed and Failed is flagged ambiguous, never rewritten', () => {
  const r = classifyThirdPartyServiceRecord(makeThirdPartyRecord({ service: 'Failed, retested Passed' }));
  assert.equal(r.bucket, 'ambiguousConflict');
  assert.equal(r.after, null);
});

test('preserved free-text phrases are left untouched', () => {
  const r = classifyThirdPartyServiceRecord(makeThirdPartyRecord({ service: 'No Access' }));
  assert.equal(r.bucket, 'customPreserved');
  assert.equal(r.after, null);
});

test('no recognizable "<Company> <M>/<YY>" shape is left for review, never guessed', () => {
  const r = classifyThirdPartyServiceRecord(makeThirdPartyRecord({ service: 'Bar Coded' }));
  assert.equal(r.bucket, 'unsupportedField');
  assert.equal(r.after, null);
});

test('a day-included date is not guessed at (only bare M/YY is recognized)', () => {
  const r = classifyThirdPartyServiceRecord(makeThirdPartyRecord({ service: 'Hooper 4/1/26' }));
  assert.equal(r.bucket, 'unsupportedField');
});

// --- Abbreviation examples (confirmed with the user) ---

test('a single-word company with no dictionary words is left unabbreviated', () => {
  const r = classifyThirdPartyServiceRecord(makeThirdPartyRecord({ service: 'Hooper 4/26' }));
  assert.equal(r.bucket, 'safeChange');
  assert.equal(r.after, 'Svc. By Hooper 4/26');
});

test('"Fire and Protection" abbreviates to "F&P"', () => {
  const r = classifyThirdPartyServiceRecord(makeThirdPartyRecord({ service: 'Fire and Protection 3/25' }));
  assert.equal(r.bucket, 'safeChange');
  assert.equal(r.after, 'Svc. By F&P 3/25');
});

test('"Jefferson Fire And Safety" abbreviates to "Jefferson F&S"', () => {
  const r = classifyThirdPartyServiceRecord(makeThirdPartyRecord({ service: 'Jefferson Fire And Safety 7/26' }));
  assert.equal(r.bucket, 'safeChange');
  assert.equal(r.after, 'Svc. By Jefferson F&S 7/26');
});

test('an existing "Svc. By" prefix is tolerated and rebuilt canonically', () => {
  const r = classifyThirdPartyServiceRecord(makeThirdPartyRecord({ service: 'svc by Jefferson Fire and Safety 7/26' }));
  assert.equal(r.bucket, 'safeChange');
  assert.equal(r.after, 'Svc. By Jefferson F&S 7/26');
});

test('a 4-digit year is truncated to its last two digits', () => {
  const r = classifyThirdPartyServiceRecord(makeThirdPartyRecord({ service: 'Hooper 4/2026' }));
  assert.equal(r.bucket, 'safeChange');
  assert.equal(r.after, 'Svc. By Hooper 4/26');
});

test('already-canonical values are idempotent (alreadyCorrect)', () => {
  const r = classifyThirdPartyServiceRecord(makeThirdPartyRecord({ service: 'Svc. By Jefferson F&S 7/26' }));
  assert.equal(r.bucket, 'alreadyCorrect');
  assert.equal(r.after, null);
  assert.deepEqual(r.extraFieldChanges, []);
});

// --- Doesn't fit even after abbreviation ---

test('a company that still does not fit 31 characters after abbreviation needs a manual fix', () => {
  const r = classifyThirdPartyServiceRecord(
    makeThirdPartyRecord({ service: 'Continental Atlantic Pacific Fire Protection Systems 4/26' })
  );
  assert.equal(r.bucket, 'needsReview');
  assert.equal(r.after, null);
  assert.ok(r.suggestedFix, 'expected a suggestedFix to be offered');
  assert.ok(r.suggestedFix.startsWith('Svc. By '));
  assert.ok(r.suggestedFix.endsWith('4/26'));
  assert.ok(r.suggestedFix.length > 31, 'suggestedFix should be the over-length candidate, not force-truncated');
});

test('suggestedFix is null for every other bucket', () => {
  const cases = ['', 'No Access', 'Bar Coded', 'Hooper 4/26', 'Svc. By Jefferson F&S 7/26'];
  for (const service of cases) {
    const r = classifyThirdPartyServiceRecord(makeThirdPartyRecord({ service }));
    assert.equal(r.suggestedFix, null, `expected suggestedFix null for "${service}"`);
  }
});

// --- Expiration (last day of the service month, strictly more than a year later) ---

test('exactly one year after the last day of the service month is NOT yet expired', () => {
  const r = classifyThirdPartyServiceRecord(
    makeThirdPartyRecord({ service: 'Svc. By Hooper 4/26', inspectionDate: '2027-04-30' })
  );
  assert.equal(r.bucket, 'alreadyCorrect');
  assert.deepEqual(r.extraFieldChanges, []);
});

test('one day past the one-year cutoff IS expired and flags Comment/Solution/Note', () => {
  const r = classifyThirdPartyServiceRecord(
    makeThirdPartyRecord({ service: 'Hooper 4/26', inspectionDate: '2027-05-01' })
  );
  assert.equal(r.bucket, 'safeChange');
  assert.equal(r.after, 'Svc. By Hooper 4/26');
  assert.equal(extraField(r, 'comment').after, 'Date Expired');
  assert.equal(extraField(r, 'solution').after, 'Investigate');
  assert.equal(extraField(r, 'note').after, 'Customer To Investigate Maintenance On Device');
});

test('expiration flags apply even when Service text is already canonical', () => {
  const r = classifyThirdPartyServiceRecord(
    makeThirdPartyRecord({ service: 'Svc. By Hooper 4/26', inspectionDate: '2027-05-01' })
  );
  assert.equal(r.bucket, 'safeChange');
  assert.equal(r.after, 'Svc. By Hooper 4/26');
  assert.equal(extraField(r, 'comment').after, 'Date Expired');
});

test('expiration never touches Passed', () => {
  const r = classifyThirdPartyServiceRecord(
    makeThirdPartyRecord({ service: 'Hooper 4/26', inspectionDate: '2027-05-01', passed: true })
  );
  assert.equal(extraField(r, 'passed'), undefined);
});

test('not-yet-expired never touches Comment/Solution/Note, even if they already hold unrelated text', () => {
  const r = classifyThirdPartyServiceRecord(
    makeThirdPartyRecord({
      service: 'Hooper 4/26',
      inspectionDate: '2027-01-01',
      comment: 'Unrelated note from another visit',
      solution: 'Unrelated solution',
      note: 'Unrelated note',
    })
  );
  assert.deepEqual(r.extraFieldChanges, []);
});

test('already-expired Comment/Solution/Note are not rewritten again once correct (idempotent)', () => {
  const r = classifyThirdPartyServiceRecord(
    makeThirdPartyRecord({
      service: 'Svc. By Hooper 4/26',
      inspectionDate: '2027-05-01',
      comment: 'Date Expired',
      solution: 'Investigate',
      note: 'Customer To Investigate Maintenance On Device',
    })
  );
  assert.equal(r.bucket, 'alreadyCorrect');
  assert.deepEqual(r.extraFieldChanges, []);
});
