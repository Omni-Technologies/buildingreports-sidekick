// Small text helpers shared by the cleanup engine and site adapters.
// No DOM or Ext dependency here so this file can run in Node tests unmodified.

export function collapseWhitespace(str) {
  return str.replace(/\s+/g, ' ').trim();
}

// Normalizes a device-type string for tolerant lookup: case, whitespace,
// slash-spacing ("Bell/Strobe" vs "Bell / Strobe"), and parenthetical
// spacing ("Carbon Dioxide (CO2)" vs "Carbon Dioxide(CO2)") differences
// are ignored. This is deliberately NOT fuzzy/substring matching -
// anything that doesn't collapse to an exact known key is left alone.
export function normalizeDeviceTypeKey(deviceType) {
  if (!deviceType) return '';
  return collapseWhitespace(deviceType)
    .toLowerCase()
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s*\(\s*/g, ' (')
    .replace(/\s*\)\s*/g, ')')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isBlank(value) {
  return value == null || collapseWhitespace(String(value)) === '';
}
