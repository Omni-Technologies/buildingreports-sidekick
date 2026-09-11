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
    makeRecord({ devicetype: 'Fire Extinguisher', service: 'visual and functional, passed' }),
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

// --- Annual Heat Detector: preserve an already-Visual-only value, and keep
// the Restorable device-attribute checkbox synced. See annual.js's
// heatDetectorVisualOnlyPreserved and docs/cleanup-rules.md.

test('Annual Heat Detector already "Visual, Passed" is not upgraded to Visual & Functional', () => {
  const variants = ['Visual, Passed', 'visual,passed', 'Visual  Passed', 'visual, PASSED'];
  for (const service of variants) {
    const r = classifyRecord(makeRecord({ devicetype: 'Heat Detector', service, restorable: false }), annualProfile);
    assert.equal(r.bucket, service === 'Visual, Passed' ? Bucket.ALREADY_CORRECT : Bucket.SAFE_CHANGE, `for "${service}"`);
    if (r.bucket === Bucket.SAFE_CHANGE) assert.equal(r.after, 'Visual, Passed');
  }
});

test('Annual Heat Detector already "Visual, Failed" is not upgraded either', () => {
  const r = classifyRecord(
    makeRecord({ devicetype: 'Heat Detector', service: 'visual, failed', restorable: false }),
    annualProfile
  );
  assert.equal(r.bucket, Bucket.SAFE_CHANGE);
  assert.equal(r.after, 'Visual, Failed');
});

test('Annual Heat Detector Visual & Functional (Passed or Failed) checks Restorable when currently unchecked', () => {
  for (const service of ['visual and functional, passed', 'visual and functional, failed']) {
    const r = classifyRecord(
      makeRecord({ devicetype: 'Heat Detector', service, restorable: false }),
      annualProfile
    );
    assert.equal(r.bucket, Bucket.SAFE_CHANGE);
    const restorableChange = r.extraFieldChanges.find((c) => c.field === 'restorable');
    assert.equal(restorableChange.after, true, `for "${service}"`);
  }
});

test('Annual Heat Detector already Visual & Functional with Restorable already checked is fully correct', () => {
  const r = classifyRecord(
    makeRecord({ devicetype: 'Heat Detector', service: 'Visual & Functional, Passed', restorable: true }),
    annualProfile
  );
  assert.equal(r.bucket, Bucket.ALREADY_CORRECT);
  assert.deepEqual(r.extraFieldChanges, []);
});

test('Annual Heat Detector Visual & Functional text unchanged but Restorable stale still needs a save', () => {
  const r = classifyRecord(
    makeRecord({ devicetype: 'Heat Detector', service: 'Visual & Functional, Passed', restorable: false }),
    annualProfile
  );
  assert.equal(r.bucket, Bucket.SAFE_CHANGE);
  assert.equal(r.after, 'Visual & Functional, Passed');
  assert.equal(r.extraFieldChanges.find((c) => c.field === 'restorable').after, true);
});

test('Annual Heat Detector confirmed One Hitter unchecks a stale Restorable checkbox', () => {
  const r = classifyRecord(
    makeRecord({
      devicetype: 'Heat Detector',
      description: 'One Hitter',
      service: 'visual and functional, passed',
      restorable: true,
    }),
    annualProfile
  );
  assert.equal(r.bucket, Bucket.SAFE_CHANGE);
  assert.equal(r.after, 'Visual, Passed');
  assert.equal(r.extraFieldChanges.find((c) => c.field === 'restorable').after, false);
});

test('Annual Heat Detector Visual-only preserved case also unchecks a stale Restorable checkbox', () => {
  const r = classifyRecord(
    makeRecord({ devicetype: 'Heat Detector', service: 'visual,passed', restorable: true }),
    annualProfile
  );
  assert.equal(r.bucket, Bucket.SAFE_CHANGE);
  assert.equal(r.after, 'Visual, Passed');
  assert.equal(r.extraFieldChanges.find((c) => c.field === 'restorable').after, false);
});

test('non-Heat-Detector devices never carry a restorable extraFieldChange', () => {
  const r = classifyRecord(
    makeRecord({ devicetype: 'Smoke Detector', service: 'visual and functional, passed' }),
    annualProfile
  );
  assert.equal(r.bucket, Bucket.SAFE_CHANGE);
  assert.deepEqual(r.extraFieldChanges, []);
});

test('Semi-Annual Heat Detector behavior is completely unaffected (no restorable syncing, still Visual-only)', () => {
  const alreadyVisual = classifyRecord(
    makeRecord({ devicetype: 'Heat Detector', service: 'Visual, Passed', restorable: false }),
    semiAnnualProfile
  );
  assert.equal(alreadyVisual.bucket, Bucket.ALREADY_CORRECT);
  assert.deepEqual(alreadyVisual.extraFieldChanges, []);

  const upgraded = classifyRecord(
    makeRecord({ devicetype: 'Heat Detector', service: 'visual and functional, passed', restorable: false }),
    semiAnnualProfile
  );
  assert.equal(upgraded.bucket, Bucket.SAFE_CHANGE);
  assert.equal(upgraded.after, 'Visual, Passed');
  assert.deepEqual(upgraded.extraFieldChanges, []);
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

// Communicator/Communication Line/Monitoring (full rule reference:
// docs/cleanup-rules.md, logic in communications-parser.js) aren't in
// either profile's supportedDeviceTypeKeys and are intercepted before that
// check - confirm both profiles produce the identical result, since
// communications-parser.js doesn't take `profile` as an input at all.
test('Communicator/Communication Line/Monitoring are classified identically under Annual and Semi-Annual', () => {
  const cases = [
    { devicetype: 'Communicator', service: 'Restored @ 11:29 AM 5/1/25', restoreTime: '11:29 AM' },
    { devicetype: 'Communication Line', service: 'Yes, 11:02 AM' },
    { devicetype: 'Monitoring', service: 'Yes, 6:11 AM', passed: true, confirmedTime: '6:11 AM' },
  ];
  for (const overrides of cases) {
    const annualResult = classifyRecord(makeRecord(overrides), annualProfile);
    const semiAnnualResult = classifyRecord(makeRecord(overrides), semiAnnualProfile);
    assert.equal(annualResult.bucket, Bucket.ALREADY_CORRECT, `${overrides.devicetype} under Annual`);
    assert.equal(semiAnnualResult.bucket, Bucket.ALREADY_CORRECT, `${overrides.devicetype} under Semi-Annual`);
  }
});

test('the real-world "Visually" typo normalizes the same as "Visual"', () => {
  const r = classifyRecord(
    makeRecord({ devicetype: 'Strobe', service: 'Visually & Functional, Passed' }),
    annualProfile
  );
  assert.equal(r.bucket, Bucket.SAFE_CHANGE);
  assert.equal(r.after, 'Visual & Functional, Passed');
});

test('"Visually" typo under Semi-Annual still respects the Visual-only device grouping', () => {
  const r = classifyRecord(
    makeRecord({ devicetype: 'Strobe', service: 'visually and functional, passed' }),
    semiAnnualProfile
  );
  assert.equal(r.bucket, Bucket.SAFE_CHANGE);
  assert.equal(r.after, 'Visual, Passed');
});

test('a bare "Tested" placeholder with Passed checked normalizes to the profile\'s canonical phrase', () => {
  const annualResult = classifyRecord(
    makeRecord({ devicetype: 'Smoke Detector', service: 'Tested', passed: true }),
    annualProfile
  );
  assert.equal(annualResult.bucket, Bucket.SAFE_CHANGE);
  assert.equal(annualResult.after, 'Visual & Functional, Passed');

  const semiAnnualResult = classifyRecord(
    makeRecord({ devicetype: 'Smoke Detector', service: 'Tested', passed: true }),
    semiAnnualProfile
  );
  assert.equal(semiAnnualResult.bucket, Bucket.SAFE_CHANGE);
  assert.equal(semiAnnualResult.after, 'Visual, Passed');

  const semiAnnualVFResult = classifyRecord(
    makeRecord({ devicetype: 'Battery', service: 'tested', passed: true }),
    semiAnnualProfile
  );
  assert.equal(semiAnnualVFResult.bucket, Bucket.SAFE_CHANGE);
  assert.equal(semiAnnualVFResult.after, 'Visual & Functional, Passed');
});

test('a "Tested/Cleaned" (and word-order/spacing variations) placeholder with Passed checked normalizes to the profile\'s canonical phrase', () => {
  const variations = [
    'Tested/Cleaned',
    'tested/cleaned',
    'Cleaned/Tested',
    'cleaned/tested',
    'Tested / Cleaned',
    'Tested/ Cleaned',
    'Tested /Cleaned',
  ];
  for (const service of variations) {
    const r = classifyRecord(
      makeRecord({ devicetype: 'Smoke Detector', service, passed: true }),
      annualProfile
    );
    assert.equal(r.bucket, Bucket.SAFE_CHANGE, `expected safeChange for "${service}"`);
    assert.equal(r.after, 'Visual & Functional, Passed', `expected canonical result for "${service}"`);
  }
});

test('a "Tested/Cleaned" placeholder with Passed UNCHECKED is never guessed at as Failed', () => {
  const r = classifyRecord(
    makeRecord({ devicetype: 'Smoke Detector', service: 'Tested/Cleaned', passed: false }),
    annualProfile
  );
  assert.equal(r.bucket, Bucket.UNSUPPORTED_FIELD);
  assert.equal(r.after, null);
});

test('a bare "Tested" placeholder with Passed UNCHECKED is never guessed at as Failed', () => {
  const r = classifyRecord(
    makeRecord({ devicetype: 'Smoke Detector', service: 'Tested', passed: false }),
    annualProfile
  );
  assert.equal(r.bucket, Bucket.UNSUPPORTED_FIELD);
  assert.equal(r.after, null);
});

test('a Heat Detector with a "Tested" placeholder gets the standard phrase, not the Visual-only preserved signal', () => {
  const r = classifyRecord(
    makeRecord({ devicetype: 'Heat Detector', service: 'Tested', passed: true }),
    annualProfile
  );
  assert.equal(r.bucket, Bucket.SAFE_CHANGE);
  assert.equal(r.after, 'Visual & Functional, Passed');
});

test('a Communicator needing normalization is not treated as an unsupported device type', () => {
  const r = classifyRecord(
    makeRecord({ devicetype: 'Communicator', service: 'restored @11:29am 5/1/25' }),
    annualProfile
  );
  assert.equal(r.bucket, Bucket.SAFE_CHANGE);
  assert.equal(r.after, 'Restored @ 11:29 AM 5/1/25');
  assert.ok(r.extraFieldChanges);
});
