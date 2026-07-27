// Single registration point for inspection profiles. Add a new profile by
// creating its file in this directory and adding one line below - see
// docs/adding-a-rule.md.

import { annualProfile } from './annual.js';
import { semiAnnualProfile } from './semi-annual.js';

export const PROFILES = {
  [annualProfile.key]: annualProfile,
  [semiAnnualProfile.key]: semiAnnualProfile,
};

export const DEFAULT_PROFILE_KEY = annualProfile.key;

export function getProfile(key) {
  return PROFILES[key] || PROFILES[DEFAULT_PROFILE_KEY];
}
