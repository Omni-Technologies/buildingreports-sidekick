# CLAUDE.md — BuildingReports Sidekick

Read this first, every session. It's the whole mental model in one file.
For deeper detail, see the docs it points to — don't re-derive things this
file already answers.

## What this is

A local, unpacked Chrome extension (Manifest V3, no build step) that adds
one-click cleanup tools to BuildingReports.com fire/life-safety inspection
reports, operated from a popup on the report's **Device Editor** page.

## Currently working cleanup actions

1. **Clean Up Service Entries** — normalizes each device's `Service` field
   to a canonical "Visual [& Functional], Passed/Failed[ - note]" string.
   Two selectable Inspection Profiles, **both enabled**: **Annual** and
   **Semi-Annual** (see below for how they differ). Preview / Apply / Undo.
2. **Battery Cleanup** — normalizes Battery devices' Rated Voltage/Amps/
   Post Test/Tested Ah formatting, clears Pre Test, recalculates Min Ah,
   corrects Model Number, and sets the Passed/Failed outcome from Inspection
   Date + Tested Ah vs Min Ah. Universal (no Inspection Profile). Preview /
   Apply / Undo, fully independent of Service Cleanup (separate Undo
   history). Full rule reference: `docs/battery-cleanup-rules.md`.

Both actions share one popup, one background service worker, one site
adapter, and — critically — one paced write coordinator (see below).

## Architecture

```
popup (UI)  →  chrome.runtime.sendMessage  →  background.js (service worker)
                                                  │ chrome.scripting.executeScript(world:'MAIN')
                                                  ▼
                                    adapter.js (injected into every frame)
                                                  ▼
                              BuildingReports' own ExtJS grid/store/Save button
```

Pure logic (no `chrome.*`, no DOM — unit-tested with plain `node --test`):

```
cleanup/engine.js → cleanup/classify.js → cleanup/{device-type-matcher,one-hitter,service-parser}.js
                                         ↖ config/inspection-profiles/{annual,semi-annual}.js
cleanup/battery-engine.js → cleanup/rules/battery-cleanup.js
cleanup/write-queue.js   (shared by all 4 write operations: Service/Battery × Apply/Undo)
```

Full architectural rationale (why MAIN-world injection, why the engine has
zero DOM dependency, duplicate-run guards, adapter versioning): full detail
in `docs/architecture.md`. Full BuildingReports internals (frame chain,
grid/store, save protocol, rate-limit incident, field-name quirks): full
detail in `docs/buildingreports-dom-map.md`.

## Important files

| File | Responsibility |
|---|---|
| `src/popup/popup.html`/`.js`/`.css` | UI only — sends messages, renders JSON results, never touches the report tab directly |
| `src/background/background.js` | Only place calling `chrome.scripting.executeScript`; owns Undo storage and the write-queue orchestration |
| `src/site-adapters/buildingreports/adapter.js` | **The only file that knows BuildingReports' DOM/ExtJS internals.** MAIN-world, injected on demand. Everything else is generic |
| `src/cleanup/engine.js` | `runCleanup(records, profile)` — Service Cleanup's Preview/Apply entry point |
| `src/cleanup/classify.js` | `classifyRecord(record, profile)` — the one function that buckets a single device |
| `src/cleanup/device-type-matcher.js` | Tolerant-but-exact device-type matching (case/whitespace/slash/parens), never substring/fuzzy |
| `src/cleanup/service-parser.js` | Parses/builds "Visual [& Functional], Passed/Failed[ - note]" strings — shared by every profile |
| `src/cleanup/one-hitter.js` | Heat Detector "One Hitter" free-text exception (Annual only) |
| `src/config/inspection-profiles/annual.js` / `semi-annual.js` | Per-profile device lists, preserve phrases, prefix rules |
| `src/cleanup/battery-engine.js` / `rules/battery-cleanup.js` | Battery Cleanup's report-level aggregation and per-record rules |
| `src/cleanup/write-queue.js` | Paced, checkpointed, rate-limit-aware write coordinator — pure logic |
| `tests/*.test.js` | `node --test`, synthetic fixtures only (`tests/fixtures.js`) |

## Classify → Preview → Apply → verify → Undo

- `classifyRecord(record, profile)` returns `{ bucket, before, after, reason }`.
  Buckets: `safeChange` (only one ever written), `alreadyCorrect`, `blank`,
  `ambiguousConflict`, `unsupportedDeviceType`, `customPreserved`,
  `unsupportedField`, `needsReview`. Full table: `docs/cleanup-rules.md`.
- **Preview** (`runCleanup`/`runBatteryCleanup`) never mutates anything —
  read-only classification over every device in the report (no pagination
  needed, see dom-map §4).
- **Apply** re-runs classification fresh (never trusts a stale Preview),
  then writes only `safeChange`/field-change items through the write queue,
  verifying each save via BuildingReports' own `Ext.Ajax` response, not
  optimistic client state.
- **Undo** reads `{ scannumber, before, after }` entries written by the last
  Apply, reverses them, and runs the reverse list through the *same* write
  queue — same pacing, same verification.

## Annual vs Semi-Annual Service Cleanup

Both profiles share the same supported-device list, preserve phrases, and
parsing tolerance — only the canonical **prefix** differs:

- **Annual**: every supported device type gets `Visual & Functional` —
  except a Heat Detector with a confirmed "One Hitter" free-text marker
  (scanned across description/location/direction/comment/note/solution/
  modelnumber/service), which gets `Visual` instead. An ambiguous marker
  (e.g. "1 hitter") is flagged `needsReview`, never guessed.
- **Semi-Annual**: only five device types (Annunciator, Battery, Control
  Panel, Indicating Device, Power Supply) get `Visual & Functional`; every
  other supported device type gets `Visual`. No One Hitter exception (Heat
  Detector isn't in the five, so it already gets `Visual`).

Prefix precedence in `classify.js`: One Hitter exception → per-device-type
group check (`isVisualFunctionalDeviceType`) → profile's `standardPhrase`
fallback. Full rule reference: `docs/cleanup-rules.md`.

## Battery Cleanup

Independent pipeline, no Inspection Profile, field-level (not
bucket-per-record) classification since one Battery can need several fixes
at once. Full rule reference: `docs/battery-cleanup-rules.md`.

## The shared paced write queue — READ THIS BEFORE WRITING ANY NEW RULE

**BuildingReports rate-limits bursts of concurrent `deviceWrite` requests.**
Confirmed live: firing ~200 concurrent saves (the old behavior — set every
dirty record, click Save once) got most of them rejected with
`410 Rate Limit Exceeded` and no `Retry-After` header. A single isolated
save completes in ~330ms with no issue. Full incident writeup:
`docs/buildingreports-dom-map.md` §5.1.

**Rule: every write, no exceptions, goes through
`src/cleanup/write-queue.js`'s `runQueue` at concurrency exactly 1** —
one record set dirty, saved, verified, THEN the next. Never call
`adapter.js`'s single-record save functions in a loop without the queue's
pacing/backoff. This applies to Service *and* Battery, Apply *and* Undo,
and to any future write-based rule.

- **Checkpointing**: `background.js` persists the checkpoint to
  `chrome.storage.local` (`brSidekick.checkpoint.<kind>.<inspectionId>`,
  `kind` ∈ `serviceApply`/`serviceUndo`/`batteryApply`/`batteryUndo`) after
  **every single item** — closing the popup mid-run never loses progress.
- **Rate-limit handling**: on a rate-limit response (or an ambiguous
  30s timeout — can't be proven safe, see dom-map 5.1), the item is marked
  `pausedRateLimit` (never `failed`), and `runQueue` auto-retries with
  exponential backoff up to `MAX_RATE_LIMIT_RETRIES` (5), then stops and
  marks the checkpoint `gaveUp` — a human must click **Resume**.
- **Pause / Cancel Remaining**: user-triggered stops. Pause keeps the
  checkpoint resumable; Cancel Remaining discards it (completed items keep
  their Undo entries either way — `mergeUndoEntries` is additive).
- **Refuses to clobber**: starting a fresh Apply/Undo of a kind that
  already has a paused checkpoint is refused (`refusedAlreadyPaused`) —
  Resume or discard it first.

Full design: `docs/architecture.md`'s "Throttled write queue" section.

## The BuildingReports ExtJS adapter

`adapter.js` (MAIN-world, injected on demand, `window.__brSidekickAdapter`,
currently `ADAPTER_VERSION = 3`) exposes: `detect`, `getAllRecords`,
`applySingleServiceChange(scannumber, newValue)`,
`applySingleBatteryChange(scannumber, semanticFields)`, `isBusy`. It is the
**only** file allowed to touch `window.Ext`. Frame chain: top → topframe
(`view-inspection-log`) → the actual Device Editor frame (`load-device-
edit-page`) — injected into every frame, self-detects which one is real.
Never call `location.reload()` or navigate the top frame. Full detail,
selector stability notes, and repair steps: `docs/buildingreports-dom-map.md`.

## Known BuildingReports field mappings

| Semantic name | Real dataIndex | Note |
|---|---|---|
| `ratedVoltage` | `voltage` | |
| `amps` | `amps` | |
| `preTest` | `pretestvoltage` | |
| `postTest` | `posttestvoltage` | |
| `minAh` | `velocity1door` | Quirk: generic "Air Flow Value" column, repurposed |
| `testedAh` | `velocity2door` | Quirk: same as above |
| `modelNumber` | `modelnumber` | |

`passed`, `service`, `comment`, `solution`, `note` pass through unchanged
(their semantic name already is the real dataIndex). Inspection frequency
(Annual/Semi-Annual) is **not** in the Device Editor frame at all — it
lives one frame up, on the inspection-log grid (`frequency`/
`frequencyname` fields) — not currently read by this extension. Full
detail: `docs/buildingreports-dom-map.md`.

## Running tests

```
npm test
```

`node --test tests/*.test.js` — 116 tests as of this writing, synthetic
fixtures only (`tests/fixtures.js`), zero mocking, zero DOM. Run this after
every change. See `docs/current-state.md` for the current exact count.

## Loading / reloading the unpacked extension

1. `chrome://extensions` → enable Developer mode → "Load unpacked" → select
   this folder.
2. After editing any `src/` file: use the Chrome DevTools MCP
   `reload_extension` tool (or the extensions page's reload button), then
   `trigger_extension_action` (or click the toolbar icon) to reopen the
   popup fresh — old popup instances don't pick up new code.
3. Bump `ADAPTER_VERSION` in `adapter.js` whenever that file changes — a
   same-or-newer adapter left in an already-open tab is otherwise never
   replaced.

## Connecting through Chrome DevTools MCP

**Always attach to the existing, already-authenticated BuildingReports
report tab.** At the start of any browser-driven session:

1. Confirm the MCP connection.
2. `list_pages` — find the real BuildingReports.com tab.
3. `select_page` it, then verify it's the real report (not a blank page)
   before doing anything else — e.g. confirm `window.Ext` and
   `window.ReportInspectionId` exist inside the Device Editor frame.

**If MCP opens or shows only a blank Chrome window: stop.** Do not continue
testing against it, do not silently switch to another automation method,
and do not treat a blank page as the report. Re-check the MCP connection,
re-list pages, and ask the user to reconnect or point you to the right tab
if it genuinely can't be found.

## Safety restrictions

This extension only ever edits a device's `Service` field or Battery
attribute fields, through BuildingReports' own Save button/save API. It has
**no** functionality to submit, certify, finalize, sign, distribute, or
delete a report, building, or device record, and none should ever be added
under this project without an explicit, separate request — that's a
fundamentally different risk class (irreversible, customer/compliance-
facing) than normalizing a formatting string. If a requested rule would
require anything beyond reading/writing `Service` or Battery-attribute
fields via the existing adapter methods, stop and ask before implementing.

Also: every write operation touches a **real, live customer report** the
moment it's connected via MCP — there is no sandbox/staging environment.
Treat any live Apply/Undo test as production-affecting; get explicit
confirmation before a full-report (not a small controlled set) Apply, and
never fire writes outside the paced queue (see above).

## Where to add new rules / required workflow

See `docs/adding-a-rule.md` for the full "which file(s) does a new rule
touch" guide, and **`docs/new-rule-checklist.md` for the required
step-by-step workflow every new rule must follow** — read that before
starting any rule work. `docs/rule-inventory.md` lists what's already
implemented; `docs/rule-request-template.md` is the fill-in template for a
new rule request.
