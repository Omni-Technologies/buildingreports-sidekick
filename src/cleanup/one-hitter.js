// Detects the "One Hitter" designation on a Heat Detector device record.
// BuildingReports has no dedicated field for this - installers note it in
// free-text fields (Description, Location, Direction, Comment, Note,
// Solution, Model Number, or the Service text itself). See
// docs/buildingreports-dom-map.md for where these were confirmed.

const FIELDS_TO_SCAN = [
  'description',
  'location',
  'direction',
  'comment',
  'note',
  'solution',
  'modelnumber',
  'service',
];

// Returns 'confirmed' when a clear "One Hitter" marker is found, 'ambiguous'
// when a weaker variant is found (e.g. "1 hitter") that isn't confident
// enough to auto-apply the exception, or 'none' otherwise.
export function detectOneHitter(record, profile) {
  if (!profile.oneHitterPattern) return 'none';
  let ambiguous = false;
  for (const field of FIELDS_TO_SCAN) {
    const value = record[field];
    if (!value) continue;
    if (profile.oneHitterPattern.test(value)) return 'confirmed';
    if (profile.ambiguousOneHitterPattern && profile.ambiguousOneHitterPattern.test(value)) {
      ambiguous = true;
    }
  }
  return ambiguous ? 'ambiguous' : 'none';
}
