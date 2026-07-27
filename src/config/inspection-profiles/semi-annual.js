// Semi-Annual inspection profile: rules for the "Clean Up Service Entries"
// action. Reuses the Annual profile's supported-device list and preserve
// phrases wholesale (Semi-Annual inspects the same device types Annual
// does - see docs/cleanup-rules.md) and only changes which canonical
// prefix ("Visual & Functional" vs "Visual") applies to which device type.
//
// To add or change Semi-Annual rules, edit this file only. See
// docs/adding-a-rule.md and docs/cleanup-rules.md for the full explanation.

import { normalizeDeviceTypeKey } from '../../shared/text-utils.js';
import { annualProfile } from './annual.js';

// The only five device types that get "Visual & Functional, Passed/Failed"
// under Semi-Annual. Every other Annual-supported device type instead gets
// the Visual-only phrase (see semiAnnualProfile.standardPhrase below).
const VISUAL_FUNCTIONAL_DEVICE_TYPES = [
  'Annunciator',
  'Battery',
  'Control Panel',
  'Indicating Device',
  'Power Supply',
];

const VISUAL_FUNCTIONAL_DEVICE_TYPE_KEYS = new Set(
  VISUAL_FUNCTIONAL_DEVICE_TYPES.map(normalizeDeviceTypeKey)
);

export const semiAnnualProfile = {
  key: 'semi-annual',
  label: 'Semi-Annual',
  enabled: true,
  // Same supported-device list as Annual, imported rather than duplicated -
  // Semi-Annual doesn't add or remove which device types are recognized,
  // only which prefix each one gets (see below).
  supportedDeviceTypeKeys: annualProfile.supportedDeviceTypeKeys,
  supportedDeviceTypes: annualProfile.supportedDeviceTypes,
  // Same free-text preserve phrases as Annual (Not Tested, No Access, etc.)
  // - not Semi-Annual-specific behavior.
  preservePhrases: annualProfile.preservePhrases,
  // Fallback prefix for every supported device type NOT in the Visual &
  // Functional subset below (e.g. Smoke Detector, Pull Station, Duct
  // Detector, Heat Detector, ...).
  standardPhrase: 'Visual',
  // Prefix used only for the five device types in
  // visualFunctionalDeviceTypeKeys - see isVisualFunctionalDeviceType in
  // device-type-matcher.js and classify.js's prefix precedence.
  visualFunctionalPhrase: 'Visual & Functional',
  visualFunctionalDeviceTypeKeys: VISUAL_FUNCTIONAL_DEVICE_TYPE_KEYS,
  // Semi-Annual has no Heat Detector "One Hitter" exception - Heat
  // Detector isn't in the Visual & Functional subset, so it already gets
  // the plain Visual-only phrase like every other non-listed device type.
  oneHitterPhrase: null,
  oneHitterPattern: null,
  ambiguousOneHitterPattern: null,
};
