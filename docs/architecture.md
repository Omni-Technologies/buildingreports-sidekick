# Architecture

Five layers, kept deliberately separate so a future cleanup rule never
needs to touch BuildingReports internals, and the site adapter never needs
to know what a "cleanup rule" is.

```
popup (UI)
   │  chrome.runtime.sendMessage({type, profileKey, tabId})
   ▼
background/background.js (service worker)
   │  chrome.scripting.executeScript(world: 'MAIN'), ONE record at a time
   │  via cleanup/write-queue.js's runQueue (see "Throttled write queue")
   ▼
site-adapters/buildingreports/adapter.js  (injected into every frame)
   │  window.__brSidekickAdapter.{detect, getAllRecords,
   │    applySingleServiceChange, applySingleBatteryChange}
   ▼
BuildingReports' own ExtJS grid/store/Save button/API
```

Plus, running entirely inside the background service worker (pure JS, no
DOM):

```
cleanup/engine.js  →  cleanup/classify.js  →  cleanup/{device-type-matcher,one-hitter,service-parser}.js
                                            ↖  config/inspection-profiles/{annual,semi-annual}.js

cleanup/battery-engine.js  →  cleanup/rules/battery-cleanup.js

cleanup/repair-engine.js  →  cleanup/repair-battery.js  (also imported directly into popup.js)

cleanup/write-queue.js  (shared by all six: Service/Battery/Repair × Apply/Undo)
```

`battery-engine.js`/`rules/battery-cleanup.js` are a second, independent
cleanup pipeline (see "Battery Cleanup: a second, universal cleanup action"
below) - they share the site adapter and the popup/background message
plumbing with Service Cleanup, but have their own classification logic, no
inspection-profile dependency, and their own Undo storage key.
`repair-engine.js`/`repair-battery.js` are a third, architecturally
different pipeline (see "Repaired/Fixed" below) - human-driven rather than
classify-everything, and `repair-battery.js` is the one pure-logic module
in this codebase imported directly into `popup.js` rather than only ever
running inside the background service worker.

## Why MAIN-world script injection instead of a content script

BuildingReports is a classic ExtJS 6.5 app with all of its state living on
`window.Ext` inside a nested frame (see
`docs/buildingreports-dom-map.md`). A normal (isolated-world) content
script cannot see `window.Ext` at all. The adapter is instead injected with
`chrome.scripting.executeScript({ world: 'MAIN', ... })` directly from the
background service worker, on demand (Preview/Apply/Undo/detect), rather
than declared as an always-on `content_scripts` entry. This keeps the
extension inert until you actually open the popup and click something, and
avoids maintaining any persistent state in the page.

Because MAIN-world code has no access to `chrome.*` APIs, the split is:

- `adapter.js` (MAIN world): everything that touches `window.Ext` -
  detecting the report, reading every device record, writing a Service
  value and clicking Save, and confirming persistence via `Ext.Ajax`
  events. Returns plain, JSON-serializable results.
- `background.js` (extension/isolated world): the only place that calls
  `chrome.scripting.executeScript`, decides *which* frame is the real one
  (`allFrames: true`, then picks whichever frame's `detect()` didn't return
  `null`), runs the pure cleanup engine against the records the adapter
  returned, and persists Undo data in `chrome.storage.local`.
- `popup.js`: only talks to `background.js` via `chrome.runtime.sendMessage`
  - it never touches the report tab directly.

## Why the cleanup engine is pure logic with no Ext/DOM dependency

`src/cleanup/*.js` and `src/config/inspection-profiles/*.js` import only
`src/shared/text-utils.js` and each other - no `chrome.*`, no `window`, no
DOM. This is what makes `tests/*.test.js` able to run under plain
`node --test` with zero mocking, and is what makes adding a new rule (see
`docs/adding-a-rule.md`) a matter of editing config/logic files that have
nothing to do with the browser.

`runCleanup(records, profile)` in `engine.js` is the single entry point:
given the plain records array the adapter returned and a profile object,
it returns a summary with per-record classifications, bucket counts, and
the list of safe changes. `background.js` calls this once for Preview
(display only) and once again at the start of Apply (source of truth for
what actually gets written - Preview and Apply never trust a stale cached
result).

## Duplicate-run guards

Two independent guards prevent double-runs:

1. `background.js` keeps a single in-memory `Set` of tab IDs currently
   running Apply/Undo (`applyInProgress`) - shared across *both* Clean Up
   Service Entries and Battery Cleanup, since they write through the same
   report/store/Save button and must never overlap - and rejects a second
   call with `{ ok: false, error: 'already-running' }`. `resumeOperation`
   also takes this guard for the duration of the resumed run.
2. `adapter.js` keeps a single module-level `busy` boolean inside the page
   itself, shared by `applySingleServiceChange` and
   `applySingleBatteryChange` (both are thin wrappers around the same
   `applySingleFieldChange`), so even a stray second injection targeting the
   same frame can't overlap an in-flight save from either action.
3. A third guard is structural, not a flag: `runNewOperation` in
   `background.js` refuses to start a brand-new Apply/Undo of a given kind
   (`serviceApply`/`serviceUndo`/`batteryApply`/`batteryUndo`) if a
   checkpoint for that exact kind is already sitting paused in
   `chrome.storage.local` - see "Throttled write queue" below. Otherwise a
   fresh Apply could silently overwrite (lose) an interrupted run's
   remaining items.

## Versioned adapter re-injection

`background.js` injects `adapter.js` before every action (`ensureAdapterInjected`),
and the file's top-level guard used to be `if (window.__brSidekickAdapter)
return;` - safe against redundant re-injection *within* one extension
lifetime, but it meant that reloading the extension during development
(picking up new adapter.js code) left an already-open report tab still
running the OLD `window.__brSidekickAdapter` object forever, since the
guard's own presence check prevented the new code from ever replacing it.
The fix: `adapter.js` now defines a bumped `ADAPTER_VERSION` constant and
the guard becomes `if (window.__brSidekickAdapter &&
window.__brSidekickAdapter.version >= ADAPTER_VERSION) return;` - a
same-or-newer adapter already on the page is left alone (preserving its
in-flight `busy` state across the many injections in one popup session),
but a genuinely older one is fully replaced by re-running the IIFE. Bump
`ADAPTER_VERSION` whenever `adapter.js` changes. Confirmed live: with a
stale adapter object left in the tab, reloading the extension and running
Preview/Apply again picks up the new logic with no tab reload required.
`ADAPTER_VERSION` is currently `5`; version 3 was introduced when the bulk
`applyFieldChanges(changes[])`/`applyServiceChanges`/`applyBatteryChanges`
API was replaced with the single-record `applySingleFieldChange(scannumber,
fields)`/`applySingleServiceChange`/`applySingleBatteryChange` API (see
"Throttled write queue" below for why), version 4 adds the read-only
`areasuite` field needed for Left/Right Battery pairing, and version 5 adds
`installDate` (Battery Cleanup's expiration rule, replacing `inspectionDate`
- see `docs/battery-cleanup-rules.md`) plus `COMMS_FIELD_MAP` and
`applySingleServiceFieldsChange` for Clean Up Service Entries' new
Communicator/Communication Line/Monitoring rules (see
`docs/cleanup-rules.md`).

## Throttled write queue

**Why this exists:** confirmed live on a real 228-device report - clicking
BuildingReports' own Save button while N records are dirty fires N
`deviceWrite` POSTs essentially concurrently, and BuildingReports
rate-limits that (`410 Rate Limit Exceeded` past a threshold well under 197
concurrent requests in the observed case). See
`docs/buildingreports-dom-map.md` §5.1 for the full incident writeup
(exact error text, timing, and the finding that a lone isolated save
completes in ~330ms with no issue). The fix has to be client-side pacing,
since BuildingReports returned no `Retry-After` header and has no
documented bulk-save endpoint for `service`/Battery-attribute fields.

`src/cleanup/write-queue.js` is the shared, pure-logic (no `chrome.*`, no
DOM) coordinator used by **all six** write operations - Service Cleanup
Apply/Undo, Battery Cleanup Apply/Undo, and Repaired/Fixed Apply/Undo:

- **Concurrency exactly 1.** `runQueue(checkpoint, { saveFn, onProgress,
  delayFn, shouldCancel })` awaits one item's `saveFn` result before moving
  to the next; the caller's `saveFn` is what actually calls into
  `adapter.js`'s single-record save.
- **Checkpointing.** A checkpoint is a plain JSON-serializable object:
  `{ kind, inspectionId, cursor, minDelayMs, items: [{ scannumber,
  writeValue, priorValue, status, error }], paused, cancelled, gaveUp,
  consecutiveRateLimitHits, ... }`. `background.js` persists it to
  `chrome.storage.local` (key `brSidekick.checkpoint.<kind>.<inspectionId>`)
  after **every single item**, via `onProgress` - so closing the popup
  mid-run never loses progress, and the popup's `operationStatus` message
  polls this same storage to show live "Saving device N of M" text.
- **Rate-limit handling.** `isRateLimitResponse(bodyText)` matches
  BuildingReports' error text (see dom-map §5.1); the adapter's
  `applySingleFieldChange` also treats an ambiguous 30s timeout as
  rate-limited rather than a hard failure (a timeout right after a
  rate-limited burst couldn't be proven to be a real rejection - see the
  dom-map for why). A rate-limited/timed-out item is marked
  `pausedRateLimit`, never `failed`, and every item after it in the queue
  stays untouched/`pending` - `advance()` in write-queue.js is explicit
  about this. `runQueue` auto-retries the *same* item with exponential
  backoff (`backoffDelayMs`, capped at `MAX_BACKOFF_MS`) up to
  `MAX_RATE_LIMIT_RETRIES` (5) consecutive hits, then stops and marks the
  checkpoint `gaveUp` - at that point only a manual Resume continues it
  (see "Rate-limit handling" bullets 9-10 in the task this was built for:
  bounded automatic retries, then a human decides).
- **Pause vs Cancel Remaining vs give-up** are three related but distinct
  stop conditions, all surfaced to the popup:
  - *Pause* (user-triggered, `pauseOperation` message): stops before the
    next item starts; the checkpoint stays in storage for `resumeOperation`.
  - *Cancel Remaining* (user-triggered, `cancelOperation` message): also
    stops before the next item, but `background.js` discards the
    checkpoint afterward instead of leaving it resumable - completed items
    keep their Undo entries (already merged as they completed) either way.
  - *Give-up* (automatic, after `MAX_RATE_LIMIT_RETRIES`): checkpoint stays
    in storage, same as Pause - this is exactly the "pause and show a
    Resume button instead of hammering the server" case.
  Both Pause and Cancel Remaining are implemented as the same
  `shouldCancel()` signal into `runQueue` (two separate in-memory flag
  `Set`s, `pauseRequested`/`cancelRequested`, keyed by `` `${tabId}:${kind}`
  ``); `background.js` distinguishes which one actually fired
  (`wasExplicitCancel`) only to decide whether to keep or discard the
  checkpoint afterward - `write-queue.js` itself doesn't need to know the
  difference.
- **Resuming.** `prepareResume(checkpoint)` clears `paused`/`cancelled`/
  `gaveUp`/`consecutiveRateLimitHits` and hands the *same* checkpoint (same
  `cursor`, so already-completed items are never re-saved) back into
  `runQueue`. A JSON round-trip (`chrome.storage.local` get/set) doesn't
  lose anything a live in-memory checkpoint has, by design - that's what
  makes "resume after the popup was closed" work.
- **Refusing to clobber a paused run.** `runNewOperation` checks for an
  existing checkpoint of the same kind before creating a new one and
  refuses (`refusedAlreadyPaused: true`) rather than silently starting a
  second, conflicting run over it - the popup surfaces this as "a previous
  run is still paused" and re-shows the Resume banner.

Every write operation's `items` carry `writeValue` (what this operation
writes) and `priorValue` (what it's replacing) using the SAME generic
shape for Service (`writeValue`/`priorValue` are strings) and Battery
(`writeValue`/`priorValue` are semantic field-name objects, e.g.
`{ ratedVoltage: '12.00' }`) - `write-queue.js` never looks inside these,
it just carries them through to build the Undo entry once an item is
confirmed saved.

## Undo

Every write operation - Apply *and* Undo, Service *and* Battery - runs
through the same throttled write queue above. An Undo entry
`{ scannumber, before, after }` is written to `chrome.storage.local` for
every item a run actually confirmed saved (`status` `saved`/`verified`/
`restored`), even if the overall run paused or was cancelled partway
through - never for an item the run never got to. Clean Up Service Entries
uses key `brSidekick.undo.<inspectionId>`; Battery Cleanup uses a separate
key, `brSidekick.batteryUndo.<inspectionId>`, so the two actions' Undo
histories never cross-contaminate each other even on the same report - and
neither ever shares a checkpoint kind with the other. Both are keyed per
report, so switching reports doesn't cross-contaminate Undo state either.
A partial Apply's Undo entries are additive (`mergeUndoEntries`): resuming
an interrupted Apply merges its newly-confirmed items into whatever the
same run already saved before pausing, rather than overwriting them.
Undo itself reads its own entries, builds the exact reverse item list
(`writeValue`/`priorValue` swapped), and runs it through the *same*
`runQueue` coordinator - so Undo gets the same pacing, checkpointing,
rate-limit handling, and Resume/Cancel Remaining behavior as Apply, for
free. Only the entries actually confirmed restored are dropped from
storage; anything left pending (paused/cancelled) stays tracked for a
later Resume or a plain retry of Undo.

**"Undo Last Cleanup" undoes the report's entire accumulated Undo
history, not just the run you just did (confirmed live, 2026-08-06,
real incident):** the button label suggests "the last run," but
`handleUndo` reads and processes every entry currently sitting in
`brSidekick.undo.<inspectionId>` - if a *prior session's* Apply was never
fully undone (e.g. its Undo was never run at all, or was interrupted and
the popup closed), those old entries stay in `chrome.storage.local`
indefinitely and get silently merged with the next Apply's entries the
next time anyone uses this extension on that report, at any point in the
future. A later click of "Undo" then reverts ALL of it in one go - both
the run you meant to undo and the old leftover one, in whatever order the
entries were stored, with no way to tell them apart from the button alone.
Live testing hit exactly this on a real report: clicking Undo for a 3-item
test run actually started processing 107 items (104 leftover from an
earlier session's ~100-record Apply that was apparently never fully
undone, silently merged with the 3 new ones), and 36 of the leftover
items were reverted (from correct back to a stale pre-cleanup value)
before it was caught and paused. Recovery was straightforward here (a
fresh Preview+Apply on the live report re-detected and re-fixed exactly
those 36 records), but the underlying risk is real: **before running Undo
on a live report during testing, check `chrome.storage.local`'s
`brSidekick.undo.<inspectionId>` / `brSidekick.batteryUndo.<inspectionId>`
entry count first** (e.g. via `chrome.storage.local.get(null)` in the
popup's own console) rather than assuming it only contains what you just
applied. If it's larger than expected, treat every entry as suspect,
verify (or re-derive via a fresh Preview) before trusting any of it, and
discard the stored key entirely once the report's data is confirmed
correct instead of leaving stale reversible-to-wrong entries sitting in
storage for a future session to trip over.

**Added 2026-08-24: the popup does this check automatically now.**
`background.js`'s `undoStatus` message (`handleUndoStatus`) is a read-only
peek at both storage keys' `entries.length` - `popup.js`'s "Undo Last
Cleanup" click handler calls it before showing the confirm dialog, so the
confirmation always states the real current entry counts ("This restores N
Service field(s) and M Battery field(s)...") instead of a generic "Undo the
last cleanup run?" with no numbers. This makes the manual check above
automatic for normal use, but doesn't change the underlying behavior it's
warning about - Undo still reverts the *entire* accumulated history for
each kind, not just one run, so an unexpectedly large N/M in that
confirmation is still the signal to stop and investigate rather than click
through.

## Battery Cleanup: a second, universal cleanup action

Battery Cleanup (`src/cleanup/rules/battery-cleanup.js` +
`src/cleanup/battery-engine.js`) is architecturally a sibling to Clean Up
Service Entries, not a variant of it - added by following
`docs/adding-a-rule.md`'s "wholly new cleanup action" path:

- No inspection profile: it applies the same rules to every report
  regardless of the popup's Annual/Semi-Annual selector, so
  `runBatteryCleanup(records)` takes only the records array.
- Field-level, not bucket-per-record, classification: a single Battery can
  need several independent fixes at once (e.g. a formatting fix *and* a
  Model Number correction), so `classifyBatteryRecord` returns
  `{ fieldChanges, reviewFlags }` per record rather than one bucket - see
  `docs/battery-cleanup-rules.md` for the full rule reference and bucket
  table.
- After per-record classification, `battery-engine.js` performs the one
  report-level rule: a proven failure propagates across an unambiguous
  Left/Right pair matched by Floor, Direction, Location, Description, and
  Area/Suite. The counterpart's fields are folded into the same per-device
  change object and use the existing write queue unchanged.
- One save per device: `applySingleBatteryChange` in the adapter groups
  every changed field for a given Battery into a single
  `rec.set({...})` call before the shared Save-button flow runs, so a
  Battery with five field issues is written and verified as one dirty
  record, not five - and that one record is one *item* in the write queue,
  paced the same as every other item regardless of how many fields it
  bundles.
- BuildingReports field-name translation lives entirely in
  `adapter.js`'s `BATTERY_FIELD_MAP` - the pure logic in
  `rules/battery-cleanup.js` only ever sees semantic names (`ratedVoltage`,
  `minAh`, ...), never BuildingReports' internal dataIndex quirks (e.g.
  `velocity1door`, a generic "Air Flow Value" column repurposed as "Min Ah"
  for Battery devices).
- `applySingleServiceChange` and `applySingleBatteryChange` are both thin
  wrappers around one shared `applySingleFieldChange(scannumber, fields)`
  in the adapter, so the single-record save/verify mechanics described in
  `docs/buildingreports-dom-map.md` §5 and §5.1 are written once and reused
  by both actions - and both go through the exact same
  `cleanup/write-queue.js` coordinator from `background.js` (see
  "Throttled write queue" above), just with different `saveItemFn`s.
- **UI note (changed 2026-08-24):** Battery Cleanup no longer has its own
  Preview/Apply/Undo buttons in the popup - `previewBtn`/`applyBtn`/
  `undoBtn` in `popup.js` now trigger the Service Cleanup message (`preview`/
  `apply`/`undo`) and then the Battery Cleanup message (`batteryPreview`/
  `batteryApply`/`batteryUndo`) sequentially on every click, rendering both
  summary panels. This is a UI-only merge - background.js is completely
  unchanged by it, and everything above (separate checkpoint kinds,
  separate Undo storage keys/history, independent write-queue runs) is
  still exactly as independent as before. A Service-side rate-limit
  give-up or already-paused checkpoint does not block the Battery half from
  running (and vice versa) - see the applyBtn/undoBtn handlers in
  `popup.js`.

## Repaired/Fixed: a third, human-driven cleanup action

**Added 2026-08-24.** `src/cleanup/repair-engine.js` +
`src/cleanup/repair-battery.js`/`repair-generic.js` are architecturally a
third sibling to Clean Up Service Entries and Battery Cleanup, but a
genuinely different shape - see `docs/repair-fixed-rules.md` for the full
rule reference:

- **Human-driven, not classify-everything.** Unlike Preview/Apply for the
  other two actions, nothing here is auto-classified from report data -
  "was this device repaired/replaced?" isn't derivable, so a human answers
  it for every device that needs asking. `repair-engine.js`'s
  `scanFailedDevices(records)` is the only automatic part: it filters to
  `passed === false` devices (in report order) so the popup only ever asks
  about devices that actually need it.
- **Every "yes" gets a form - never a dead-end review flag.** Battery has
  its own (`repair-battery.js`); every other device type gets a generic
  one (`repair-generic.js`, added same day, explicitly requested) as a
  placeholder until a real pattern is identified for that device type -
  `repair-engine.js`'s `getRepairRuleKey` always returns one or the other.
- **Pure logic imported directly into the popup**, not just the background
  service worker. Both rule files' `buildXxxRepairChange(record, input)`
  have zero `chrome.*`/DOM dependency (same as every other `cleanup/*`
  module), so `popup.js` imports them directly (`popup.html` already loads
  `popup.js` as `type="module"`) and computes each device's write payload
  the instant its form is submitted, without a round-trip through
  `background.js` - the wizard needs to react to each answer immediately,
  and there's nothing about the computation that needs to run in the
  service worker specifically.
- **Nothing is written until "Apply Repairs" is clicked.** The popup
  accumulates a `repairPendingItems` array purely in its own in-memory
  state as the human answers each device; only the final click sends the
  whole batch to `background.js`'s `handleRepairApply`, which runs it
  through the exact same `cleanup/write-queue.js` coordinator as every
  other write path (checkpoint kind `repairApply`). A single run can mix
  Battery and generic-device items, so each item carries a `deviceKind`
  (`'battery'` | `'generic'`, set by `popup.js` when the item is queued)
  and `background.js`'s `saveRepairItem` routes per-item to the correct
  adapter path (`saveBatteryItem` for Battery's semantic-name-translated
  fields, `saveServiceItem` for the generic rule's plain
  already-real-dataIndex fields) - `deviceKind` is carried through the
  checkpoint and into the Undo entry so a later Undo routes correctly too.
- **Own checkpoint kinds and Undo history**, kept separate from Battery
  Cleanup's (`repairApply`/`repairUndo`, `brSidekick.repairUndo.
  <inspectionId>`) even though both can write the same Battery fields -
  same "never cross-contaminate" reasoning as Service vs. Battery. Reuses
  `background.js`'s fully generic resumable-operation machinery
  (`SAVE_FNS`/`UNDO_KEY_FNS`, `handleOperationStatus`/
  `handleResumeOperation`/etc. already take `kind` as a plain string) - no
  new resume/pause/cancel/discard code was needed, just two more entries
  in those maps.
- **A genuinely new adapter capability: writing Install Date.** Every
  other field this extension has ever written was already writable before
  this feature - Install Date was deliberately read-only everywhere (see
  the "Battery Cleanup" section above and `docs/battery-cleanup-rules.md`).
  `adapter.js` gained `BATTERY_DATE_FIELD_MAP` (kept separate from
  `BATTERY_FIELD_MAP` since it needs a real value transform, not just a
  rename) and `parseLocalDateOnlyString` - the inverse of the existing
  `toLocalDateOnlyString`, parsing this extension's own `"YYYY-MM-DD"`
  string convention back into a real `Date` at local midnight. Confirmed
  live with no timezone/off-by-one-day issues (`ADAPTER_VERSION` bumped to
  7).
- **A real CSS bug found during live testing:** `.hidden`'s
  `display: none` lost a cascade tie against `.actions`' `display: flex`
  when both classes landed on the same element (`repairYesNoBar`, a
  `<div class="actions">` toggled hidden directly by `popup.js`) - both are
  single-class selectors, and `.actions` is defined later in `popup.css`,
  so it won. Fixed by making `.hidden` use `!important` (documented inline
  in `popup.css` - it's meant to be an unconditional "hide no matter what"
  utility class). This had been latent in the codebase before this
  feature; it just never manifested until something toggled `.hidden`
  directly on an `.actions` container.

## Data flow for "process the entire report"

There is no pagination/scrolling logic anywhere in this codebase. As
established in `docs/buildingreports-dom-map.md` §4, the whole report's
device list is already resident in the ExtJS store; the adapter just clears
the two client-side quick-filters and calls `store.each(...)`. If a future
report shape turns out to have real server-side paging, that logic would
live entirely inside `adapter.js`'s `getAllRecords()` - nothing above it
would need to change.
