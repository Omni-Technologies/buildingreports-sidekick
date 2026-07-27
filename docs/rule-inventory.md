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
| Unsupported device type left untouched regardless of content | Yes | Yes (same device list as Annual) | `device-type-matcher.js`, `classify.js` | Implemented | Yes | e.g. Tamper Switch, Waterflow Switch, Communicator, Monitoring, Communication Line confirmed real-world examples |
| Unsupported/custom free-text Service value → `unsupportedField`, never rewritten | Yes | Yes | `classify.js` | Implemented | Yes | e.g. "Bar Coded", "Svc. By Hooper 2/25", timestamp-style entries confirmed real-world examples |
| Trailing note preserved, sentence-cased only (not full title-case) | Yes | Yes | `service-parser.js` | Implemented | Unit only | Preserves acronyms/model numbers/addresses inside notes |
| Device-type matching tolerant of case/whitespace/slash/parenthetical spacing, never substring | Yes | Yes | `device-type-matcher.js`, `text-utils.js` | Implemented | Yes | e.g. "Bell / Strobe" = "Bell/Strobe"; "Smoke Detector Head" ≠ "Smoke Detector" |

## Battery Cleanup

Universal — same rules regardless of Inspection Profile. Source file for
all rows below: `src/cleanup/rules/battery-cleanup.js` (attribute rules) /
`src/cleanup/battery-engine.js` (aggregation), unless noted.

| Rule | Status | Live tested | Notes |
|---|---|---|---|
| Rated Voltage / Amps → exactly 2 decimals, value preserved | Implemented | Yes | Blank/non-numeric/negative flagged, not guessed |
| Pre Test always cleared when non-blank | Implemented | Yes | Unconditional |
| Post Test → 2 decimals, value preserved (incl. `0.00`) | Implemented | Yes | Negative flagged suspicious, non-numeric flagged invalid, blank left blank |
| Min Ah = Amps × 0.65, recalculated fresh every time | Implemented | Yes | Never trusts stored Min Ah; skipped if Amps invalid |
| Tested Ah → 2 decimals, value preserved | Implemented | Yes | Blank flagged missing (unlike Post Test); negative/non-numeric flagged |
| Model Number derived from actual Rated Voltage + Amps (`<V>V-<Ah>Ah`) | Implemented | Yes | Never trusts existing Model Number; skipped if either input invalid |
| Pass/Fail outcome: expired when Inspection Date ≤ now − 3 calendar years | Implemented | Yes | Local-calendar-day comparison, not UTC |
| Pass/Fail outcome: failed load test when Tested Ah < newly-calculated Min Ah | Implemented | Yes | `0.00` Tested Ah fails like any other value, no exemption |
| Failing outcome sets Passed=unchecked, Service=`Visual & Functional, Failed`, Solution=`Replace Battery`, Note overwritten with exact wording (date expired / failed load test / both) | Implemented | Yes | Comment = `Date Expired` or `Failed Test` (date always wins if both) |
| Passing outcome sets Passed=checked, Service=`Visual & Functional, Passed`, Comment/Solution cleared, **Note untouched** | Implemented | Yes | Existing replacement-history text in Note is preserved on a pass |
| Missing/invalid Inspection Date, Min Ah, or Tested Ah with no proven failure → `REVIEW`, outcome fields untouched | Implemented | Unit only | Attribute formatting still applies independently |
| `isBattery()` device-type match tolerant, never substring/fuzzy | Implemented | Yes | Same style as Service Cleanup's device-type matcher |

## Shared infrastructure (not a "rule" but load-bearing for every rule above)

| Piece | Source file | Status | Notes |
|---|---|---|---|
| Paced write queue (concurrency 1, checkpointed, rate-limit backoff, Pause/Resume/Cancel Remaining) | `write-queue.js` | Implemented | Used by all 4 write paths; see `docs/architecture.md` |
| Single-record adapter save + verify | `adapter.js` `applySingleFieldChange` | Implemented | `ADAPTER_VERSION = 3` |
| Preview/Apply/Undo message plumbing | `background.js` | Implemented | Generic per checkpoint `kind` |
