// Repair/Fixed - report-level orchestration: scans a report for devices
// currently marked Failed (Passed unchecked) and identifies which
// device-type-specific repair rule applies to each, falling back to the
// generic rule for any device type that doesn't have its own yet. See
// docs/repair-fixed-rules.md for the full design and docs/adding-a-rule.md
// for how to add the next device type's rule.
//
// Unlike Clean Up Service Entries / Battery Cleanup, Repair/Fixed is
// deliberately NOT a classify-everything-automatically pass - every device
// needs an explicit "was this repaired?" answer from a human (see
// docs/repair-fixed-rules.md for why), so this module only ever does the
// read-only "which devices need asking about, and which rule applies to
// each" part. The actual field-change computation (once a human says yes
// and fills in a form) lives in each rule file, e.g. repair-battery.js's
// buildBatteryRepairChange or repair-generic.js's buildGenericRepairChange
// - this module just knows WHICH rule a given device type gets.

import { isBattery } from './rules/battery-cleanup.js';

// Add the next device type's repair rule here once a real pattern emerges
// for it - see docs/repair-fixed-rules.md "How to add the next device
// type's rule". `ruleKey` is a short label the popup uses to decide which
// form to show; it never has to match devicetype text itself (same
// tolerant-matching convention as every other device-type check in this
// codebase - lookup is always via the `matches` predicate). Anything not
// matched here falls through to `'generic'` (repair-generic.js) rather
// than a device-type-specific rule.
const REPAIR_RULES = [{ matches: isBattery, ruleKey: 'battery' }];

export const GENERIC_REPAIR_RULE_KEY = 'generic';

// Returns the ruleKey for a device type - one of the specific keys in
// REPAIR_RULES above, or GENERIC_REPAIR_RULE_KEY as the universal
// fallback (2026-08-24, explicitly requested: every device type gets at
// least the generic Passed/Service/Comment/Solution/Note treatment until a
// real pattern is identified and a dedicated rule replaces it for that
// type - never a "no rule, flag for review only" dead end).
export function getRepairRuleKey(deviceType) {
  const hit = REPAIR_RULES.find((r) => r.matches(deviceType));
  return hit ? hit.ruleKey : GENERIC_REPAIR_RULE_KEY;
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
