import {
  classifyBatteryRecord,
  isFailureOutcome,
  BatteryBucket,
  BatteryOutcome,
} from './rules/battery-cleanup.js';

// Which per-field bucket increments which Preview count. See
// docs/battery-cleanup-rules.md for how to extend this when a new field
// check is added to rules/battery-cleanup.js.
const FIELD_TO_COUNT_KEY = {
  ratedVoltage: 'ratedVoltageFormattingChanges',
  amps: 'ampsFormattingChanges',
  preTest: 'preTestCleared',
  postTest: 'postTestFormattingChanges',
  minAh: 'minAhCorrections',
  testedAh: 'testedAhFormattingChanges',
  modelNumber: 'modelNumberCorrections',
  passed: 'passedCheckboxChanges',
  service: 'serviceChanges',
  comment: 'commentChanges',
  solution: 'solutionChanges',
  note: 'noteChanges',
};

// The 7 "attribute" fields (as opposed to the 5 pass/fail outcome fields
// above) - used to derive Preview's single "Battery attribute changes" total.
const ATTRIBUTE_COUNT_KEYS = [
  'ratedVoltageFormattingChanges',
  'ampsFormattingChanges',
  'preTestCleared',
  'postTestFormattingChanges',
  'minAhCorrections',
  'testedAhFormattingChanges',
  'modelNumberCorrections',
];

const OUTCOME_LABELS = {
  [BatteryOutcome.PASSED]: 'Passed',
  [BatteryOutcome.DATE_EXPIRED]: 'Failed — Date Expired',
  [BatteryOutcome.FAILED_LOAD_TEST]: 'Failed — Failed Load Test',
  [BatteryOutcome.DATE_EXPIRED_AND_FAILED_LOAD_TEST]: 'Failed — Date Expired/Failed Load Test',
  [BatteryOutcome.REVIEW]: 'Requires Review',
};

// Runs Battery Cleanup classification over every device record and produces
// a Preview-style summary plus the list of individual results. Never
// mutates `records`. Unlike runCleanup (Service Cleanup), a single device
// can contribute to several field-change counts at once, so callers should
// read both `totalDevicesAffected` and `totalFieldsAffected`.
//
// `now` (a Date) is the reference point for the Inspection Date expiration
// calculation - defaults to the current moment; pass a fixed value in
// tests. Preview and Apply each call this fresh (see background.js), so
// Apply always re-evaluates expiration against the moment it actually runs.
export function runBatteryCleanup(records, now = new Date()) {
  const initialResults = records.map((record) => classifyBatteryRecord(record, now));
  const results = applyPairedFailures(records, initialResults, now);
  const batteryResults = results.filter((r) => r.isBattery);

  const counts = Object.fromEntries(Object.values(FIELD_TO_COUNT_KEY).map((k) => [k, 0]));

  let alreadyCorrect = 0;
  let devicesRequiringReview = 0;
  let totalFieldsAffected = 0;
  let passingBatteries = 0;
  let dateExpiredCount = 0;
  let failedLoadTestCount = 0;
  let dateExpiredAndFailedLoadTestCount = 0;
  let outcomeRequiresReviewCount = 0;
  let pairedFailureCount = 0;
  const changes = [];

  for (const r of batteryResults) {
    if (r.bucket === BatteryBucket.ALREADY_CORRECT) alreadyCorrect += 1;
    if (r.reviewFlags.length > 0) devicesRequiringReview += 1;
    if (r.pairedFailure) pairedFailureCount += 1;

    switch (r.outcome) {
      case BatteryOutcome.PASSED:
        passingBatteries += 1;
        break;
      case BatteryOutcome.DATE_EXPIRED:
        dateExpiredCount += 1;
        break;
      case BatteryOutcome.FAILED_LOAD_TEST:
        failedLoadTestCount += 1;
        break;
      case BatteryOutcome.DATE_EXPIRED_AND_FAILED_LOAD_TEST:
        dateExpiredAndFailedLoadTestCount += 1;
        break;
      case BatteryOutcome.REVIEW:
        outcomeRequiresReviewCount += 1;
        break;
      default:
        break;
    }

    for (const fc of r.fieldChanges) {
      counts[FIELD_TO_COUNT_KEY[fc.field]] += 1;
      totalFieldsAffected += 1;
    }

    if (r.fieldChanges.length > 0) {
      changes.push({
        scannumber: r.scannumber,
        fields: Object.fromEntries(r.fieldChanges.map((fc) => [fc.field, fc.after])),
        before: Object.fromEntries(r.fieldChanges.map((fc) => [fc.field, fc.before])),
      });
    }
  }

  const batteryAttributeChanges = ATTRIBUTE_COUNT_KEYS.reduce((sum, key) => sum + counts[key], 0);

  return {
    totalDevices: records.length,
    totalBatteryDevicesFound: batteryResults.length,
    alreadyCorrect,
    counts,
    batteryAttributeChanges,
    passingBatteries,
    dateExpiredCount,
    failedLoadTestCount,
    dateExpiredAndFailedLoadTestCount,
    outcomeRequiresReviewCount,
    pairedFailureCount,
    devicesRequiringReview,
    totalDevicesAffected: changes.length,
    totalFieldsAffected,
    results: batteryResults,
    changes,
    reviewItems: batteryResults.filter((r) => r.reviewFlags.length > 0),
    examples: pickExamples(batteryResults),
    outcomeExamples: pickOutcomeExamples(batteryResults),
  };
}

// A battery pair is only inferred when exactly one Left and one Right
// Battery share Floor, Location, Area/Suite, and the rest of the Direction
// and Description text. Ambiguous duplicates are deliberately skipped so a
// cleanup can never fail the wrong device by guessing.
//
// Confirmed live: the Left/Right marker is not reliably in the Direction
// column - real technician entries put it in Description instead
// (Direction held an unrelated building label; Description held "Left
// Battery"/"Right Battery"). So both columns are checked for the marker,
// and whichever one actually has
// it gets its side-word stripped for the match key - the other column is
// compared as plain text. If the marker appears in both columns, or in
// neither, or more than once total, the record is treated as unpaired
// rather than guessed.
function applyPairedFailures(records, initialResults, now) {
  const results = [...initialResults];
  const groups = new Map();

  for (let index = 0; index < records.length; index += 1) {
    if (!initialResults[index].isBattery) continue;
    const direction = parsePairSide(records[index].direction);
    const description = parsePairSide(records[index].description);
    const totalSideWords = direction.count + description.count;
    if (totalSideWords !== 1) continue;
    const side = direction.side || description.side;

    const key = JSON.stringify([
      normalizePairText(records[index].floor),
      direction.stem,
      normalizePairText(records[index].location),
      description.stem,
      normalizePairText(records[index].areasuite),
    ]);
    if (!groups.has(key)) groups.set(key, { left: [], right: [] });
    groups.get(key)[side].push(index);
  }

  for (const group of groups.values()) {
    if (group.left.length !== 1 || group.right.length !== 1) continue;
    const leftIndex = group.left[0];
    const rightIndex = group.right[0];
    const leftOutcome = initialResults[leftIndex].outcome;
    const rightOutcome = initialResults[rightIndex].outcome;

    if (isFailureOutcome(leftOutcome) && !isFailureOutcome(rightOutcome)) {
      results[rightIndex] = classifyBatteryRecord(records[rightIndex], now, {
        forcedFailureOutcome: leftOutcome,
        pairedWithScannumber: initialResults[leftIndex].scannumber,
      });
    } else if (isFailureOutcome(rightOutcome) && !isFailureOutcome(leftOutcome)) {
      results[leftIndex] = classifyBatteryRecord(records[leftIndex], now, {
        forcedFailureOutcome: rightOutcome,
        pairedWithScannumber: initialResults[rightIndex].scannumber,
      });
    }
  }

  return results;
}

function normalizePairText(value) {
  return value == null ? '' : String(value).trim().replace(/\s+/g, ' ').toLowerCase();
}

// Extracts a standalone Left/Right word from a single column's text.
// `count` lets the caller require the marker appear exactly once across
// BOTH the Direction and Description columns combined - `side`/`stem` are
// only meaningful when this column is the one that had it.
function parsePairSide(value) {
  const normalized = normalizePairText(value);
  const sideWords = normalized.match(/\b(?:left|right)\b/g);
  if (!sideWords) return { side: null, stem: normalized, count: 0 };
  return {
    side: sideWords[0],
    stem: normalized.replace(/\b(?:left|right)\b/, '{side}'),
    count: sideWords.length,
  };
}

function pickExamples(batteryResults, limit = 8) {
  const examples = [];
  for (const r of batteryResults) {
    if (r.fieldChanges.length === 0) continue;
    examples.push({
      scannumber: r.scannumber,
      changes: r.fieldChanges.map((fc) => ({ field: fc.field, before: fc.before, after: fc.after })),
    });
    if (examples.length >= limit) break;
  }
  return examples;
}

// Compact "Battery <n> / Inspection Date / Tested Ah / Min Ah / Outcome"
// style entries for Preview - failing and review outcomes are surfaced
// first (most actionable), passing batteries fill any remaining room.
const OUTCOME_EXAMPLE_PRIORITY = [
  BatteryOutcome.DATE_EXPIRED_AND_FAILED_LOAD_TEST,
  BatteryOutcome.DATE_EXPIRED,
  BatteryOutcome.FAILED_LOAD_TEST,
  BatteryOutcome.REVIEW,
  BatteryOutcome.PASSED,
];

function pickOutcomeExamples(batteryResults, limit = 20) {
  const examples = [];
  for (const wanted of OUTCOME_EXAMPLE_PRIORITY) {
    for (const r of batteryResults) {
      if (r.outcome !== wanted) continue;
      if (examples.length >= limit) return examples;
      examples.push({
        scannumber: r.scannumber,
        outcome: r.outcome,
        outcomeLabel: OUTCOME_LABELS[r.outcome] || r.outcome,
        pairedWithScannumber: r.pairedFailure ? r.pairedFailure.sourceScannumber : null,
        inspectionDateDisplay: r.outcomeDetail.inspectionDateDisplay,
        testedAhDisplay: r.outcomeDetail.testedAhDisplay,
        minAhDisplay: r.outcomeDetail.minAhDisplay,
      });
    }
  }
  return examples;
}
