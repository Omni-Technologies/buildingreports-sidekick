// Annual inspection profile: rules for the "Clean Up Service Entries" action.
//
// To add or change Annual rules, edit this file only. See docs/adding-a-rule.md
// and docs/cleanup-rules.md for the full explanation of each list below.

import { normalizeDeviceTypeKey } from '../../shared/text-utils.js';

// Device types that normally get "Visual & Functional, Passed/Failed".
// Matching is conservative: exact match after tolerant normalization
// (case, whitespace, slash-spacing, parenthetical-spacing) only - never
// substring/fuzzy matching.
const SUPPORTED_DEVICE_TYPES = [
  'Alarm Device',
  'Annunciator',
  'Battery',
  'Beam Detector',
  'Bell/Strobe',
  'Carbon Dioxide (CO2)',
  'Chime/Strobe',
  'Control Panel',
  'Damper Control',
  'Disconnect',
  'Duct Detector',
  'Elevator',
  'Emergency Power Off',
  'Expander Panel',
  'Fan Running',
  'Fan Shutdown',
  'Fan Start',
  'Fire Barrier',
  'Gas Shutdown',
  'Generator Running',
  'Handset',
  'Heat Detector',
  'Horn',
  'Horn/Strobe',
  'Indicating Device',
  'Initiating Device',
  'Locking Device',
  'Module',
  'Monitor Device',
  'Phone Jack',
  'Power Supply',
  'Printer',
  'Programmable Relay',
  'Pull Station',
  'Releasing Device',
  'Remote Test Switch',
  'Roll Down Door',
  'Smoke Detector',
  'Speaker',
  'Speaker/Strobe',
  'Special Control',
  'Strobe',
  'Voice Evacuation',
];

const SUPPORTED_DEVICE_TYPE_KEYS = new Set(
  SUPPORTED_DEVICE_TYPES.map(normalizeDeviceTypeKey)
);

// Free-text values that carry real information and must never be
// overwritten by the standard-result rewrite, even though they don't
// contain a Passed/Failed token BuildingReports itself understands.
// Matched as the whole value or a clear leading phrase, case-insensitive.
const PRESERVE_PHRASES = [
  'Not Tested',
  'Unable To Test',
  'Tested By Others',
  'No Access',
  'See On-Site Service Records',
];

const ONE_HITTER_PATTERN = /\bone[\s-]?hitter\b/i;
// Weak/ambiguous variant spotted in the wild ("1 hitter", "1-hitter") -
// not confident enough to auto-apply the exception, but worth flagging.
const AMBIGUOUS_ONE_HITTER_PATTERN = /\b1[\s-]?hitter\b/i;

export const annualProfile = {
  key: 'annual',
  label: 'Annual',
  enabled: true,
  supportedDeviceTypeKeys: SUPPORTED_DEVICE_TYPE_KEYS,
  supportedDeviceTypes: SUPPORTED_DEVICE_TYPES,
  preservePhrases: PRESERVE_PHRASES,
  standardPhrase: 'Visual & Functional',
  oneHitterPhrase: 'Visual',
  oneHitterPattern: ONE_HITTER_PATTERN,
  ambiguousOneHitterPattern: AMBIGUOUS_ONE_HITTER_PATTERN,
  // Annual-only: a Heat Detector whose Service already says "Visual,
  // Passed/Failed" (no "& Functional") is a deliberate restorable/
  // non-restorable signal from the technician, not an un-normalized value -
  // classify.js preserves the Visual-only prefix instead of upgrading it,
  // and syncs the Restorable device-attribute checkbox to match (checked
  // for "Visual & Functional", unchecked for Visual-only - either from
  // this signal or a confirmed One Hitter marker). Semi-Annual doesn't set
  // this (Heat Detector there is always Visual-only already - see
  // semi-annual.js), so it's unaffected. See docs/cleanup-rules.md.
  heatDetectorVisualOnlyPreserved: true,
};
