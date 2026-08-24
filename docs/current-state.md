# Current state

A snapshot of exactly what's implemented and verified as of this writing.
Update this file whenever a rule, test count, or architectural piece
changes — it's meant to save a future session from re-deriving all of this.

## Implemented actions

- **Clean Up Service Entries** — Annual profile (enabled) and Semi-Annual
  profile (enabled). Preview / Apply / Undo, both routed through the shared
  paced write queue. Full rule reference: `docs/cleanup-rules.md`. Includes
  Communicator/Communication Line/Monitoring (`src/cleanup/
  communications-parser.js`, added 2026-08-06) — their own fixed
  Service-field shapes, applied identically under both profiles, with
  Communicator/Monitoring also writing a device-attribute field alongside
  Service (a new capability for this action — every other supported device
  type only ever writes Service). Also includes (both added 2026-08-06):
  an Annual-only Heat Detector rule (`classify.js`) that preserves an
  already-`Visual, Passed/Failed` value instead of upgrading it, and syncs
  BuildingReports' own "Restorable" checkbox; and Third-Party Serviced
  Devices (`src/cleanup/third-party-service-parser.js` +
  `src/config/third-party-service-abbreviations.js`) — Air Pressure
  Switch/Tamper Switch/Waterflow Switch/Kitchen Hood normalized to `Svc.
  By <Company> <M>/<YY>`, applied identically under both profiles, with a
  popup manual-fix UI (`manualServiceFix` message) for the rare case an
  abbreviated company name still doesn't fit BuildingReports' 31-character
  limit. Communicator/Communication Line/Monitoring's time extraction
  (`communications-parser.js`) also recognizes a 24-hour-clock hour (e.g.
  `15:14:26 pm`, a real-world reported example, or a bare `15:14`) and
  converts it to 12-hour form, even alongside a redundant/mismatched am/pm
  marker (2026-08-24).
- **Battery Cleanup** — universal, no Inspection Profile. Preview / Apply /
  Undo — **shares the same three popup buttons as Service Cleanup since
  2026-08-24** (no longer separate buttons; `popup.js` triggers both
  actions back to back on every click), while staying architecturally
  independent: separate checkpoint kinds, independent Undo history from
  Service Cleanup, same write queue. Full rule reference:
  `docs/battery-cleanup-rules.md`. 3-year expiration is keyed off
  **Install Date** (changed 2026-08-06, replacing Inspection Date entirely
  — see that doc's "Pass/Fail outcome" section). Rated Voltage/Amps are
  confirmed live to already be the battery's fixed rated values (flat
  2-decimal numbers, e.g. `12.00`), not test readings. Blank Post Test is
  filled with a generated `12.00`-`13.00` reading (2026-08-24, explicitly
  requested — the one deliberate exception to this action's never-invent
  rule, cosmetic only). A `0.00` Post Test + `0.00` Tested Ah together with
  no "flat" marker anywhere is treated as an already-serviced/replaced
  battery and passes rather than fails (2026-08-24) — Install Date
  expiration still independently applies.
- **Repaired / Fixed** — added 2026-08-24. Human-driven, unlike the two
  actions above: walks only devices currently marked Failed, one at a time,
  asking "was this repaired/replaced?" for each. Battery has the only rule
  so far (`src/cleanup/repair-battery.js`): a short form (Amps, replacement
  date, technician/customer name, company name) computes Post Test/Tested
  Ah → `0.00`, Min Ah/Model Number derived from the new Amps, Passed
  checked, Comment/Solution cleared, Service → `Visual & Functional,
  Passed`, and a new line appended below the existing Note. A device type
  with no rule yet is flagged for manual review instead of guessed at.
  Nothing is written until "Apply Repairs" is clicked, through the same
  paced write queue as everything else, with its own Undo history
  (`repairApply`/`repairUndo` checkpoint kinds, kept separate from Battery
  Cleanup's even though both write Battery fields). Gave the adapter a
  genuinely new capability: **writing** Install Date (`adapter.js`'s
  `BATTERY_DATE_FIELD_MAP`/`parseLocalDateOnlyString`, `ADAPTER_VERSION`
  bumped to 7) - previously read-only everywhere in this codebase. Full
  rule reference: `docs/repair-fixed-rules.md`.
- **Shared paced write queue** (`src/cleanup/write-queue.js`) — concurrency
  1, checkpointed to `chrome.storage.local`, rate-limit backoff + bounded
  retries + manual Resume, Pause / Cancel Remaining. Used by all six write
  paths (Service/Battery/Repair × Apply/Undo). See `docs/architecture.md`.

## Tests

```
npm test
```

**227 tests, 0 failures** across `tests/*.test.js`
(`battery-cleanup.test.js`, `battery-engine.test.js`, `classify.test.js`,
`communications-cleanup.test.js`, `engine.test.js`, `repair-battery.test.js`,
`repair-engine.test.js`, `semi-annual.test.js`,
`third-party-service-parser.test.js`, `write-queue.test.js`). Synthetic
fixtures only (`tests/fixtures.js`), zero mocking, zero DOM dependency. If
this count drifts from what's actually reported by `npm test`, trust the
live run, not this file.

## Known BuildingReports internals

- Classic ExtJS 6.5 app inside a nested, unnamed-index frameset (never
  hardcode frame indices — the adapter self-detects by injecting into
  every frame). Top → `view-inspection-log` frame → the actual Device
  Editor frame (`load-device-edit-page`).
- Device grid: `#devicelistGrid` (itemId), whole report already resident
  client-side (`store.getCount()` after clearing two quick-filters) — no
  pagination logic needed anywhere.
- Save: `mainPanel.getController().onSaveDeviceEditPage(saveBtn)`, one
  `POST .../api/?a=deviceWrite` per dirty record, verified via `Ext.Ajax`
  `requestcomplete`/`requestexception` matching `params.scannumber`, success
  = response body matches `/<error>\s*200 OK\s*<\/error>/`.
- **Rate limiting (critical)**: bursts of concurrent `deviceWrite` requests
  get rejected with `410 Rate Limit Exceeded`, no `Retry-After` header. A
  single isolated save completes in ~330ms with no issue. This is why every
  write goes through the paced queue at concurrency 1 — see
  `docs/buildingreports-dom-map.md` §5.1 for the full incident and
  measurements.
- Inspection frequency (Annual/Semi-Annual) lives on the **parent**
  inspection-log grid (`frequency`/`frequencyname` fields), not inside the
  Device Editor frame at all — not currently read by this extension (the
  popup's profile selector is a manual choice).
- No legitimate BuildingReports bulk/batch-save endpoint was found for
  `service` or Battery-attribute fields — its own "mass edit" tool only
  covers a few numeric Sensitivity fields.
- Chrome DevTools MCP's `list_network_requests` does **not** reliably
  capture `deviceWrite` traffic issued via the injected adapter (it only
  showed the initial page-load sequence in testing) — don't rely on it for
  this app's write traffic; use the adapter's own `Ext.Ajax` listeners.

## Adapter version

`ADAPTER_VERSION = 7` (`src/site-adapters/buildingreports/adapter.js`) —
single-record save API (`applySingleServiceChange`/
`applySingleServiceFieldsChange`/`applySingleBatteryChange`). Bump this
constant whenever `adapter.js` changes, per the versioned-re-injection
scheme in `docs/architecture.md`. Version 5 (2026-08-06) added
`installDate` (Battery Cleanup's new expiration input) and
`COMMS_FIELD_MAP`/`applySingleServiceFieldsChange` (Communicator/
Communication Line/Monitoring's Service Cleanup rules). Version 6
(2026-08-06) added `HEAT_DETECTOR_FIELD_MAP` (`restorable` → real
dataIndex `simulated`, confirmed live) for the Annual Heat Detector
Restorable rule, folded into the same `SERVICE_EXTRA_FIELD_MAP`/
`applySingleServiceFieldsChange` path `COMMS_FIELD_MAP` already used (no
new adapter method needed for Third-Party Serviced Devices - Service/
Comment/Solution/Note were already plain pass-through fields). Version 7
(2026-08-24) added `BATTERY_DATE_FIELD_MAP`/`parseLocalDateOnlyString` -
**write** support for Install Date (Repair/Fixed's Battery rule), the
first time this codebase has ever written that field; confirmed live with
no timezone/off-by-one-day issues (see `docs/repair-fixed-rules.md`).

## Known limitations / unresolved items

- No auto-detection of Annual vs Semi-Annual from the report itself — the
  popup's profile selector is manual. The frequency field's location is
  documented above if this is ever wanted.
- The paced write queue's default pacing (750ms between saves, exponential
  backoff starting at 2s on rate-limit) is a conservative choice based on
  limited live data (one rate-limit incident, one clean single-request
  timing) — not exhaustively tuned. If BuildingReports' actual limit
  characteristics are ever measured more precisely, revisit
  `DEFAULT_MIN_DELAY_MS`/`BASE_BACKOFF_MS` in `write-queue.js`.
- No Semi-Annual numeric frequency code was observed live (only Annual's,
  `10`) — don't guess it if a future feature needs it.
- The Semi-Annual profile has no Heat Detector "One Hitter" exception
  (intentional — Heat Detector isn't in the five Visual & Functional
  device types, so it already gets `Visual`-only under Semi-Annual). If a
  Semi-Annual One Hitter nuance is ever requested, it doesn't exist yet.
- Left/Right Battery failure pairing is implemented, unit-tested, and
  confirmed live (2026-08-04, a real report - no customer/report
  identifiers recorded here) - Preview correctly identified an unambiguous
  Left/Right pair, Apply wrote the paired failure (Passed/Service/Comment/
  Solution/Note) to the counterpart and verified the save, a fresh Preview
  afterward showed the pair idempotently "already correct," and Undo
  restored the counterpart to its exact original values. Live testing also
  surfaced and fixed a real bug: the initial implementation only checked
  the `direction` column for the Left/Right marker, but real technician
  entries put it in `description` instead. Since which column carries it
  isn't predictable, the rule now scans all five identifying columns
  (`floor`, `direction`, `location`, `description`, `areasuite`) for the
  marker rather than hardcoding one or two (see
  `docs/battery-cleanup-rules.md`).
- **"Undo Last Cleanup" undoes the report's ENTIRE accumulated Undo
  history, not just the run you just did** - a real incident (2026-08-06)
  found a prior session's ~100-record Apply had never been fully undone,
  its leftover entries silently merged with a new 3-item run, and clicking
  Undo started reverting all 107 before it was caught and paused. See
  `docs/architecture.md`'s Undo section for the full account and the
  operational fix (check `chrome.storage.local`'s entry count before
  clicking Undo during live testing).

## Most recent successful live verification

**2026-08-24, a real report (no customer/report identifiers recorded
here):**

- **Popup UI merge:** one click of "Preview Cleanup" correctly ran Service
  Cleanup and Battery Cleanup back to back and rendered both result panels
  (228 devices; 6 real Batteries classified matching the real underlying
  data). The combined "Apply Cleanup" confirm dialog correctly summarized
  both halves (`"...1 Service field(s)...and 4 Battery device(s) (21
  field(s) total)..."`), and Apply ran Service (1/1 saved) then Battery
  (4/4 saved), zero failures either side. The new `undoStatus`-driven Undo
  confirm correctly showed real entry counts (`"...restores 1 Service
  field(s) and 4 Battery field(s)..."`), and Undo restored both (1/1, 4/4,
  zero failures) - including exact restoration of a real pre-existing
  replacement-history Note string on 2 Batteries.
- **Blank Post Test generation:** a hand-blanked real Battery's Post Test
  correctly generated a value in `[12.00, 13.00)` on Preview (`12.94`) and
  a different value on the following Apply (`12.12`, matching the
  documented "Apply re-classifies fresh" behavior) - verified written and
  persisted directly against the live ExtJS grid.
- **0.00/0.00 "already completed" placeholder exception:** before the fix,
  Preview showed 2 Passing / 2 Date Expired / 2 Failed Load Test across the
  6 real Batteries; after, 4 Passing / 2 Date Expired / 0 Failed Load Test
  - the 2 previously-miscategorized real Batteries (Note already read
  `"...Battery Replaced By ... - 8/6/25"`, no "flat" marker anywhere) now
  correctly classify `alreadyCorrect` instead of being wrongly flagged to
  overwrite their existing correct Passed state with Failed. Verified via
  Preview only (no Apply needed - already correct, nothing to write).
- Communicator's 24-hour time fix (`15:14:26 pm` -> `3:14 PM`) was unit-
  tested only - the one real Communicator on this report was already
  canonical, so there was no real 24-hour-formatted example to test
  live against.
- The report was left in its original, fully-consistent state afterward
  (the hand-blanked Post Test was manually restored to its true original
  `13.07` after Undo, since Undo only reverts to the hand-set test value).
- **Repaired/Fixed (same day, same report):** 2 real Batteries were
  genuinely Date Expired (confirmed earlier the same session) - a real
  Battery Cleanup Apply correctly marked them Failed, giving Repair/Fixed
  a real Failed device to walk. "Start Repair Walkthrough" correctly
  scanned to exactly those 2 (not the other 220+ Passing devices),
  presented them one at a time in report order. Device 1 ("Yes,
  repaired/replaced" → Battery form, Amps changed 12.00 → 14.00, Tech
  "Test Tech", Company "Test Fire & Safety Co") correctly computed Min Ah
  9.10, Model Number `12V-14Ah`, and the exact Note line `Battery Replaced
  By Test Tech With Test Fire & Safety Co - 8/24/26`. Device 2 ("No")
  correctly skipped with no changes recorded. The summary showed "Repairs
  ready to apply: 1" with the computed values displayed for review before
  anything was written. "Apply Repairs" saved 1/1 with zero failures,
  verified directly against the live grid (amps `14.00`, Post Test/Tested
  Ah both `0.00`, Min Ah `9.10`, Model Number `12V-14Ah`, Passed checked,
  Service `Visual & Functional, Passed`, Comment/Solution cleared, Note
  correctly appended below the existing `Date Expired - Replace Battery`
  line) - **including the brand-new Install Date write**, confirmed local
  midnight with no timezone shift (`Mon Aug 24 2026 00:00:00` in the local
  timezone). "Undo Last Repair" showed the real entry count in its
  confirmation (`"...restores 1 Battery field(s)..."`) and restored every
  field exactly, including the real original Install Date (`Mon Jan 02
  2023 00:00:00`, the Battery's actual pre-repair expired date) - a full,
  clean round trip. A real CSS bug was found and fixed during this
  testing: `.hidden`'s `display: none` lost a cascade tie against
  `.actions`' `display: flex` when both classes were on the same element
  (`repairYesNoBar`), which is a `<div class="actions">` toggled hidden
  directly - `.hidden` now uses `!important` (see `popup.css`). The
  "no-rule-yet device" review path (a Failed non-Battery device answered
  "Yes") was unit-tested only - this report had no Failed non-Battery
  device to test live against.

Verified end-to-end against a real, live BuildingReports report through
Chrome DevTools MCP (no customer/report identifiers recorded here or
anywhere in this repo):

- Annual Service Cleanup: Preview/Apply/Undo confirmed correct, including
  full-report-scale Apply (~100 records) through the paced write queue with
  **zero failures and no rate-limit response**.
- Semi-Annual Service Cleanup: confirmed correct for a Visual & Functional
  device type (Passed), a Visual-only device type (Passed, lowercase-
  variant input), a Failed outcome (Visual & Functional group), and a
  custom/unsupported free-text entry (confirmed left untouched throughout).
- Battery Cleanup: Preview confirmed working (read-only) post-restoration.
- Battery Cleanup Left/Right pairing (2026-08-04): see the "Known
  limitations" note above for the full account, including the real-world
  Description-column bug this testing found and fixed.
- **Battery Cleanup Install Date rule (2026-08-06, a real report - no
  customer/report identifiers recorded here):** Preview confirmed 2 real
  Batteries with a >3-year-old Install
  Date correctly flipped from Passed to Failed - Date Expired purely from
  the new date source (their Inspection Date was recent, so they'd have
  stayed Passed under the old rule); 2 other real Batteries with a genuine
  0.00 Tested Ah correctly failed on load test independent of the date
  change. Full Apply/verify/Undo/verify cycle confirmed correct on all 4,
  including exact restoration of a real pre-existing Note history string on
  2 of them.
- **Communicator/Communication Line/Monitoring rules (2026-08-06, same
  report):** Preview correctly reclassified all 9 real Communicator/
  Communication Line/Monitoring devices from "unrecognized device type" to
  "already correct" (their existing values were already canonical - zero
  unwanted changes). A hand-dirtied, hand-picked test of one of each device
  type (messy Service text + stale attribute values) confirmed the full
  Preview → Apply → verify → Undo → verify cycle, including the new
  multi-field write (Service + Restore Time for Communicator; Service +
  Confirmed Time + Comment + Solution for Monitoring) landing in a single
  save per device.
- **Real incident and recovery (2026-08-06):** see the "Known limitations"
  note above on Undo's accumulated-history behavior - a partial accidental
  Undo reverted 36 unrelated, already-correct records from a prior
  session's leftover history; recovered via a fresh Preview+Apply (which
  re-detected and re-fixed exactly those 36), then the stale Undo storage
  entry was discarded. Final Preview after recovery showed the report
  back in the exact same "0 safe changes, 217 already correct" state as
  right after the intended comms-rule test, and Battery Cleanup's Preview
  matched the real underlying data exactly (4 affected, 2 already correct).
- The report was left in its original, fully-consistent state after
  testing (confirmed via a final Preview showing zero safe changes for
  Service Cleanup, and Battery Cleanup matching the report's real
  underlying data).
- The rate-limit incident that led to building the write queue (see
  dom-map §5.1) happened, was recovered from, and the fix was verified live
  in the same session - see `docs/architecture.md` and
  `docs/buildingreports-dom-map.md` for the technical detail.
- **Annual Heat Detector Restorable + Third-Party Serviced Devices
  (2026-08-06, same report):** Preview correctly identified the report's
  one real Heat Detector (already `Visual & Functional, Passed`) as
  needing only its Restorable checkbox checked (Service text unchanged),
  and correctly classified all 5 real Tamper Switch/Waterflow Switch
  records (`Svc. By Hooper 2/25`) as `alreadyCorrect`. A hand-dirtied test
  (one Tamper Switch set to `Jefferson Fire And Safety 7/26`, another to
  an intentionally-too-long company name) confirmed: the abbreviation rule
  producing `Svc. By Jefferson F&S 7/26` exactly; the too-long record
  correctly flagged `needsReview` with a matching `suggestedFix`; the new
  popup manual-fix UI (edit the suggested text, click "Apply This Fix")
  correctly saving a shortened value end-to-end through `manualServiceFix`;
  a combined Apply of the Heat Detector + abbreviation change (2 items)
  saving and verifying correctly; and Undo correctly reverting all 3
  confirmed writes (checked via `chrome.storage.local`'s entry count
  first - exactly 3, no leftovers). Both hand-edited Tamper Switch records
  were restored to their true original `Svc. By Hooper 2/25` afterward (a
  direct corrective write, since Undo only reverts to the hand-set test
  value, not the pre-test original), and a final Preview confirmed the
  report matched its very first Preview result exactly.

## Files most likely to change for future rules

- `src/config/inspection-profiles/*.js` — device lists, phrases, a new
  profile file.
- `src/cleanup/classify.js` / `device-type-matcher.js` — prefix-selection
  logic shared by all Service Cleanup profiles.
- `src/cleanup/communications-parser.js` — Communicator/Communication
  Line/Monitoring rule changes; profile-agnostic, doesn't touch
  `classify.js` beyond its one dispatch call.
- `src/cleanup/rules/battery-cleanup.js` / `battery-engine.js` — a new
  Battery field rule.
- `src/cleanup/repair-engine.js` / `repair-<devicetype>.js` — a new
  Repaired/Fixed device-type rule; see `docs/repair-fixed-rules.md` "How to
  add the next device type's rule".
- `src/site-adapters/buildingreports/adapter.js` — only if a new field
  mapping or a genuinely new BuildingReports interaction is needed; keep
  single-record, keep JSON-in/JSON-out.
- `tests/*.test.js` — always, alongside any of the above.
