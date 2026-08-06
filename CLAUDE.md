# CLAUDE.md — BuildingReports Sidekick

Read this first, every session. It's the whole mental model in one file.
For deeper detail, see the docs it points to — don't re-derive things this
file already answers.

## Starting a session

Before touching any code, every session:

1. Read `CLAUDE.md` (this file).
2. Read `docs/current-state.md`.
3. Read `docs/rule-inventory.md`.
4. Read `docs/web-store-status.md`.
5. Read the documentation for whichever cleanup action you're about to
   change (`docs/cleanup-rules.md` for Service Cleanup,
   `docs/battery-cleanup-rules.md` for Battery Cleanup).
6. Run `git status` and inspect it before editing anything — know what's
   already staged/modified/untracked before you add to it.

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
   corrects Model Number, sets the Passed/Failed outcome from Inspection
   Date + Tested Ah vs Min Ah, and propagates a proven failure across an
   unambiguous matching Left/Right Battery pair. Universal (no Inspection
   Profile). Preview / Apply / Undo, fully independent of Service Cleanup
   (separate Undo history). Full rule reference:
   `docs/battery-cleanup-rules.md`.

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
currently `ADAPTER_VERSION = 4`) exposes: `detect`, `getAllRecords`,
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

`node --test tests/*.test.js` — 132 tests as of this writing, synthetic
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

## Chrome Web Store listing

BuildingReports Sidekick has **one existing Chrome Web Store listing**,
submitted with **Unlisted** distribution. Version `0.1.1` was the initial
submitted package. `docs/web-store-status.md` tracks current status
(latest generated/submitted/approved version, whether permissions or
privacy disclosures need updating) — update it whenever you generate a
release, and update its submitted/approved fields only when the user
explicitly tells you a version was submitted or approved. Never guess
approval status.

Rules that follow from there being one listing:

- **Never create a new Chrome Web Store item for a normal update.** Every
  future release uploads to the *same* existing Unlisted listing — see
  `RELEASING.md` for the full upload/rollback workflow.
- Coworkers who installed from the unlisted link keep the same installed
  extension and receive future approved updates automatically through
  Chrome's normal update mechanism — no reinstall, no new link, ever.
- **The locally-loaded unpacked extension and the Chrome Web Store
  release ZIP are different artifacts with different purposes** — never
  conflate them. The unpacked folder (`chrome://extensions` → Load
  unpacked, described above) is for development/testing only. The
  generated `releases/*.zip` (via `npm run release:*`, see `RELEASING.md`)
  is what actually gets uploaded to the Web Store. "I tested it locally"
  is not the same claim as "it's ready for the store" — see "Normal
  feature completion vs. Chrome Web Store release" below.
- Never store Chrome Web Store account passwords, credentials, access
  tokens, or other private account information anywhere in this repo.

## Connecting through Chrome DevTools MCP

**Always attach to the existing, already-authenticated BuildingReports
report tab.** At the start of any browser-driven session:

1. Confirm the MCP connection.
2. `list_pages` — find the real BuildingReports.com tab.
3. `select_page` it, then verify it's the real report (not a blank page)
   before doing anything else — e.g. confirm `window.Ext` and
   `window.ReportInspectionId` exist inside the Device Editor frame.

**If MCP opens or shows only a blank Chrome window, or launches a
new/separate Chrome instance instead of attaching to the existing one:
stop.** Do not continue testing against it, do not silently switch to
another automation method, and do not treat a blank page (or the new
instance) as the report. Re-check the MCP connection, re-list pages, and
ask the user to reconnect only when it genuinely can't be found any other
way.

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

## Definition of done for every feature

After every successfully implemented feature or cleanup rule, before
considering it finished:

1. Run the complete automated test suite (`npm test`).
2. Test Preview before Apply.
3. Perform only the minimum necessary live BuildingReports testing (a
   small, hand-picked set of real devices — see
   `docs/new-rule-checklist.md` step 10).
4. Verify Apply, save, and persistence against the real report.
5. Test Undo whenever fields were actually changed — but check
   `chrome.storage.local`'s `brSidekick.undo.<inspectionId>`/
   `brSidekick.batteryUndo.<inspectionId>` entry count *before* clicking
   Undo, not after. "Undo Last Cleanup" undoes the report's entire
   accumulated Undo history, not just your run — a real incident (see
   `docs/architecture.md`'s Undo section) found 104 leftover entries from
   a prior, never-fully-undone session silently merged with a new 3-item
   run, and Undo started reverting all 107 before it was caught.
6. Restore deliberate test modifications on the live report when
   appropriate — it's a real customer report, not a sandbox. Also clear
   any stale leftover Undo storage entries once the report is confirmed
   correct, rather than leaving them for a future session to trip over.
7. Confirm unrelated cleanup actions (the other of Service/Battery
   Cleanup, and the other Inspection Profile) still work.
8. Update `docs/current-state.md`.
9. Update `docs/rule-inventory.md`.
10. Update the relevant rule documentation (`docs/cleanup-rules.md`,
    `docs/battery-cleanup-rules.md`, or both).
11. Update `docs/buildingreports-dom-map.md` for any new under-the-hood
    discovery (selectors, field mappings, quirks).
12. Review the Git diff for customer information, report IDs,
    scannumbers, logs, recovery data, credentials, or secrets before
    staging anything.
13. Commit the known-working feature locally with a descriptive commit
    message.
14. Report whether manifest permissions, host permissions, privacy
    behavior, or data handling changed — explicitly say "unchanged" if
    they didn't.
15. Report whether a Chrome Web Store release is recommended for this
    change — but do not generate one unless explicitly requested (see
    "Normal feature completion vs. Chrome Web Store release" below).

The identical checklist also lives in `docs/new-rule-checklist.md`
alongside its more detailed step-by-step build guidance — this is the
"how do I know I'm done" version; that file is the "how do I build it"
version.

## Permission changes — ask first

**Never add or broaden a Chrome permission or host permission without
explicitly warning the user first.** If a requested feature appears to
need a new permission:

1. Explain why the existing permissions (`scripting`, `storage`,
   `activeTab`, and the `https://www.buildingreports.com/*` host
   permission) are insufficient for it.
2. Identify the exact new permission needed.
3. Explain whether it can trigger additional Chrome Web Store review.
4. Explain whether installed users will have to approve the update, or
   whether Chrome may disable the extension for them until they do (see
   `RELEASING.md`'s "Handle updates that introduce new permissions"
   section).
5. Look for a design that works within the existing permission set
   first — most new data needs can be met by extending `adapter.js`'s
   existing JSON-in/JSON-out methods rather than requesting broader
   access.
6. Wait for explicit approval before actually changing `manifest.json`'s
   `permissions`/`host_permissions`.

After every feature, explicitly report one of:
- "Manifest permissions unchanged."
- "Manifest permissions changed: `<exact details>`."

## Privacy and data disclosure updates

If a feature changes any of the following, update **both** `PRIVACY.md`
and `docs/chrome-web-store-submission.md` as part of that feature, not
later:

- Data read from BuildingReports
- Data stored in `chrome.storage.local`
- External network communication
- Analytics or telemetry
- Remote services
- User authentication behavior
- Host permissions
- Chrome permissions
- The extension's primary/single purpose

**Never claim these documents remain accurate without actually checking
the current code** — re-read the relevant `src/` files; don't assume a
prior session's description still holds.

## Normal feature completion vs. Chrome Web Store release

These are two separate workflows — don't blend them.

**Normal feature completion** (the default, every time):
- Run all tests.
- Complete the live verification from "Definition of done" above.
- Update documentation.
- Commit locally.
- **Do not** bump the manifest version.
- **Do not** generate a release ZIP — unless the user explicitly asks
  for a release.

**Chrome Web Store release** (only when the user explicitly says to
prepare or publish an update):

1. Confirm the working tree is ready (all intended commits present,
   nothing half-finished).
2. Confirm no private data is tracked or would be packaged (see
   `npm run release:check`'s hygiene scan).
3. Update `CHANGELOG.md`'s `## [Unreleased]` section with what changed.
4. `npm test`
5. `npm run release:check`
6. `npm run release:dry-run`
7. `npm run release:patch` for normal fixes and new cleanup rules —
   only use `minor`/`major` if a larger version bump is specifically
   justified.
8. Validate the generated ZIP (the release script already does this
   automatically — review its output).
9. Confirm `manifest.json` is at the ZIP root (also automatic).
10. Confirm the new version number exceeds whatever's currently
    submitted or published — check `docs/web-store-status.md`.
11. Report the exact ZIP path.
12. Provide short release notes suitable for pasting into the Chrome
    Web Store dashboard.
13. Remind the user to upload the ZIP to the *existing* listing and
    submit the update for review — **never upload, publish, or submit
    through an API without the user's explicit request.**

After generating a release, update `docs/web-store-status.md`'s "Latest
locally generated version" field. Only update its submitted/approved
fields when the user explicitly tells you a version was submitted or
approved — never guess.

## Where to add new rules / required workflow

See `docs/adding-a-rule.md` for the full "which file(s) does a new rule
touch" guide, and **`docs/new-rule-checklist.md` for the required
step-by-step workflow every new rule must follow** — read that before
starting any rule work. `docs/rule-inventory.md` lists what's already
implemented; `docs/rule-request-template.md` is the fill-in template for a
new rule request.
