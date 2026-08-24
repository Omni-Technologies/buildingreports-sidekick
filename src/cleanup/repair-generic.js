// Repair/Fixed's generic fallback rule - applies to every device type that
// doesn't have its own specific repair rule yet (see repair-engine.js).
// Deliberately minimal, explicitly requested as a placeholder (2026-08-24):
// mark Passed, canonical "Visual & Functional, Passed" Service text, clear
// Comment/Solution, and let the human type whatever note they want (no
// fixed template, unlike Battery's rule) - stand-in until a real
// pattern/rule is identified for a specific device type and a dedicated
// rule replaces this one for that type (see docs/repair-fixed-rules.md).

import { collapseWhitespace } from '../shared/text-utils.js';

const PASSED_SERVICE = 'Visual & Functional, Passed';

function asStr(value) {
  return value == null ? '' : String(value);
}

// `input` is exactly what the popup's generic form collects: { note: string }.
// Returns { ok: true, writeValue, priorValue, summary } or
// { ok: false, errors } - same shape as buildBatteryRepairChange, so the
// popup's Apply/summary rendering can treat both uniformly where it
// doesn't need device-specific detail.
export function buildGenericRepairChange(record, input) {
  const note = collapseWhitespace(asStr(input && input.note).trim());
  if (!note) {
    return { ok: false, errors: ['A note is required.'] };
  }

  // Appended below whatever's already there, never overwritten - same
  // "preserve history" convention as repair-battery.js's Note handling.
  const existingNote = asStr(record.note).trim();
  const newNote = existingNote ? `${existingNote}\n${note}` : note;

  const writeValue = {
    passed: true,
    comment: '',
    solution: '',
    service: PASSED_SERVICE,
    note: newNote,
  };
  const priorValue = {
    // Kept as a real boolean, not stringified - Undo replays priorValue
    // verbatim as the value to write back (same convention as
    // repair-battery.js / rules/battery-cleanup.js's asDisplayString).
    passed: record.passed,
    comment: asStr(record.comment),
    solution: asStr(record.solution),
    service: asStr(record.service),
    note: asStr(record.note),
  };

  return {
    ok: true,
    writeValue,
    priorValue,
    summary: {
      scannumber: record.scannumber,
      devicetype: record.devicetype,
      noteLine: note,
    },
  };
}
