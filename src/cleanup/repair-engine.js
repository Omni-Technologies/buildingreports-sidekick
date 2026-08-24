// Repair/Fixed - report-level orchestration: scans a report for devices
// currently marked Failed (Passed unchecked) and identifies which of them
// have a device-type-specific repair rule, if any. See
// docs/repair-fixed-rules.md for the full design and docs/adding-a-rule.md
// for how to add the next device type's rule.
//
// Unlike Clean Up Service Entries / Battery Cleanup, Repair/Fixed is
// deliberately NOT a classify-everything-automatically pass - every device
// needs an explicit "was this repaired?" answer from a human (see
// docs/repair-fixed-rules.md for why), so this module only ever does the
// read-only "which devices need asking about, and does a rule exist for
// each" part. The actual field-change computation (once a human says yes
// and fills in a device-specific form) lives in each rule file, e.g.
// repair-battery.js's buildBatteryRepairChange - this module just knows
// WHICH rule a given device type has, if any.

import { isBattery } from './rules/battery-cleanup.js';

// Add the next device type's repair rule here once one exists - see
// docs/repair-fixed-rules.md "How to add the next device type's rule".
// `ruleKey` is a short label the popup uses to decide which form to show;
// it never has to match devicetype text itself (same tolerant-matching
// convention as every other device-type check in this codebase - lookup is
// always via the `matches` predicate).
const REPAIR_RULES = [{ matches: isBattery, ruleKey: 'battery' }];

// Returns the ruleKey for a device type that has a Repair/Fixed rule, or
// null if none exists yet - the popup offers only the generic Yes/No +
// "flag for manual review" path for a null result.
export function getRepairRuleKey(deviceType) {
  const hit = REPAIR_RULES.find((r) => r.matches(deviceType));
  return hit ? hit.ruleKey : null;
}

// Scans every record for ones currently marked Failed (Passed unchecked) -
// Repair/Fixed only ever asks about devices that need it, never the whole
// report (see docs/repair-fixed-rules.md "Device scope"). Preserves report
// order (the same order `records` already comes in, i.e. #devicelistGrid's
// store order - "in order by device").
export function scanFailedDevices(records) {
  return records
    .filter((r) => r.passed === false)
    .map((record) => ({
      scannumber: record.scannumber,
      devicetype: record.devicetype,
      service: record.service,
      ruleKey: getRepairRuleKey(record.devicetype),
      record,
    }));
}
