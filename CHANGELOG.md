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
