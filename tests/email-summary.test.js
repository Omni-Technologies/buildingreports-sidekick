import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEmailSummary, pluralize } from '../src/cleanup/email-summary.js';
import { makeRecord } from './fixtures.js';

// A real-world-shaped Left/Right Battery pair - same location, same
// modelnumber, same reason, differing only by a standalone Left/Right word
// (here in `direction`, though the code doesn't care which of the five
// identifying columns actually carries it - see battery-engine.js's own
// PAIR_COLUMNS comment: which column varies by report).
function makeFailedBatteryPair(overrides = {}) {
  const base = {
    devicetype: 'Battery',
    modelnumber: '12V-7Ah',
    floor: '6th Floor',
    description: 'Pulmonary Diagnostics IT Closet FCPS Side Rm A6-UC3',
    passed: false,
    note: 'Failed Load Test - Replace Battery',
    ...overrides,
  };
  return [
    makeRecord({ ...base, scannumber: 'b-left', direction: 'Left' }),
    makeRecord({ ...base, scannumber: 'b-right', direction: 'Right' }),
  ];
}

test('pluralize handles the standard cases this feature actually needs', () => {
  assert.equal(pluralize('Battery'), 'Batteries');
  assert.equal(pluralize('Annunciator'), 'Annunciators');
  assert.equal(pluralize('Smoke Detector'), 'Smoke Detectors');
  assert.equal(pluralize('Switch'), 'Switches');
});

test('a Left/Right Battery pair groups into one bullet, counted, pluralized, with the suffix appended', () => {
  const records = makeFailedBatteryPair();
  const summary = buildEmailSummary(records);
  assert.equal(summary.failed.length, 1);
  const group = summary.failed[0];
  assert.equal(group.count, 2);
  assert.equal(group.deviceType, 'Batteries');
  assert.equal(group.modelNumber, '12V-7Ah');
  assert.equal(group.reasonText, 'Failed Load Test - Replace Batteries');
  assert.equal(group.locationText, '6th Floor Pulmonary Diagnostics IT Closet FCPS Side Rm A6-UC3 Left And Right Batteries');
  assert.deepEqual(group.scannumbers.sort(), ['b-left', 'b-right']);
});

test('two separate Left/Right pairs at the same location+reason combine into one (4)-count bullet', () => {
  const pairA = makeFailedBatteryPair();
  const pairB = makeFailedBatteryPair();
  pairB[0].scannumber = 'b-left-2';
  pairB[1].scannumber = 'b-right-2';
  const records = [...pairA, ...pairB];
  const summary = buildEmailSummary(records);
  assert.equal(summary.failed.length, 1);
  assert.equal(summary.failed[0].count, 4);
  assert.match(summary.failed[0].locationText, /Left And Right Batteries$/);
});

test('a single non-battery Failed device with a Model Number gets its own unpluralized bullet', () => {
  const records = [
    makeRecord({
      scannumber: 's1',
      devicetype: 'Smoke Detector',
      modelnumber: 'SIGA-PS',
      floor: '1st Floor',
      location: 'HallWay',
      passed: false,
      note: 'Failed Sensitivity Test - Clean And Retest',
    }),
  ];
  const summary = buildEmailSummary(records);
  assert.equal(summary.failed.length, 1);
  const group = summary.failed[0];
  assert.equal(group.count, 1);
  assert.equal(group.deviceType, 'Smoke Detector');
  assert.equal(group.modelNumber, 'SIGA-PS');
  assert.equal(group.locationText, '1st Floor HallWay');
  assert.equal(group.reasonText, 'Failed Sensitivity Test - Clean And Retest');
});

test('a Failed device with no Note/Comment/Solution is flagged needsReview, never guessed', () => {
  const records = [makeRecord({ scannumber: 's2', devicetype: 'Strobe', passed: false })];
  const summary = buildEmailSummary(records);
  assert.equal(summary.failed.length, 0);
  assert.equal(summary.needsReview.length, 1);
  assert.equal(summary.needsReview[0].scannumber, 's2');
});

test('Comment+Solution is used as a fallback reason when Note is blank', () => {
  const records = [
    makeRecord({
      scannumber: 's3',
      devicetype: 'Pull Station',
      passed: false,
      comment: 'Broken Handle',
      solution: 'Replace Station',
    }),
  ];
  const summary = buildEmailSummary(records);
  assert.equal(summary.failed.length, 1);
  assert.equal(summary.failed[0].reasonText, 'Broken Handle - Replace Station');
});

test('a Passed device with a non-blank Note lands in passedWithNotes, not failed', () => {
  const records = [
    makeRecord({
      scannumber: 'a1',
      devicetype: 'Annunciator',
      floor: '1st Floor',
      location: 'Engineering Shop Main Area By Offices',
      passed: true,
      note: 'Unable To Test - Device Currently Not In Service For Upgrade/Replacement',
    }),
  ];
  const summary = buildEmailSummary(records);
  assert.equal(summary.failed.length, 0);
  assert.equal(summary.passedWithNotes.length, 1);
  assert.equal(summary.passedWithNotes[0].deviceType, 'Annunciator');
  assert.equal(summary.passedWithNotes[0].locationText, '1st Floor Engineering Shop Main Area By Offices');
});

test('an Untested device (passed !== true and !== false) with a note also lands in passedWithNotes', () => {
  const records = [makeRecord({ scannumber: 'u1', devicetype: 'Battery', passed: null, note: 'Device Not Accessible' })];
  const summary = buildEmailSummary(records);
  assert.equal(summary.passedWithNotes.length, 1);
});

test('a Passed device with no notes at all is excluded from both lists entirely', () => {
  const records = [makeRecord({ scannumber: 'p1', devicetype: 'Strobe', passed: true })];
  const summary = buildEmailSummary(records);
  assert.equal(summary.failed.length, 0);
  assert.equal(summary.passedWithNotes.length, 0);
  assert.equal(summary.needsReview.length, 0);
});

test('reason-text pluralization only touches whole-word matches of the device type, leaving unrelated text alone', () => {
  const records = [
    makeRecord({ scannumber: 'a1', devicetype: 'Annunciator', floor: '1F', location: 'Room', passed: true, note: 'Unable To Test - Device Currently Not In Service' }),
    makeRecord({ scannumber: 'a2', devicetype: 'Annunciator', floor: '1F', location: 'Room', passed: true, note: 'Unable To Test - Device Currently Not In Service' }),
  ];
  const summary = buildEmailSummary(records);
  assert.equal(summary.passedWithNotes.length, 1);
  assert.equal(summary.passedWithNotes[0].count, 2);
  assert.equal(summary.passedWithNotes[0].deviceType, 'Annunciators');
  assert.equal(summary.passedWithNotes[0].reasonText, 'Unable To Test - Device Currently Not In Service');
});

test('buildEmailSummary never mutates input records', () => {
  const records = makeFailedBatteryPair();
  const snapshot = JSON.parse(JSON.stringify(records));
  buildEmailSummary(records);
  assert.deepEqual(records, snapshot);
});

test('an unmarked Battery pair with the stock test description merges, drops the boilerplate, and ends "Left And Right Batteries"', () => {
  const base = {
    devicetype: 'Battery',
    modelnumber: '12V-7Ah',
    floor: '1st Floor',
    location: 'Main Entrance FACP',
    description: 'Battery Simulated 30 Minute Load Voltage/Discharge Tests',
    passed: false,
    note: 'Date Expired - Replace Battery',
  };
  const summary = buildEmailSummary([
    makeRecord({ ...base, scannumber: 'p1' }),
    makeRecord({ ...base, scannumber: 'p2', note: 'date expired – replace battery ' }),
  ]);
  assert.equal(summary.failed.length, 1);
  const group = summary.failed[0];
  assert.equal(group.count, 2);
  assert.equal(group.deviceType, 'Batteries');
  assert.equal(group.locationText, '1st Floor Main Entrance FACP Left And Right Batteries');
  assert.equal(group.reasonText, 'Date Expired - Replace Batteries');
});

test('a lone Battery drops the stock test description and ends "Single Battery"', () => {
  const summary = buildEmailSummary([
    makeRecord({
      scannumber: 's1',
      devicetype: 'Battery',
      modelnumber: '12V-18Ah',
      floor: '2nd Floor',
      location: 'Elevator Room',
      description: 'Battery Simulated 30 Minute Load Voltage/Discharge Tests',
      passed: false,
      note: 'Failed Load Test - Replace Battery',
    }),
  ]);
  const group = summary.failed[0];
  assert.equal(group.count, 1);
  assert.equal(group.deviceType, 'Battery');
  assert.equal(group.locationText, '2nd Floor Elevator Room Single Battery');
  assert.equal(group.reasonText, 'Failed Load Test - Replace Battery');
});

test('a live-shaped Battery pair with different causes per side merges and combines the causes', () => {
  const base = {
    devicetype: 'Battery',
    modelnumber: '12V-7Ah',
    floor: '1st Floor',
    direction: 'Main Entrance',
    areasuite: 'Simulated 30 Minute Load Voltage/Discharge Tests',
    passed: false,
    comment: 'Date Expired',
    solution: 'Replace Battery',
  };
  const summary = buildEmailSummary([
    makeRecord({ ...base, scannumber: 'l', location: 'FACP Left Battery', note: 'Date Expired - Replace Battery' }),
    makeRecord({ ...base, scannumber: 'r', location: 'FACP Right Battery', note: 'Date Expired/Failed Load Test - Replace Battery' }),
    makeRecord({ ...base, scannumber: 'x', location: 'BPS Panel Left Battery', note: 'Date Expired/Failed Load Test - Replace Battery' }),
  ]);
  assert.equal(summary.failed.length, 2);
  const [facp, bps] = summary.failed;
  assert.equal(facp.count, 2);
  assert.equal(facp.locationText, '1st Floor Main Entrance FACP Left And Right Batteries');
  assert.equal(facp.reasonText, 'Date Expired/Failed Load Test - Replace Batteries');
  assert.equal(bps.count, 1);
  assert.equal(bps.locationText, '1st Floor Main Entrance BPS Panel Single Battery');
  assert.equal(bps.reasonText, 'Date Expired/Failed Load Test - Replace Battery');
});
