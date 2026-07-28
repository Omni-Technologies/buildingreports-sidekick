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
- (add notes here before running a release)

## [0.1.1] - 2026-07-28
- No release notes were recorded before this release.

## [0.1.0] - 2026-07-28
- Initial working release: Clean Up Service Entries (Annual and
  Semi-Annual profiles) and Battery Cleanup, both with Preview / Apply /
  Undo, routed through a shared paced, checkpointed write queue that
  respects BuildingReports' rate limiting.
