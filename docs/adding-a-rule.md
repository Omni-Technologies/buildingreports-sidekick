# Adding a future cleanup rule

The architecture is designed so a new one-click cleanup action normally
touches four things and nothing else:

## 1. Rule file / configuration

If the rule needs its own device-type list, phrase templates, or
preserve-phrase list (like Service cleanup does), add it under
`src/config/` (either a new key on an existing profile, or a new file next
to `src/cleanup/` if it's a wholly new kind of rule, e.g.
`src/cleanup/my-new-rule/`). Keep it pure logic - no `chrome.*`, no
`window`, no DOM - so it stays unit-testable with plain `node --test`.

Look at `src/cleanup/classify.js` + `src/config/inspection-profiles/annual.js`
as the template: matching/parsing helpers are small, single-purpose modules
(`device-type-matcher.js`, `one-hitter.js`, `service-parser.js`) that
`classify.js` composes into one `classifyRecord(record, profile)` function
returning `{ bucket, before, after, reason }`.

## 2. Register it in one obvious location

- A new **inspection profile rule**: add a new file under
  `src/config/inspection-profiles/` following `annual.js`/`semi-annual.js`'s
  shape and register it in `src/config/inspection-profiles/index.js` - the
  popup's profile `<select>` and `background.js` already treat profiles
  generically by key, so nothing else needs to change.
- A wholly **new cleanup action** (not a Service-field rule): add a new
  `runXyzCleanup(records, profile)`-style function (mirroring
  `src/cleanup/engine.js`), and register a new `message.type` case in
  `src/background/background.js`'s `chrome.runtime.onMessage` handler,
  following the existing `preview`/`apply`/`undo` pattern. If it writes
  anything back to BuildingReports, route it through the shared
  `cleanup/write-queue.js` coordinator the same way `handleApply`/
  `handleBatteryApply` do (see docs/architecture.md's "Throttled write
  queue") rather than writing multiple records in one go - BuildingReports
  rate-limits bursts of concurrent `deviceWrite` requests (see
  `docs/buildingreports-dom-map.md` §5.1). If it needs new data from the
  page, add a new method to `src/site-adapters/buildingreports/adapter.js`'s
  `window.__brSidekickAdapter` object (keep it generic and JSON-in/JSON-out
  - never leak `window.Ext` objects out of the adapter, and if it writes,
  make it a single-record save like `applySingleServiceChange`/
  `applySingleBatteryChange`, never a batch of records in one call).

## 3. Add its popup controls

Add a button/section to `src/popup/popup.html` and wire it in
`src/popup/popup.js` the same way `previewBtn`/`applyBtn`/`undoBtn` are
wired: send a message to background, render the JSON result. Reuse
`askConfirm()` for any destructive/writing action instead of
`window.confirm` (a native dialog inside a small popup is awkward and can
block automated testing/other extensions - see the inline confirm bar
pattern already in `popup.js`).

## 4. Add focused tests

Add a `tests/<rule-name>.test.js` using `tests/fixtures.js`'s `makeRecord()`
helper for synthetic data. Cover at minimum: the common "safe" variations,
an already-correct value, a blank value, a value that must be preserved
unchanged, and a genuinely ambiguous/conflicting value. Run with
`npm test`.

## Editing the existing Annual rules

Everything Annual-specific lives in
`src/config/inspection-profiles/annual.js`:

- `SUPPORTED_DEVICE_TYPES` - add/remove a device type here (exact strings;
  matching is tolerant of case/whitespace/slash/parenthetical spacing, but
  never substring/fuzzy - see `src/shared/text-utils.js`).
- `PRESERVE_PHRASES` - free-text values that must never be overwritten even
  though they contain no Passed/Failed token.
- `standardPhrase` / `oneHitterPhrase` - the two canonical prefixes.
- `ONE_HITTER_PATTERN` / `AMBIGUOUS_ONE_HITTER_PATTERN` - how a Heat
  Detector's "One Hitter" designation is recognized (see
  `docs/cleanup-rules.md` for where that text is actually found on real
  devices).

The parsing tolerance itself (how "visual and functional passed" etc. gets
recognized) lives in `src/cleanup/service-parser.js` and applies to any
profile - it is not Annual-specific.

## Editing the Communicator / Communication Line / Monitoring rules

These three device types have their own fixed Service-field shapes
(`src/cleanup/communications-parser.js`), applied identically under both
Annual and Semi-Annual - `classify.js` dispatches to
`classifyCommsRecord(record)` before the ordinary supported-device-type
check, and that function doesn't take `profile` at all. To change one of
these three rules, edit `communications-parser.js` only - see
`docs/cleanup-rules.md`'s "Communicator / Communication Line / Monitoring"
section for the current rule reference. If the new behavior needs a new
BuildingReports device-attribute field, add it to `COMMS_FIELD_MAP` in
`src/site-adapters/buildingreports/adapter.js` the same way
`BATTERY_FIELD_MAP` works (confirm the real dataIndex live via
`#deviceAttrGrid`'s column config first - see
`docs/buildingreports-dom-map.md` §7). A classification result's
`extraFieldChanges` array is what carries any field beyond `service` through
`engine.js`/`background.js` into a single multi-field write
(`applySingleServiceFieldsChange`) - no other file needs to change for a
rule tweak that stays within the existing field set.

## Adding to Battery Cleanup instead

Battery Cleanup is the reference example of the "wholly new cleanup
action" path above, already built out - see `docs/battery-cleanup-rules.md`
for its full rule reference. If you're adding a **new Battery field rule**
(not a new action), you don't need to repeat that whole path - see
"How to add the next Battery rule" at the bottom of that doc, which is the
narrower, common case: add one field check to
`src/cleanup/rules/battery-cleanup.js`, one dataIndex mapping to
`BATTERY_FIELD_MAP` in the adapter if needed, one count key to
`src/cleanup/battery-engine.js`, and tests. The popup buttons, background
message handlers (`batteryPreview`/`batteryApply`/`batteryUndo`), and the
adapter's save/verify plumbing don't change for that case.

## Editing the existing Semi-Annual rules

`src/config/inspection-profiles/semi-annual.js` is enabled and live - see
`docs/cleanup-rules.md` for the full rule reference. It imports Annual's
`supportedDeviceTypeKeys`/`supportedDeviceTypes`/`preservePhrases` wholesale
rather than duplicating them (Semi-Annual recognizes the same device types
Annual does), and adds two of its own:

- `VISUAL_FUNCTIONAL_DEVICE_TYPES` - the five device types that get "Visual
  & Functional" instead of the `standardPhrase` ("Visual") fallback every
  other supported device type gets. Add/remove a device type from this
  five-type group here.
- `visualFunctionalDeviceTypeKeys` / `visualFunctionalPhrase` - the
  generalized mechanism `classify.js` uses (via
  `isVisualFunctionalDeviceType` in `device-type-matcher.js`) to pick a
  per-device-type prefix. Annual doesn't define these fields at all, so
  it's unaffected - see `docs/cleanup-rules.md` for the full prefix
  precedence rules (One Hitter exception first, then this device-type
  check, then `standardPhrase`).

A **third** profile that needs its own device-type-to-prefix grouping (not
just a single `standardPhrase` like Annual, or a two-way split like
Semi-Annual) can reuse the same `visualFunctionalDeviceTypeKeys`/
`visualFunctionalPhrase` fields, or extend `classify.js`'s prefix
resolution further if a genuinely different grouping shape is needed -
keep that logic in `classify.js`/`device-type-matcher.js`, never duplicated
per-profile.

## Where a fourth inspection profile would go

Follow Semi-Annual's example above: a new file under
`src/config/inspection-profiles/`, registered in that directory's
`index.js`. Nothing in the popup, background, or engine needs to change -
they already treat profiles generically by key.
