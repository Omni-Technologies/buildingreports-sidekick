// Repair/Fixed's Battery rule - pure logic, no DOM/Ext/chrome dependency,
// runs under plain `node --test` (see tests/repair-battery.test.js) and is
// also imported directly into the popup (src/popup/popup.js), since the
// wizard needs to build each device's write payload the moment its form is
// submitted, without a round-trip through background.js. See
// docs/repair-fixed-rules.md for the full rule reference.
//
// Unlike Battery Cleanup (rules/battery-cleanup.js), this never classifies
// automatically - every field here is either user-supplied (Amps, Install
// Date, Tech, Company) or a fixed constant (Post Test/Tested Ah reset to
// 0.00, Passed/Service/Comment/Solution set to their passing values) or
// derived from the user-supplied Amps via the exact same formulas Battery
// Cleanup itself uses (parseNumericField/formatTwoDecimals/trimTrailingZeros/
// MIN_AH_FACTOR, imported from rules/battery-cleanup.js - never a second
// hand-rolled copy).

import { isBlank, collapseWhitespace } from '../shared/text-utils.js';
import {
  parseNumericField,
  formatTwoDecimals,
  trimTrailingZeros,
  MIN_AH_FACTOR,
  VOLTAGE_UNIT_PATTERN,
} from './rules/battery-cleanup.js';

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

// Parses this extension's own "YYYY-MM-DD" date convention (the same shape
// an HTML <input type="date"> gives, and the same shape adapter.js's
// toLocalDateOnlyString produces for installDate on read) into
// { year, month, day }, or null if it isn't a real calendar date.
function parseIsoDateOnly(value) {
  if (isBlank(value)) return null;
  const m = DATE_ONLY_PATTERN.exec(String(value).trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return { year, month, day };
}

// "M/D/YY" - no leading zeros, 2-digit year - matching the exact real-world
// convention confirmed live in existing Note history text ("...Battery
// Replaced By ... - 8/6/25") and Communicator's date format
// (communications-parser.js).
function formatDateShort({ year, month, day }) {
  return `${month}/${day}/${String(year).slice(-2)}`;
}

function asStr(value) {
  return value == null ? '' : String(value);
}

// Builds the write payload for a single Battery's repair/replacement.
// `record` is the device's current plain record (semantic field names,
// same shape classifyBatteryRecord takes). `input` is exactly what the
// popup's form collects:
//   { amps: string, installDate: "YYYY-MM-DD" string, tech: string, company: string }
//
// Deliberately NOT asked/changed: Rated Voltage (stays exactly as whatever
// is already on the record - "always 12.00, filled in same" per the rule
// request). Fixed, never asked: Post Test -> "0.00", Tested Ah -> "0.00"
// (the new battery hasn't been re-tested yet - this is exactly the
// 0.00/0.00 "already completed" placeholder Battery Cleanup's load-test
// exception recognizes), Passed -> checked, Comment/Solution -> cleared,
// Service -> "Visual & Functional, Passed". Derived, never asked: Min Ah
// (Amps x MIN_AH_FACTOR) and Model Number (from Rated Voltage + the new
// Amps), both via the exact same formulas Battery Cleanup uses. Note gets
// a new line appended below whatever's already there (never overwritten -
// existing history, e.g. a prior "Failed Load Test - Replace Battery" line
// from Battery Cleanup, is preserved).
//
// Returns { ok: true, writeValue, priorValue, summary } or
// { ok: false, errors: [string, ...] } - never partially valid; the popup
// should keep the form open and show `errors` rather than submit anything
// on failure.
export function buildBatteryRepairChange(record, input) {
  const errors = [];

  const ampsParsed = parseNumericField(input && input.amps);
  if (ampsParsed.state === 'blank') errors.push('Amps is required.');
  else if (ampsParsed.state === 'invalid' || ampsParsed.value < 0) {
    errors.push('Amps must be a valid non-negative number.');
  }

  const dateParsed = parseIsoDateOnly(input && input.installDate);
  if (!dateParsed) errors.push('A valid replacement/repair date is required.');

  const tech = collapseWhitespace(asStr(input && input.tech).trim());
  if (!tech) errors.push('Technician/customer name is required.');

  const company = collapseWhitespace(asStr(input && input.company).trim());
  if (!company) errors.push('Company name is required.');

  if (errors.length > 0) return { ok: false, errors };

  const amps = ampsParsed.value;
  const ampsFormatted = formatTwoDecimals(amps);
  const minAhFormatted = formatTwoDecimals(amps * MIN_AH_FACTOR);

  // Model Number still needs Rated Voltage to derive "<V>V-<Ah>Ah" - if
  // it's somehow missing/invalid on the existing record, Model Number is
  // left untouched rather than guessed (same convention as Battery
  // Cleanup's own Model Number rule).
  const ratedVoltageParsed = parseNumericField(record.ratedVoltage, VOLTAGE_UNIT_PATTERN);
  const modelNumber = ratedVoltageParsed.state === 'valid'
    ? `${trimTrailingZeros(ratedVoltageParsed.value)}V-${trimTrailingZeros(amps)}Ah`
    : null;

  const isoDate = `${dateParsed.year}-${String(dateParsed.month).padStart(2, '0')}-${String(dateParsed.day).padStart(2, '0')}`;
  const dateDisplay = formatDateShort(dateParsed);

  const existingNote = asStr(record.note).trim();
  const repairLine = `Battery Replaced By ${tech} With ${company} - ${dateDisplay}`;
  const newNote = existingNote ? `${existingNote}\n${repairLine}` : repairLine;

  const writeValue = {
    amps: ampsFormatted,
    postTest: '0.00',
    testedAh: '0.00',
    minAh: minAhFormatted,
    installDate: isoDate,
    passed: true,
    comment: '',
    solution: '',
    service: 'Visual & Functional, Passed',
    note: newNote,
  };
  const priorValue = {
    amps: asStr(record.amps),
    postTest: asStr(record.postTest),
    testedAh: asStr(record.testedAh),
    minAh: asStr(record.minAh),
    installDate: asStr(record.installDate),
    // Kept as a real boolean, not stringified - Undo replays priorValue
    // verbatim as the value to write back, and BuildingReports' `passed`
    // dataIndex is genuinely boolean-typed (same convention as
    // rules/battery-cleanup.js's asDisplayString).
    passed: record.passed,
    comment: asStr(record.comment),
    solution: asStr(record.solution),
    service: asStr(record.service),
    note: asStr(record.note),
  };
  if (modelNumber != null) {
    writeValue.modelNumber = modelNumber;
    priorValue.modelNumber = asStr(record.modelNumber);
  }

  return {
    ok: true,
    writeValue,
    priorValue,
    summary: {
      scannumber: record.scannumber,
      devicetype: record.devicetype,
      amps: ampsFormatted,
      minAh: minAhFormatted,
      modelNumber,
      installDate: dateDisplay,
      tech,
      company,
      noteLine: repairLine,
    },
  };
}
