# BuildingReports Sidekick

A local, unpacked Chrome extension (Manifest V3) with one-click cleanup and
editing tools for BuildingReports.com inspection reports.

It currently implements two independent cleanup actions:

- **Clean Up Service Entries**: scans every device's Service field in the
  currently open report and normalizes clear Annual "Visual & Functional,
  Passed/Failed" variations to a single canonical form, while leaving
  anything blank, ambiguous, unsupported, or already correct untouched.
- **Battery Cleanup**: scans every Battery device (regardless of Inspection
  Profile) and normalizes Rated Voltage/Amps/Post Test/Tested Ah formatting,
  clears Pre Test, recalculates Min Ah, corrects Model Number, and fails
  both sides of an unambiguous matching Left/Right battery pair when either
  side fails - while leaving missing, invalid, or suspicious values
  untouched and flagged for review, and leaving ambiguous pairs unpaired.
  See `docs/battery-cleanup-rules.md` for the full rule reference.

The two actions are fully independent: separate Preview/Apply/Undo buttons,
separate Undo history, and Battery Cleanup does not require picking an
Inspection Profile.

## Install (Load unpacked)

1. Go to `chrome://extensions`.
2. Enable "Developer mode" (top right).
3. Click "Load unpacked" and select this folder:
   `C:\Users\drewc\buildingreports-sidekick`
4. Open a BuildingReports report's **Device Editor** tab (the page that
   shows "Device Editor" at the top and a device grid with a Service
   column).
5. Click the BuildingReports Sidekick toolbar icon to open the popup.

No build step is required - it's plain HTML/CSS/JS loaded directly.

## Using it

### Clean Up Service Entries

1. **Preview Cleanup** - scans the entire report (not just visible/filtered
   rows) and shows counts per category plus before/after examples. Nothing
   is modified.
2. **Apply Cleanup** - after confirming the profile and change count, writes
   only the entries classified as "safe to change", using BuildingReports'
   own Save button/save API so every existing validation and persistence
   path is reused. Writes go through a paced, one-at-a-time queue (see
   "Paced writes / rate limiting" below), so a large report takes a while
   but never overwhelms BuildingReports. Reports saved/failed counts.
3. **Undo Last Cleanup** - restores the exact original values from the most
   recent Apply run on this report, again through the real, paced save
   path.

The Inspection Profile selector defaults to **Annual**; **Semi-Annual** is
also fully enabled and selectable - see `docs/cleanup-rules.md` for both
profiles' exact rules (which device types get "Visual & Functional" vs
"Visual" under Semi-Annual, preserved phrases, etc).

### Battery Cleanup

1. **Preview Battery Cleanup** - scans every Battery device in the entire
   report and shows, per field, how many devices/fields would change, plus
   before/after details and a review list. Nothing is modified. No
   Inspection Profile selection is needed - it's the same scan regardless of
   Annual/Semi-Annual.
2. **Apply Battery Cleanup** - writes only the deterministic, safe field
   changes (formatting, Min Ah recalculation, Model Number correction, Pre
   Test clearing), one save per affected device even when several of its
   fields changed. Missing/invalid/suspicious values are left untouched and
   listed for review instead of guessed at.
3. **Undo Last Battery Cleanup** - restores the exact original value of
   every field the most recent Battery Cleanup Apply changed. Kept
   completely separate from Clean Up Service Entries' Undo history.

See `docs/battery-cleanup-rules.md` for the full field-by-field rule
reference and how to add the next Battery rule.

### Paced writes / rate limiting

BuildingReports rate-limits bursts of concurrent Service/Battery-attribute
saves (confirmed live - see `docs/buildingreports-dom-map.md` §5.1). Every
Apply/Undo (Service and Battery both) writes one device at a time with a
short delay in between, backing off automatically if BuildingReports still
responds with a rate-limit error, and giving up after a bounded number of
retries rather than hammering the server - at that point the popup shows
"Operation paused" with a **Resume** button (and a **Cancel Remaining**
option that keeps whatever already saved and stops there). Progress
(`Saving device N of M...`) is checkpointed after every single save, so
closing the popup mid-run never loses progress - reopening it picks the
paused run back up automatically. See `docs/architecture.md`'s "Throttled
write queue" section for the full design.

## Project layout

```
manifest.json
src/
  popup/                     Popup UI (HTML/CSS/JS)
  background/                Service worker: orchestrates scripting + messaging
  cleanup/                   Pure cleanup engines (device-type matching, parsing, classification)
    rules/battery-cleanup.js   Battery Cleanup's per-record rule logic
    battery-engine.js          Battery Cleanup's report-level aggregation (Preview/Apply shape)
    write-queue.js             Paced, checkpointed write coordinator shared by every Apply/Undo
  config/inspection-profiles/  Annual and Semi-Annual rule sets (both enabled) - Service Cleanup only
  site-adapters/buildingreports/  The only file that knows BuildingReports' DOM/ExtJS internals
  shared/                    Small text helpers with no DOM dependency
docs/                        Architecture, DOM map, and how-to-add-a-rule guides
tests/                       Node --test unit tests for the cleanup engines
```

See `docs/architecture.md` for how the pieces fit together (including the
paced write queue), `docs/buildingreports-dom-map.md` for exactly how the
site works and how to repair the adapter if BuildingReports changes,
`docs/adding-a-rule.md` for adding new cleanup actions, `docs/cleanup-rules.md`
for the Service Cleanup Annual and Semi-Annual rule details, and
`docs/battery-cleanup-rules.md` for the Battery Cleanup rule reference.

## Tests

```
npm test
```

Runs `node --test tests/*.test.js` against the cleanup engines using
synthetic, sanitized fixtures (no real customer data). No install step
needed beyond Node itself.

## Privacy

No customer names, addresses, credentials, or full report contents are
stored anywhere in this repo, its docs, or its tests. The extension only
talks to `https://www.buildingreports.com/*` (the site you're already
signed into) and stores nothing outside `chrome.storage.local` on your own
machine - used to remember the last Apply run for Undo, and (only while a
paced Apply/Undo run is in progress or paused) a checkpoint of which
devices' Service/Battery fields are pending, saved, or failed so the run
can resume after the popup closes.
