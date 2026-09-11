# Changelog

All notable changes to BuildingReports Sidekick are documented here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

Before running a release command (`npm run release:patch/minor/major`),
edit the **Unreleased** section below to describe what changed. The
release script moves whatever is written there into a new dated version
section automatically - it never invents release notes from Git history.

When writing an entry, say what changed from the user's point of view:

- **Added** — a new cleanup rule, profile, or feature.
- **Fixed** — corrected behavior that was previously wrong.
- **Changed** — BuildingReports compatibility changes (e.g. a selector or
  field-mapping repair in the adapter), or a deliberate behavior change.
- **Security** — permission changes, or reliability/security fixes (e.g.
  write-queue pacing changes).

## [Unreleased]
- **Added**: Third-Party Serviced Devices (Service Cleanup's "Svc. By
  <Company> <M>/<YY>" rule) now also covers Fire Pump Phase Reversal, Fire
  Pump Power, Fire Pump Running, Fire Pump Trouble, and Pre-Action System
  - the same rule already applied to Air Pressure Switch, Tamper Switch,
  Waterflow Switch, and Kitchen Hood.
- **Added**: The bare "Tested" placeholder rule (Passed checked, no real
  result text) now also recognizes "Tested/Cleaned" and "Cleaned/Tested"
  (any spacing around the slash, either order) - normalizes to the
  profile's canonical phrase exactly like the bare "Tested" case.

## [0.1.7] - 2026-09-11
- **Added**: A **Copy Email Lists** button in the popup - an independent,
  read-only scan of the entire report (not tied to Preview) that builds
  the two grouped bullet lists for a customer discrepancy email: Failed
  devices and Passed/Untested devices that still carry a note. Copies
  formatted rich text (matching your normal email font/colors) directly
  to the clipboard, ready to paste into Outlook/Gmail - no subject line,
  greeting, or sign-off included, just the two lists.

## [0.1.6] - 2026-09-03
- **Added**: A **Copy Review Items** button in the popup - copies every
  unrecognized/needs-review item from the last Preview (both Service
  Cleanup and Battery Cleanup) to the clipboard as plain text, so they're
  easy to bring back as a rule request.
- **Added**: Battery Cleanup now normalizes known Manufacturer spelling
  variants (starting with Power-Sonic) to a canonical form. Unrecognized
  manufacturers are left untouched.
- **Fixed**: Battery Cleanup's Rated Voltage/Amps now tolerate a trailing
  unit suffix (e.g. "12 V", "75.0 AH") instead of flagging it as an
  invalid value.
- **Fixed**: Service Cleanup now recognizes the "Visually & Functional"
  typo the same as "Visual & Functional".
- **Fixed**: Service Cleanup now recognizes a bare "Tested" placeholder,
  using the Passed checkbox as the outcome when Passed is checked
  (Passed unchecked is still never guessed as Failed).
- **Fixed**: Monitoring's N/A detection now tolerates a leading "N/A"/"NA"
  followed by free-text explanation, not just an exact match.

## [0.1.5] - 2026-08-24
- **Added**: A new **Repaired / Fixed** action - walks only the devices
  the currently open report shows as Failed, one at a time, and asks you
  to confirm whether each was actually repaired or replaced before
  changing anything. For a Battery you confirm was replaced, a short form
  asks for the new amperage (if it changed), the date it was
  replaced/fixed, and who did the work - Post Test/Tested Ah reset,
  Min Ah/Model Number recalculated, Passed/Service/Comment/Solution set,
  and a dated note appended below any existing notes, all automatically.
  Every other device type gets a simpler form (just a note you type) that
  marks the device Passed with canonical Service text - a placeholder
  until a dedicated rule is built for that device type. Nothing is
  written until you review the full list and click Apply Repairs; a
  separate Undo Last Repair button reverses it.
- **Added**: Blank Battery Post Test readings are now filled in with a
  generated value between 12.00 and 13.00 (cosmetic only - never affects
  Pass/Fail).
- **Added**: A Battery showing 0.00 Post Test and 0.00 Tested Ah together,
  with no "flat" reading noted anywhere, is now treated as an
  already-replaced battery awaiting its first real test - it passes
  instead of being marked Failed. A date-expiration failure still applies
  independently.
- **Changed**: Battery Cleanup no longer has its own Preview/Apply/Undo
  buttons - Service Cleanup's three buttons now run both together on
  every click, while staying fully independent underneath (separate
  history, separate Undo).
- **Changed**: The Undo confirmation now shows exactly how many Service
  and Battery fields will be restored before you click Undo.
- **Fixed**: Communicator/Communication Line/Monitoring entries written
  with a 24-hour-clock time (e.g. "15:14:26 pm") are now recognized and
  converted correctly instead of being left for manual review.

## [0.1.4] - 2026-08-06
- **Added**: Under the Annual profile, a Heat Detector already showing
  "Visual, Passed/Failed" (no "& Functional") is preserved as a deliberate
  restorable/non-restorable signal instead of being upgraded to "Visual &
  Functional" - and BuildingReports' own "Restorable" checkbox for that
  device is kept in sync (checked for Visual & Functional, unchecked for
  Visual-only). Semi-Annual is unaffected.
- **Added**: Clean Up Service Entries now normalizes Air Pressure Switch,
  Tamper Switch, Waterflow Switch, and Kitchen Hood (serviced by outside
  companies, not Passed/Failed tested) to "Svc. By <Company> <M>/<YY>",
  abbreviating known fire-industry words to fit BuildingReports' 31-
  character Service limit - applies under both Annual and Semi-Annual. If
  the service date is more than a year past, Comment/Solution/Note are set
  to flag it for investigation. When the abbreviated name still doesn't
  fit, the record is flagged for review with an editable suggested fix and
  an inline "Apply This Fix" control in the popup.
- **Added**: Clean Up Service Entries now normalizes Communicator
  (`Restored @ <time> <date>`, mirroring the time into a Restore Time
  field), Communication Line (`Yes, <time>`), and Monitoring (`Yes, <time>`,
  plus an `N/A`-is-valid rule and a Passed-unchecked-with-a-Note failing
  rule that sets `N/A`/`Failed Test`/`See Notes/Recommendations` and mirrors
  a Confirmed Time field) - identically under both Annual and Semi-Annual.
- **Changed**: Battery Cleanup's 3-year expiration now uses **Install
  Date** instead of Inspection Date - a battery's service life is measured
  from when it was installed, not from the date of the current inspection
  visit (which is effectively the same for every device in one report).
  This is a full replacement, not an additional check.

## [0.1.3] - 2026-08-04
- **Fixed**: Battery Cleanup's Left/Right pair matching no longer assumes
  the Left/Right marker lives in a specific column (Direction/Description).
  It now scans all five identifying columns (Floor, Direction, Location,
  Description, Area/Suite) for the marker, since different reports don't
  put it in the same place - the pair is still only matched when the
  marker appears in exactly one of them.

## [0.1.2] - 2026-08-04
- **Added**: Battery Cleanup now fails both sides of an unambiguous
  Left/Right battery pair when either side has a proven failure (expired
  inspection date or failed load test). A pair is matched conservatively
  on Floor, Direction, Location, Description, and Area/Suite - ambiguous
  or mismatched candidates are never guessed.

## [0.1.1] - 2026-07-28
- No release notes were recorded before this release.

## [0.1.0] - 2026-07-28
- Initial working release: Clean Up Service Entries (Annual and
  Semi-Annual profiles) and Battery Cleanup, both with Preview / Apply /
  Undo, routed through a shared paced, checkpointed write queue that
  respects BuildingReports' rate limiting.
