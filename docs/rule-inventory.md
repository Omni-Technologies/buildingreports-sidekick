# Rule inventory

Every currently implemented Service Cleanup and Battery Cleanup rule, at a
glance. Update this table whenever a rule is added, changed, or removed —
see `docs/new-rule-checklist.md` step 13.

"Live tested" means confirmed against a real BuildingReports report through
Chrome DevTools MCP at some point, not just unit tests.

## Clean Up Service Entries

| Rule | Annual | Semi-Annual | Source file | Status | Live tested | Notes |
|---|---|---|---|---|---|---|
| Normalize to `Visual & Functional, Passed/Failed` for every supported device type | Yes (always) | Only for the 5-device V&F group | `classify.js`, `service-parser.js`, `annual.js` | Implemented | Yes | Prefix differs by profile; parsing/building logic is shared |
| Normalize to `Visual, Passed/Failed` for every supported device type | Heat Detector only, and only with a confirmed One Hitter marker | Every device type NOT in the 5-device V&F group | `classify.js`, `one-hitter.js` (Annual), `semi-annual.js` | Implemented | Yes | See next two rows for the two very different reasons a device ends up "Visual"-only |
| Heat Detector "One Hitter" free-text exception (confirmed) → `Visual` prefix | Yes | N/A (no exception defined) | `one-hitter.js`, `annual.js` | Implemented | Yes | Scans description/location/direction/comment/note/solution/modelnumber/service for `one[-\s]?hitter` |
| Heat Detector ambiguous marker (`1 hitter`/`1-hitter`) → `needsReview`, never guessed | Yes | N/A | `one-hitter.js` | Implemented | Unit only | Deliberately not auto-applied |
| Preserve free-text phrases (Not Tested, Unable To Test, Tested By Others, No Access, See On-Site Service Records) | Yes | Yes (reuses Annual's list) | `annual.js` `PRESERVE_PHRASES`, `classify.js` | Implemented | Unit only | Matched case-insensitively, whole value or leading phrase |
| Conflicting Passed+Failed in one value → `ambiguousConflict`, never rewritten | Yes | Yes | `service-parser.js` `hasConflictingResult` | Implemented | Unit only | Checked before any parsing |
| Blank Service left untouched | Yes | Yes | `classify.js` | Implemented | Unit only | |
| Unsupported device type left untouched regardless of content | Yes | Yes (same device list as Annual) | `device-type-matcher.js`, `classify.js` | Implemented | Yes | Tamper Switch/Waterflow Switch were real-world examples until the Third-Party Serviced Devices rule below was added (2026-08-06) - no longer unsupported |
| Heat Detector: already `Visual, Passed/Failed` (no "& Functional") preserved as-is, never upgraded | Annual only | N/A (already Visual-only via the 5-device V&F group) | `classify.js` | Implemented | Yes | Restorable/non-restorable signal from the technician, independent of the One Hitter marker |
| Heat Detector: Restorable device-attribute checkbox synced (checked for Visual & Functional either outcome, unchecked for any Visual-only case) | Annual only | N/A | `classify.js`, `adapter.js` `HEAT_DETECTOR_FIELD_MAP` | Implemented | Yes | Real dataIndex `simulated`, plain boolean; can make a record `safeChange` even when Service text is unchanged |
| Air Pressure Switch/Tamper Switch/Waterflow Switch/Kitchen Hood/Fire Pump Phase Reversal/Fire Pump Power/Fire Pump Running/Fire Pump Trouble/Pre-Action System/Clean Agent System: normalize to `Svc. By <Company> <M>/<YY>`, abbreviating known industry words to fit the 31-char limit | Yes (both profiles, profile-agnostic) | Yes | `third-party-service-parser.js`, `third-party-service-abbreviations.js` | Implemented | Yes | No trailing `M/YY`(YYYY) date -> `unsupportedField`, never guessed; Fire Pump/Pre-Action System added 2026-09-11; Clean Agent System added 2026-09-25 |
| Third-Party Serviced Devices: expiration (service date + 1 year, last day of month) sets Comment/Solution/Note, never Passed/Service | Yes (both profiles) | Yes | `third-party-service-parser.js` | Implemented | Yes | Independent of whether Service itself changes; never auto-clears when not expired |
| Third-Party Serviced Devices: manual fix UI for a candidate that still exceeds 31 chars after abbreviation | Yes (both profiles) | Unit + live | `third-party-service-parser.js` `suggestedFix`, `background.js` `manualServiceFix`, `popup.js` | Implemented | Yes | Reuses the `serviceApply` checkpoint kind and Undo history - no new write path |
| Communicator: normalize to `Restored @ <time> <date>`, mirror time into Restore Time attribute field | Yes (both profiles, profile-agnostic) | Yes | `communications-parser.js` | Implemented | Yes | Date falls back to Inspection Date when Service has no date; no time/date anywhere -> `needsReview`; also recognizes a 24-hour-clock hour (e.g. `15:14:26 pm`, a real-world example, or a bare `15:14`) and converts it to 12-hour form, even with a redundant/mismatched am/pm marker (added 2026-08-24); a marker-less `H:MM`/`H:MM:SS` (e.g. `9/11/26 10:03:46`) is read as a daytime time (5-11 AM, 12-4 PM) -> `10:03 AM` (added 2026-09-25, applies to Monitoring/Communication Line too) |
| Communication Line: normalize to `Yes, <time>` | Yes (both profiles, profile-agnostic) | Yes | `communications-parser.js` | Implemented | Yes | No device-attribute field (confirmed live); no recognizable time -> `needsReview` |
| Monitoring: normalize to `Yes, <time>` (+ N/A passing + unchecked/Note failing rules) | Yes (both profiles, profile-agnostic) | Yes | `communications-parser.js` | Implemented | Yes | Mirrors time into Confirmed Time attribute field; failing case sets Comment/Solution, never touches Note; N/A detection tolerates a leading "N/A"/"NA" with trailing free text (added 2026-08-31, real example "Na - no available devices") |
| Unsupported/custom free-text Service value → `unsupportedField`, never rewritten | Yes | Yes | `classify.js` | Implemented | Yes | e.g. "Bar Coded", "Svc. By Hooper 2/25", timestamp-style entries confirmed real-world examples |
| Trailing note preserved, sentence-cased only (not full title-case) | Yes | Yes | `service-parser.js` | Implemented | Unit only | Preserves acronyms/model numbers/addresses inside notes |
| Device-type matching tolerant of case/whitespace/slash/parenthetical spacing, never substring | Yes | Yes | `device-type-matcher.js`, `text-utils.js` | Implemented | Yes | e.g. "Bell / Strobe" = "Bell/Strobe"; "Smoke Detector Head" ≠ "Smoke Detector" |
| Real-world "Visually" typo tolerated same as "Visual" | Yes | Yes | `service-parser.js` `RESULT_PATTERN` | Implemented | Yes | Added 2026-08-31, real Strobe example: "Visually & Functional, Passed" |
| Real-world "Passd"/"Faild" typos tolerated same as "Passed"/"Failed" | Yes | Yes | `service-parser.js` `RESULT_PATTERN`/`HAS_PASSED`/`HAS_FAILED` | Implemented | Yes | Added 2026-09-25, real Semi-Annual example: "Visual,Passd" |
| Bare "Tested" (or "Tested/Cleaned"/"Cleaned/Tested") placeholder + Passed checked → profile's canonical phrase | Yes | Yes | `service-parser.js` `parseGenericTestedPlaceholder`, `classify.js` | Implemented | Unit only | Added 2026-08-31, extended 2026-09-11 for "Tested/Cleaned" (either order, any slash spacing); Passed UNCHECKED is never guessed as Failed, stays `unsupportedField`; bare "Cleaned" alone not recognized |

## Battery Cleanup

Universal — same rules regardless of Inspection Profile. Source file for
all rows below: `src/cleanup/rules/battery-cleanup.js` (attribute rules) /
`src/cleanup/battery-engine.js` (aggregation), unless noted.

| Rule | Status | Live tested | Notes |
|---|---|---|---|
| Rated Voltage / Amps → exactly 2 decimals, value preserved | Implemented | Yes | Blank/non-numeric/negative flagged, not guessed; these are the battery's fixed rated values, not test readings; tolerates a trailing unit suffix ("12 V", "75.0 AH") added 2026-09-01, stripped before parsing - an unrecognized suffix is still flagged, never guessed |
| Manufacturer: known spelling variants normalized (e.g. Power-Sonic) | Implemented | Yes | Added 2026-09-01, explicitly requested; narrow per-manufacturer dictionary (`MANUFACTURER_CANONICAL_BY_KEY`), never fuzzy - an unrecognized manufacturer is left completely untouched |
| Pre Test always cleared when non-blank | Implemented | Yes | Unconditional |
| Post Test → 2 decimals, value preserved (incl. `0.00`) | Implemented | Yes | Negative flagged suspicious, non-numeric flagged invalid |
| Post Test blank → generated reading `12.00`-`13.00` | Implemented | Yes | Added 2026-08-06/24, explicitly requested - the one exception to Battery Cleanup's never-invent rule; cosmetic only, never feeds Pass/Fail |
| Min Ah = Amps × 0.65, recalculated fresh every time | Implemented | Yes | Never trusts stored Min Ah; skipped if Amps invalid |
| Tested Ah → 2 decimals, value preserved | Implemented | Yes | Blank flagged missing (unlike Post Test); negative/non-numeric flagged |
| Model Number derived from actual Rated Voltage + Amps (`<V>V-<Ah>Ah`) | Implemented | Yes | Never trusts existing Model Number; skipped if either input invalid |
| Pass/Fail outcome: expired when Install Date ≤ now − 3 calendar years | Implemented | Yes | Local-calendar-day comparison, not UTC; replaced the original Inspection-Date-based comparison entirely (2026-08-06) - see `docs/battery-cleanup-rules.md` |
| Pass/Fail outcome: failed load test when Tested Ah < newly-calculated Min Ah | Implemented | Yes | `0.00` Tested Ah fails like any other value - **except** the 0.00/0.00 placeholder exception below |
| Pass/Fail outcome: 0.00 Post Test + 0.00 Tested Ah with no "flat" marker anywhere → Passed, not Failed | Implemented | Yes | Added 2026-08-24 - marks an already-serviced/replaced battery whose new unit hasn't been re-tested yet; "flat" scanned across the same 8 columns as One Hitter, whole word only; Install Date expiration still independently applies |
| Left/Right pair propagation: a proven failure on either side fails its unambiguous counterpart | Implemented | Yes | Matches Floor, Direction, Location, Description, and Area/Suite; the Left/Right marker itself is read from whichever of the five columns actually has it, not a hardcoded column (confirmed live it's not reliably Direction); skips ambiguous duplicates |
| Failing outcome sets Passed=unchecked, Service=`Visual & Functional, Failed`, Solution=`Replace Battery`, Note overwritten with exact wording (date expired / failed load test / both) | Implemented | Yes | Comment = `Date Expired` or `Failed Test` (date always wins if both) |
| Passing outcome sets Passed=checked, Service=`Visual & Functional, Passed`, Comment/Solution cleared, **Note untouched** | Implemented | Yes | Existing replacement-history text in Note is preserved on a pass |
| Missing/invalid Inspection Date, Min Ah, or Tested Ah with no proven failure → `REVIEW`, outcome fields untouched | Implemented | Unit only | Attribute formatting still applies independently |
| `isBattery()` device-type match tolerant, never substring/fuzzy | Implemented | Yes | Same style as Service Cleanup's device-type matcher |

## Repaired / Fixed

**Added 2026-08-24.** Human-driven, unlike the two actions above - only
walks devices currently marked Failed, one at a time, asking "was this
repaired/replaced?" for each. Source file for the report-level scan/
dispatch: `src/cleanup/repair-engine.js`. Full rule reference:
`docs/repair-fixed-rules.md`.

| Rule | Status | Live tested | Notes |
|---|---|---|---|
| Scans only devices currently marked Failed (`passed === false`), in report order | Implemented | Yes | `repair-engine.js` `scanFailedDevices` |
| Every Failed device gets an explicit "was this repaired?" question | Implemented | Yes | Sequential one-device-at-a-time wizard in the popup, never a bulk classify |
| Battery: Amps asked (prefilled with current value); Rated Voltage never asked, kept as-is | Implemented | Yes | `repair-battery.js` `buildBatteryRepairChange` |
| Battery: Post Test/Tested Ah reset to `0.00`; Min Ah/Model Number derived from the new Amps via the exact same formulas Battery Cleanup uses | Implemented | Yes | Never a second hand-rolled copy - reuses exported helpers from `rules/battery-cleanup.js` |
| Battery: Passed checked, Comment/Solution cleared, Service → `Visual & Functional, Passed` | Implemented | Yes | |
| Battery: Note gets a new `Battery Replaced By <name> With <company> - <M/D/YY>` line appended below whatever's already there, never overwritten | Implemented | Yes | Confirmed live preserving a real prior `Date Expired - Replace Battery` line |
| Battery: Install Date is asked (date replaced/fixed) and **written** - a brand-new adapter capability | Implemented | Yes | Previously read-only everywhere in this codebase - see `adapter.js`'s `BATTERY_DATE_FIELD_MAP`/`parseLocalDateOnlyString`, `ADAPTER_VERSION = 7` |
| Every other device type: generic fallback - typed Note (required), Passed checked, canonical Service text, Comment/Solution cleared | Implemented | Yes | `repair-generic.js` `buildGenericRepairChange` - deliberate placeholder until a real pattern is identified per device type (added 2026-08-24, explicitly requested); no more "flag for review only" dead end |
| Nothing written until "Apply Repairs" is clicked; own Undo history/checkpoint kinds (`repairApply`/`repairUndo`), independent of Battery Cleanup's; a single run can mix Battery + generic items, routed per-item by `deviceKind` | Implemented | Yes | Same paced write queue as every other write path - `background.js` `saveRepairItem` |
| Undo confirmation shows the real entry count before restoring | Implemented | Yes | `handleUndoStatus` extended to also report `repairEntries` |

## Shared infrastructure (not a "rule" but load-bearing for every rule above)

| Piece | Source file | Status | Notes |
|---|---|---|---|
| Paced write queue (concurrency 1, checkpointed, rate-limit backoff, Pause/Resume/Cancel Remaining) | `write-queue.js` | Implemented | Used by all 6 write paths (Service/Battery/Repair × Apply/Undo); see `docs/architecture.md` |
| Single-record adapter save + verify | `adapter.js` `applySingleFieldChange` | Implemented | `ADAPTER_VERSION = 7` |
| Multi-field Service Cleanup write (Communicator/Monitoring's attribute field, Monitoring's Comment/Solution, Heat Detector's Restorable, third-party serviced devices' Comment/Solution/Note) | `adapter.js` `applySingleServiceFieldsChange`, `SERVICE_EXTRA_FIELD_MAP` (`COMMS_FIELD_MAP` + `HEAT_DETECTOR_FIELD_MAP`) | Implemented | Same single-record save/verify path as every other write; `background.js`'s `saveServiceItem` branches on `typeof item.writeValue` |
| Preview/Apply/Undo message plumbing | `background.js` | Implemented | Generic per checkpoint `kind` |
