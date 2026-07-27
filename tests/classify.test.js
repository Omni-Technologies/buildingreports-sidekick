import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyRecord, Bucket } from '../src/cleanup/classify.js';
import { annualProfile } from '../src/config/inspection-profiles/annual.js';
import { semiAnnualProfile } from '../src/config/inspection-profiles/semi-annual.js';
import { makeRecord } from './fixtures.js';

test('common Passed variations normalize to canonical', () => {
  const variants = [
    'visual and functional, passed',
    'Visual and functional, passed',
    'Visual & functional passed',
    'Visual & Functional,Passed',
  ];
  for (const service of variants) {
    const r = classifyRecord(makeRecord({ service }), annualProfile);
    assert.equal(r.bucket, Bucket.SAFE_CHANGE, `expected safeChange for "${service}"`);
    assert.equal(r.after, 'Visual & Functional, Passed');
  }
});

test('common Failed variations normalize to canonical and stay Failed', () => {
  const variants = [
    'visual and functional, failed',
    'Visual & functional failed',
    'Visual & Functional,Failed',
  ];
  for (const service of variants) {
    const r = classifyRecord(makeRecord({ service }), annualProfile);
    assert.equal(r.bucket, Bucket.SAFE_CHANGE);
    assert.equal(r.after, 'Visual & Functional, Failed');
  }
});

test('failed with a note preserves the note, sentence-cased, after a dash', () => {
  const r = classifyRecord(
    makeRecord({ service: 'visual and functional, failed - no response' }),
    annualProfile
  );
  assert.equal(r.bucket, Bucket.SAFE_CHANGE);
  assert.equal(r.after, 'Visual & Functional, Failed - No response');
});

test('note text is not aggressively title-cased (acronyms/model numbers preserved)', () => {
  const r = classifyRecord(
    makeRecord({ service: 'visual and functional, failed - replaced FSP-851 at panel NAC-2' }),
    annualProfile
  );
  assert.equal(r.bucket, Bucket.SAFE_CHANGE);
  assert.equal(r.after, 'Visual & Functional, Failed - Replaced FSP-851 at panel NAC-2');
});

test('already correct values are left alone', () => {
  const r = classifyRecord(makeRecord({ service: 'Visual & Functional, Passed' }), annualProfile);
  assert.equal(r.bucket, Bucket.ALREADY_CORRECT);
  assert.equal(r.after, null);
});

test('blank values remain blank and are not touched', () => {
  const r = classifyRecord(makeRecord({ service: '' }), annualProfile);
  assert.equal(r.bucket, Bucket.BLANK);
  assert.equal(r.after, null);

  const r2 = classifyRecord(makeRecord({ service: '   ' }), annualProfile);
  assert.equal(r2.bucket, Bucket.BLANK);
});

test('meaningful notes without a result token are preserved, not invented', () => {
  const preserved = [
    'Not Tested',
    'Unable To Test',
    'Tested By Others',
    'No Access',
    'See On-Site Service Records',
  ];
  for (const service of preserved) {
    const r = classifyRecord(makeRecord({ service }), annualProfile);
    assert.equal(r.bucket, Bucket.CUSTOM_PRESERVED, `expected customPreserved for "${service}"`);
    assert.equal(r.after, null);
  }
});

test('unrecognized free-text notes are flagged, not rewritten', () => {
  const r = classifyRecord(makeRecord({ service: 'Svc. By Hooper 2/25' }), annualProfile);
  assert.equal(r.bucket, Bucket.UNSUPPORTED_FIELD);
  assert.equal(r.after, null);
});

test('entries containing both Passed and Failed are flagged as conflicting and left unchanged', () => {
  const r = classifyRecord(
    makeRecord({ service: 'Visual & Functional, Failed, retested Passed' }),
    annualProfile
  );
  assert.equal(r.bucket, Bucket.AMBIGUOUS_CONFLICT);
  assert.equal(r.after, null);
});

test('unsupported device types are left alone regardless of Service content', () => {
  const r = classifyRecord(
    makeRecord({ devicetype: 'Waterflow Switch', service: 'visual and functional, passed' }),
    annualProfile
  );
  assert.equal(r.bucket, Bucket.UNSUPPORTED_DEVICE_TYPE);
  assert.equal(r.after, null);
});

test('device type matching tolerates spacing/slash/parenthetical variation but not substrings', () => {
  const tolerant = classifyRecord(
    makeRecord({ devicetype: 'Bell / Strobe', service: 'visual and functional, passed' }),
    annualProfile
  );
  assert.equal(tolerant.bucket, Bucket.SAFE_CHANGE);

  const notSubstring = classifyRecord(
    makeRecord({ devicetype: 'Smoke Detector Head', service: 'visual and functional, passed' }),
    annualProfile
  );
  assert.equal(notSubstring.bucket, Bucket.UNSUPPORTED_DEVICE_TYPE);
});

test('Heat Detector without One Hitter marker uses standard Visual & Functional phrasing', () => {
  const r = classifyRecord(
    makeRecord({ devicetype: 'Heat Detector', service: 'visual and functional, passed' }),
    annualProfile
  );
  assert.equal(r.bucket, Bucket.SAFE_CHANGE);
  assert.equal(r.after, 'Visual & Functional, Passed');
});

test('Heat Detector clearly identified as One Hitter uses the Visual-only phrasing', () => {
  const r = classifyRecord(
    makeRecord({
      devicetype: 'Heat Detector',
      description: 'One Hitter',
      service: 'visual and functional, passed',
    }),
    annualProfile
  );
  assert.equal(r.bucket, Bucket.SAFE_CHANGE);
  assert.equal(r.after, 'Visual, Passed');
});

test('Heat Detector One Hitter failed keeps Failed result', () => {
  const r = classifyRecord(
    makeRecord({
      devicetype: 'Heat Detector',
      note: 'one-hitter',
      service: 'Visual, failed',
    }),
    annualProfile
  );
  assert.equal(r.bucket, Bucket.SAFE_CHANGE);
  assert.equal(r.after, 'Visual, Failed');
});

test('ambiguous One Hitter reference (e.g. "1 hitter") is flagged for review, not guessed', () => {
  const r = classifyRecord(
    makeRecord({
      devicetype: 'Heat Detector',
      note: '1-hitter?',
      service: 'visual and functional, passed',
    }),
    annualProfile
  );
  assert.equal(r.bucket, Bucket.NEEDS_REVIEW);
  assert.equal(r.after, null);
});

// Semi-Annual profile behavior itself is covered in tests/semi-annual.test.js.
// This just confirms a disabled profile (hypothetical future state) still
// takes the review-only path rather than guessing.
test('a disabled profile flags everything for review instead of applying rules', () => {
  const disabledProfile = { ...semiAnnualProfile, enabled: false };
  const r = classifyRecord(makeRecord({ service: 'visual and functional, passed' }), disabledProfile);
  assert.equal(r.bucket, Bucket.NEEDS_REVIEW);
  assert.equal(r.after, null);
});
