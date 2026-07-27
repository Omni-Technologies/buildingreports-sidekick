import { normalizeDeviceTypeKey } from '../shared/text-utils.js';

// Returns true when deviceType is in the profile's supported list, using
// tolerant-but-exact normalization (see text-utils.js). Never substring
// matching, so e.g. "Smoke Detector Head" will NOT match "Smoke Detector".
export function isSupportedDeviceType(deviceType, profile) {
  return profile.supportedDeviceTypeKeys.has(normalizeDeviceTypeKey(deviceType));
}

export function isHeatDetector(deviceType) {
  return normalizeDeviceTypeKey(deviceType) === normalizeDeviceTypeKey('Heat Detector');
}

// True when deviceType is in the profile's "Visual & Functional" subset -
// e.g. Semi-Annual's five device types that get the fuller phrase while
// every other supported device type gets the Visual-only phrase. Profiles
// that don't define this (Annual) simply have no such subset, so this is
// always false and standardPhrase applies to every supported device type,
// same as before.
export function isVisualFunctionalDeviceType(deviceType, profile) {
  if (!profile.visualFunctionalDeviceTypeKeys) return false;
  return profile.visualFunctionalDeviceTypeKeys.has(normalizeDeviceTypeKey(deviceType));
}
