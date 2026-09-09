// "Copy Email Lists" - builds the two device lists BuildingReports Sidekick
// users manually retype into a customer email after Cleanup + their own
// manual review: every currently-Failed device (grouped/counted, with its
// failure reason) and every non-Failed device that still carries a note
// worth mentioning (Passed-with-notes/Untested). Pure logic - no DOM, no
// chrome.*, unit-tested with plain fixtures (tests/email-summary.test.js).
// The popup (`buildEmailHtml`/`buildEmailPlainText` in popup.js) turns this
// module's output into clipboard content; this file only ever reads
// `records`, never writes anything back to BuildingReports.
//
// Grouping/location rules deliberately reuse the exact same "which column
// carries the standalone Left/Right marker" logic as Battery Cleanup's
// Left/Right pairing (src/cleanup/battery-engine.js's PAIR_COLUMNS/
// parsePairSide) rather than re-deriving it - same five identifying
// columns, same "strip only when the marker appears in exactly one column
// total, otherwise leave the raw text alone" safety rule. See
// docs/battery-cleanup-rules.md for that rule's own history/rationale.
const PAIR_COLUMNS = ['floor', 'direction', 'location', 'description', 'areasuite'];

function normalizeText(value) {
  return value == null ? '' : String(value).trim().replace(/\s+/g, ' ');
}

function nonBlank(value) {
  return normalizeText(value).length > 0;
}

// Per-column Left/Right marker extraction. Unlike battery-engine.js's
// parsePairSide (which only needs a case-insensitive comparison key), this
// also needs a case-PRESERVING display stem, since the stripped text is
// what actually ends up in the email.
function parseColumnSide(value) {
  const trimmed = normalizeText(value);
  const sideWords = trimmed.toLowerCase().match(/\b(?:left|right)\b/g);
  if (!sideWords) return { side: null, displayStem: trimmed, count: 0 };
  return {
    side: sideWords[0],
    displayStem: normalizeText(trimmed.replace(/\b(?:left|right)\b/i, '')),
    count: sideWords.length,
  };
}

// Only strips the Left/Right word when it appears in exactly one of the
// five columns total (matching Battery Cleanup's own pairing safety rule -
// see PAIR_COLUMNS comment above) - otherwise every column's raw text is
// used untouched and `side` is null, same as an unpaired/ambiguous record.
function locationPartsAndSide(record) {
  const perColumn = PAIR_COLUMNS.map((field) => parseColumnSide(record[field]));
  const totalSideWords = perColumn.reduce((sum, c) => sum + c.count, 0);
  if (totalSideWords === 1) {
    const side = perColumn.find((c) => c.count === 1).side;
    return { parts: perColumn.map((c) => c.displayStem), side };
  }
  return { parts: PAIR_COLUMNS.map((field) => normalizeText(record[field])), side: null };
}

// Standard English pluralization (consonant+y -> ies, sibilant endings ->
// es, otherwise +s). Deliberately a general rule rather than a per-device-
// type dictionary - "Battery" -> "Batteries" falls straight out of the
// consonant+y case with no special-casing needed. If a real device type or
// reason phrase is ever found that this rule gets wrong, add a narrow
// override here then - same "never guess, add as identified" approach as
// the Manufacturer dictionary in rules/battery-cleanup.js.
export function pluralize(word) {
  if (!word) return word;
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  if (/(?:s|x|z|ch|sh)$/i.test(word)) return `${word}es`;
  return `${word}s`;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Pluralizes a whole-word, case-sensitive occurrence of the singular device
// type inside its own reason text (e.g. "Failed Load Test - Replace
// Battery" -> "...Replace Batteries") - a no-op when the reason text
// doesn't happen to mention the device type by name (e.g. "Unable To Test -
// Device Currently Not In Service For Upgrade/Replacement").
function pluralizeReasonText(reasonText, deviceType) {
  if (!deviceType) return reasonText;
  const pattern = new RegExp(`\\b${escapeRegExp(deviceType)}\\b`, 'g');
  return reasonText.replace(pattern, pluralize(deviceType));
}

// The reason line each bullet's sub-bullet shows. Note wins when present
// (this is where Battery Cleanup's own failure/replacement wording already
// lives, and where a technician's free-text "Unable To Test - ..." note
// goes) - Comment/Solution are only a fallback for a device type this tool
// has no dedicated rule for, joined the same way Battery Cleanup's own
// fields read on screen. Returns '' (never null) when there's nothing to
// build a reason from.
function buildReasonText(record) {
  const note = normalizeText(record.note);
  if (note) return note;
  const comment = normalizeText(record.comment);
  const solution = normalizeText(record.solution);
  if (comment && solution) return `${comment} - ${solution}`;
  return comment || solution;
}

function groupKey(deviceType, modelNumber, locationText, reasonText) {
  return JSON.stringify([deviceType, modelNumber, locationText, reasonText]);
}

// Groups records sharing the same device type + model number + location
// text + reason text into one bullet, tracking every side seen in the
// group so a Left+Right pair (or several) can be labeled as such.
function groupRecords(records) {
  const groups = new Map();
  for (const record of records) {
    const deviceType = normalizeText(record.devicetype);
    const modelNumber = normalizeText(record.modelnumber);
    const reasonText = buildReasonText(record);
    const { parts, side } = locationPartsAndSide(record);
    const locationText = parts.filter(nonBlank).join(' ');
    const key = groupKey(deviceType, modelNumber, locationText, reasonText);
    if (!groups.has(key)) {
      groups.set(key, { deviceType, modelNumber, locationText, reasonText, scannumbers: [], sides: [] });
    }
    const group = groups.get(key);
    group.scannumbers.push(record.scannumber);
    group.sides.push(side);
  }
  return [...groups.values()];
}

function finalizeGroup(group) {
  const count = group.scannumbers.length;
  const hasLeft = group.sides.includes('left');
  const hasRight = group.sides.includes('right');
  const deviceType = count > 1 ? pluralize(group.deviceType) : group.deviceType;
  const reasonText = count > 1 ? pluralizeReasonText(group.reasonText, group.deviceType) : group.reasonText;
  const locationText = hasLeft && hasRight ? `${group.locationText} Left And Right ${pluralize(group.deviceType)}`.trim() : group.locationText;
  return {
    count,
    deviceType,
    modelNumber: group.modelNumber,
    locationText,
    reasonText,
    scannumbers: group.scannumbers,
  };
}

// Builds the two grouped device lists from every record currently in the
// report (not just what Service/Battery Cleanup flagged - this is an
// independent, always-fresh, read-only scan). `failed` = every device
// marked Failed (`passed === false`) with a usable reason; a Failed device
// with no Note/Comment/Solution to build a reason from is never guessed at
// - it's surfaced in `needsReview` instead so the human notices it.
// `passedWithNotes` = every device NOT marked Failed (Passed, or Untested -
// anything where `passed !== false`) that still carries a non-blank
// reason - the "Passed/Untested With Notes" list.
export function buildEmailSummary(records) {
  const failedRecords = [];
  const passedWithNotesRecords = [];
  const needsReview = [];

  for (const record of records) {
    const reasonText = buildReasonText(record);
    if (record.passed === false) {
      if (!reasonText) {
        needsReview.push({
          scannumber: record.scannumber,
          devicetype: record.devicetype,
          reason: 'Failed device has no Comment/Solution/Note to build a reason from',
        });
        continue;
      }
      failedRecords.push(record);
    } else if (reasonText) {
      passedWithNotesRecords.push(record);
    }
  }

  return {
    failed: groupRecords(failedRecords).map(finalizeGroup),
    passedWithNotes: groupRecords(passedWithNotesRecords).map(finalizeGroup),
    needsReview,
  };
}
