import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyCommunicatorRecord,
  classifyCommunicationLineRecord,
  classifyMonitoringRecord,
  classifyCommsRecord,
} from '../src/cleanup/communications-parser.js';
import { makeRecord } from './fixtures.js';

function extraField(result, field) {
  return result.extraFieldChanges.find((c) => c.field === field);
}

// --- Communicator ---

test('Communicator already in canonical form with a synced Restore Time is already correct', () => {
  const r = classifyCommunicatorRecord(
    makeRecord({ devicetype: 'Communicator', service: 'Restored @ 11:29 AM 5/1/25', restoreTime: '11:29 AM' })
  );
  assert.equal(r.bucket, 'alreadyCorrect');
  assert.equal(r.after, null);
  assert.deepEqual(r.extraFieldChanges, []);
});

test('Communicator messy spacing/casing normalizes to canonical and syncs Restore Time', () => {
  const r = classifyCommunicatorRecord(
    makeRecord({ devicetype: 'Communicator', service: 'restored @11:29am 5/1/25', restoreTime: '' })
  );
  assert.equal(r.bucket, 'safeChange');
  assert.equal(r.after, 'Restored @ 11:29 AM 5/1/25');
  assert.equal(extraField(r, 'restoreTime').after, '11:29 AM');
});

test('Communicator missing a date falls back to Inspection Date, keeping the canonical format', () => {
  const r = classifyCommunicatorRecord(
    makeRecord({ devicetype: 'Communicator', service: 'Restored @ 11:29 AM', inspectionDate: '2025-05-01' })
  );
  assert.equal(r.bucket, 'safeChange');
  assert.equal(r.after, 'Restored @ 11:29 AM 5/1/25');
});

test('Communicator with no time anywhere and no usable date needs review, never invented', () => {
  const r = classifyCommunicatorRecord(makeRecord({ devicetype: 'Communicator', service: 'Restored' }));
  assert.equal(r.bucket, 'needsReview');
  assert.equal(r.after, null);
});

test('Communicator with a time but no date and no Inspection Date fallback needs review', () => {
  const r = classifyCommunicatorRecord(
    makeRecord({ devicetype: 'Communicator', service: 'Restored @ 11:29 AM', inspectionDate: '' })
  );
  assert.equal(r.bucket, 'needsReview');
});

test('Communicator blank Service is left untouched', () => {
  const r = classifyCommunicatorRecord(makeRecord({ devicetype: 'Communicator', service: '' }));
  assert.equal(r.bucket, 'blank');
});

test('Communicator 24-hour time with a redundant trailing am/pm marker and seconds is recognized', () => {
  const r = classifyCommunicatorRecord(
    makeRecord({ devicetype: 'Communicator', service: '8/10/26 15:14:26 pm', restoreTime: '' })
  );
  assert.equal(r.bucket, 'safeChange');
  assert.equal(r.after, 'Restored @ 3:14 PM 8/10/26');
  assert.equal(extraField(r, 'restoreTime').after, '3:14 PM');
});

test('Communicator bare 24-hour time with no am/pm marker at all is still recognized', () => {
  const r = classifyCommunicatorRecord(
    makeRecord({ devicetype: 'Communicator', service: 'Restored @ 15:14 8/10/26' })
  );
  assert.equal(r.bucket, 'safeChange');
  assert.equal(r.after, 'Restored @ 3:14 PM 8/10/26');
});

test('Communicator 24-hour midnight hour (00:xx) converts to 12:xx AM', () => {
  const r = classifyCommunicatorRecord(
    makeRecord({ devicetype: 'Communicator', service: 'Restored @ 00:05 8/10/26' })
  );
  assert.equal(r.after, 'Restored @ 12:05 AM 8/10/26');
});

test('Communicator with correct Service text but a stale Restore Time still needs the attribute synced', () => {
  const r = classifyCommunicatorRecord(
    makeRecord({ devicetype: 'Communicator', service: 'Restored @ 11:29 AM 5/1/25', restoreTime: '9:00 AM' })
  );
  assert.equal(r.bucket, 'safeChange');
  assert.equal(r.after, 'Restored @ 11:29 AM 5/1/25');
  assert.equal(extraField(r, 'restoreTime').after, '11:29 AM');
});

test('Communicator full date+time-with-seconds format is recognized (real-world example)', () => {
  const r = classifyCommunicatorRecord(
    makeRecord({ devicetype: 'Communicator', service: '08/24/2026 10:48:51 AM', restoreTime: '' })
  );
  assert.equal(r.bucket, 'safeChange');
  assert.equal(r.after, 'Restored @ 10:48 AM 8/24/26');
  assert.equal(extraField(r, 'restoreTime').after, '10:48 AM');
});

// --- Communication Line ---

test('Communication Line already "Yes, <time>" is already correct', () => {
  const r = classifyCommunicationLineRecord(
    makeRecord({ devicetype: 'Communication Line', service: 'Yes, 11:02 AM' })
  );
  assert.equal(r.bucket, 'alreadyCorrect');
  assert.deepEqual(r.extraFieldChanges, []);
});

test('Communication Line wrong wording ("Restored @") is cleaned up using the time present', () => {
  const r = classifyCommunicationLineRecord(
    makeRecord({ devicetype: 'Communication Line', service: 'Restored @ 10:10 AM' })
  );
  assert.equal(r.bucket, 'safeChange');
  assert.equal(r.after, 'Yes, 10:10 AM');
});

test('Communication Line messed-up spacing normalizes to canonical', () => {
  const r = classifyCommunicationLineRecord(
    makeRecord({ devicetype: 'Communication Line', service: 'Yes,10:10AM' })
  );
  assert.equal(r.bucket, 'safeChange');
  assert.equal(r.after, 'Yes, 10:10 AM');
});

test('Communication Line with no recognizable time needs review, never guessed', () => {
  const r = classifyCommunicationLineRecord(makeRecord({ devicetype: 'Communication Line', service: 'No' }));
  assert.equal(r.bucket, 'needsReview');
});

test('Communication Line blank Service is left untouched', () => {
  const r = classifyCommunicationLineRecord(makeRecord({ devicetype: 'Communication Line', service: '' }));
  assert.equal(r.bucket, 'blank');
});

test('Communication Line has no device-attribute field to write', () => {
  const r = classifyCommunicationLineRecord(
    makeRecord({ devicetype: 'Communication Line', service: 'restored @ 10:10 am' })
  );
  assert.deepEqual(r.extraFieldChanges, []);
});

// --- Monitoring ---

test('Monitoring already "Yes, <time>" with synced Confirmed Time is already correct', () => {
  const r = classifyMonitoringRecord(
    makeRecord({ devicetype: 'Monitoring', service: 'Yes, 6:11 AM', passed: true, confirmedTime: '6:11 AM' })
  );
  assert.equal(r.bucket, 'alreadyCorrect');
});

test('Monitoring messy passing text normalizes and syncs Confirmed Time', () => {
  const r = classifyMonitoringRecord(
    makeRecord({ devicetype: 'Monitoring', service: 'yes 6:11am', passed: true, confirmedTime: '' })
  );
  assert.equal(r.bucket, 'safeChange');
  assert.equal(r.after, 'Yes, 6:11 AM');
  assert.equal(extraField(r, 'confirmedTime').after, '6:11 AM');
});

test('Monitoring passing normalization clears stale Comment/Solution left over from an earlier failure', () => {
  const r = classifyMonitoringRecord(
    makeRecord({
      devicetype: 'Monitoring',
      service: 'Yes, 6:11 AM',
      passed: true,
      confirmedTime: '6:11 AM',
      comment: 'Failed Test',
      solution: 'See Notes/Recommendations',
    })
  );
  assert.equal(r.bucket, 'safeChange');
  assert.equal(r.after, 'Yes, 6:11 AM'); // service text itself is already correct
  assert.equal(extraField(r, 'comment').after, '');
  assert.equal(extraField(r, 'solution').after, '');
});

test('Monitoring Service already "N/A" is a valid passing value - only Confirmed Time is synced', () => {
  const r = classifyMonitoringRecord(
    makeRecord({ devicetype: 'Monitoring', service: 'N/A', passed: true, confirmedTime: '' })
  );
  assert.equal(r.bucket, 'safeChange');
  assert.equal(r.after, 'N/A');
  assert.equal(extraField(r, 'confirmedTime').after, 'N/A');
});

test('Monitoring "N/A" already fully consistent is already correct', () => {
  const r = classifyMonitoringRecord(
    makeRecord({ devicetype: 'Monitoring', service: 'n/a', passed: true, confirmedTime: 'N/A' })
  );
  assert.equal(r.bucket, 'alreadyCorrect');
});

test('Monitoring unchecked with an explanatory Note fails: N/A / Failed Test / See Notes/Recommendations', () => {
  const r = classifyMonitoringRecord(
    makeRecord({
      devicetype: 'Monitoring',
      service: 'Trouble - line down',
      passed: false,
      note: 'Phone line disconnected by contractor',
      confirmedTime: '',
    })
  );
  assert.equal(r.bucket, 'safeChange');
  assert.equal(r.after, 'N/A');
  assert.equal(extraField(r, 'comment').after, 'Failed Test');
  assert.equal(extraField(r, 'solution').after, 'See Notes/Recommendations');
  assert.equal(extraField(r, 'confirmedTime').after, 'N/A');
  // Note itself is never touched - it already explains the failure.
  assert.equal(extraField(r, 'note'), undefined);
});

test('Monitoring failing state that is already fully correct is already correct, Note still untouched', () => {
  const r = classifyMonitoringRecord(
    makeRecord({
      devicetype: 'Monitoring',
      service: 'N/A',
      passed: false,
      note: 'Phone line disconnected by contractor',
      comment: 'Failed Test',
      solution: 'See Notes/Recommendations',
      confirmedTime: 'N/A',
    })
  );
  assert.equal(r.bucket, 'alreadyCorrect');
});

test('Monitoring failing rule takes priority even if Service already happens to say N/A', () => {
  const r = classifyMonitoringRecord(
    makeRecord({
      devicetype: 'Monitoring',
      service: 'N/A',
      passed: false,
      note: 'Phone line disconnected by contractor',
      confirmedTime: '',
    })
  );
  assert.equal(r.bucket, 'safeChange');
  assert.equal(extraField(r, 'comment').after, 'Failed Test');
});

test('Monitoring unchecked with no Note cannot be safely determined - needs review', () => {
  const r = classifyMonitoringRecord(
    makeRecord({ devicetype: 'Monitoring', service: 'Trouble', passed: false, note: '' })
  );
  assert.equal(r.bucket, 'needsReview');
  assert.equal(r.after, null);
});

test('Monitoring passing with no recognizable time needs review, never guessed', () => {
  const r = classifyMonitoringRecord(
    makeRecord({ devicetype: 'Monitoring', service: 'Confirmed', passed: true })
  );
  assert.equal(r.bucket, 'needsReview');
});

test('Monitoring "Na - no available devices" (real-world example) normalizes to plain N/A', () => {
  const r = classifyMonitoringRecord(
    makeRecord({ devicetype: 'Monitoring', service: 'Na - no available devices', passed: true, confirmedTime: '' })
  );
  assert.equal(r.bucket, 'safeChange');
  assert.equal(r.after, 'N/A');
  assert.equal(extraField(r, 'confirmedTime').after, 'N/A');
});

test('Monitoring "NA" leading-word detection does not false-positive on an unrelated word', () => {
  const r = classifyMonitoringRecord(
    makeRecord({ devicetype: 'Monitoring', service: 'Named line confirmed 6:11 AM', passed: true, confirmedTime: '' })
  );
  // "Named..." starts with "Na" but is not the N/A word - falls through to
  // ordinary time extraction instead of being misread as N/A.
  assert.equal(r.bucket, 'safeChange');
  assert.equal(r.after, 'Yes, 6:11 AM');
});

test('Monitoring full date+time-with-seconds Service normalizes and syncs Confirmed Time (real-world example)', () => {
  const r = classifyMonitoringRecord(
    makeRecord({
      devicetype: 'Monitoring',
      service: '08/24/2026 10:48:51 AM',
      passed: true,
      confirmedTime: '',
    })
  );
  assert.equal(r.bucket, 'safeChange');
  assert.equal(r.after, 'Yes, 10:48 AM');
  assert.equal(extraField(r, 'confirmedTime').after, '10:48 AM');
});

test('Monitoring blank Service is left untouched', () => {
  const r = classifyMonitoringRecord(makeRecord({ devicetype: 'Monitoring', service: '' }));
  assert.equal(r.bucket, 'blank');
});

// --- Dispatcher ---

test('classifyCommsRecord returns null for every other device type', () => {
  assert.equal(classifyCommsRecord(makeRecord({ devicetype: 'Smoke Detector', service: 'Yes, 6:11 AM' })), null);
});

test('classifyCommsRecord dispatches to the right classifier by device type', () => {
  assert.equal(
    classifyCommsRecord(makeRecord({ devicetype: 'Communicator', service: '' })).bucket,
    'blank'
  );
  assert.equal(
    classifyCommsRecord(makeRecord({ devicetype: 'Communication Line', service: 'Yes, 1:00 PM' })).bucket,
    'alreadyCorrect'
  );
  assert.equal(
    classifyCommsRecord(makeRecord({ devicetype: 'Monitoring', service: 'N/A', passed: true, confirmedTime: 'N/A' }))
      .bucket,
    'alreadyCorrect'
  );
});
