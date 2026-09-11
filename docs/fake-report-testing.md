# Fake report testing (`dev/fake-report/`)

A local, fake stand-in for a real BuildingReports Device Editor page, so
most rule changes can be Previewed/Applied/Undone against realistic
scenarios **without connecting to a live customer report at all**. Added
2026-09-11, in response to wanting confidence before pushing updates
without hitting the real site every time.

## What it is

`adapter.js` (`src/site-adapters/buildingreports/adapter.js`) is the
**only** file that knows about BuildingReports' real DOM/ExtJS internals,
and it only ever touches a small, fully-documented surface (see
`docs/buildingreports-dom-map.md`):

- `Ext.ComponentQuery.query('#devicelistGrid' | '#mainPanel' |
  '#saveDeviceEditPage')`
- a grid `store` with `getStore()`/`removeFilter()`/`getCount()`/`each()`/
  `findExact()`/`getAt()`
- records with `rec.get(field)`/`rec.set(fields)`
- `mainPanel.getController().onSaveDeviceEditPage(saveBtn)`
- `Ext.Ajax.on/un('requestcomplete'|'requestexception', handler)`, matching
  the real `a=deviceWrite` request/response XML shapes
- `window.ReportBuildingId`/`ReportBuildingName`/`ReportInspectionId`/
  `ReportAppId`/`br_adm`

Nothing else in this extension depends on BuildingReports' real URL, frame
names, or the real ExtJS library — `chrome.scripting.executeScript`'s
`activeTab`-granted access works against **any** active tab, not just
`https://www.buildingreports.com/*` (that host permission exists for the
content-script-free `scripting`/`activeTab` combo to work without a user
gesture on the real site; it isn't a gate the fake page needs to pass).

So `dev/fake-report/` implements **just that surface** — not real ExtJS, not
a visual replica of BuildingReports' UI — as a static page the real unpacked
extension can attach to exactly like a real report tab:

- `fixtures.js` — seed device records (raw dataIndex field names, the same
  shape `adapter.js`'s `toPlainRecord()` produces), covering realistic
  scenarios across every implemented rule.
- `fake-ext.js` — the `window.Ext`/`window.Ext.Ajax`/`window.Report*` shim,
  plus a simulated `deviceWrite` save (success by default, with "chaos
  controls" to deliberately inject a rate-limit response, an ambiguous
  timeout, or a network error — see below).
- `index.html` — a plain table of the current fake report's device records
  (click a Service cell to hand-edit it, click Passed to toggle — same idea
  as the live-testing workflow's hand-edit step, just with no real report to
  restore afterward), plus the chaos-control inputs.
- `server.js` — a zero-dependency static file server (`npm run
  fake-report`).
- `verify.js` — a headless Node sanity check (no Chrome) that loads
  `fixtures.js` + `fake-ext.js` + the **real** `adapter.js` into a vm
  sandbox and runs every fixture record through the **real**
  `classify.js`/`battery-engine.js` pipeline — catches wiring bugs in the
  fake itself before you ever open a browser. Run with `node
  dev/fake-report/verify.js`.

## How to use it

1. `npm run fake-report` — starts the server, prints a `localhost` URL
   (default `http://localhost:8873/`).
2. Open that URL in Chrome.
3. Load the unpacked extension as usual (`chrome://extensions` → Load
   unpacked), or reload it if it's already loaded.
4. Click the extension's toolbar icon **while the fake-report tab is
   active** — `activeTab` grants it host access for that click, same
   mechanism as a real report. The popup's Preview/Apply/Undo/Copy buttons
   all work exactly as they do on a real report.
5. No restore obligation — this isn't a real customer report. Reload the
   page to reset to `fixtures.js`'s original seed data.

## Chaos controls

`write-queue.js`'s pacing/backoff/pause/resume/checkpoint logic is normally
only exercised by pure unit tests (`tests/write-queue.test.js`) that never
touch `adapter.js`'s real `Ext.Ajax` event wiring. The fake page's chaos
controls let you exercise that real wiring on demand:

- **Rate-limit next N saves** — the next N simulated `deviceWrite` calls
  return the real confirmed-live `410 Rate Limit Exceeded` body (see
  `docs/buildingreports-dom-map.md` §5.1) instead of success. Use this to
  watch a real Apply pause, back off, and auto-retry (or give up after
  `MAX_RATE_LIMIT_RETRIES` and require Resume).
- **Timeout next N saves** — the next N calls never fire an `Ext.Ajax`
  event at all, so `adapter.js`'s own real 30-second
  `DEVICE_WRITE_TIMEOUT_MS` is what resolves them (as `ambiguousTimeout:
  true`) — reproduces the genuinely-ambiguous case dom-map §5.1 describes,
  unmodified adapter code and all. (This one takes the full 30 seconds to
  resolve, same as it would on the real site — that's deliberate, not a
  bug in the fake.)
- **Network error next N saves** — fires `requestexception` instead of
  `requestcomplete`, the hard-failure path.
- **Concurrent burst** — a secondary/bonus control that bypasses this
  extension's own write-queue entirely and dirties N records at once before
  one simulated Save, to sanity-check the fake's fidelity against the real
  228-device-report incident dom-map §5.1 measured (52/197 succeeded, rest
  rate-limited) — not something this extension's own code ever does (it
  only ever dirties one record before Save), so it doesn't exercise
  anything the write-queue itself does differently.

## What this catches — and what it doesn't

**Catches:** business-logic bugs in `classify.js`/`service-parser.js`/
`battery-engine.js`/etc. exercised through the real popup → background →
adapter code path (not just synthetic unit-test fixtures); write-queue
pacing/backoff/pause/resume/checkpoint bugs against real `Ext.Ajax` event
timing; popup UI rendering and state-handling bugs; Undo correctness across
a full fake-report Apply → Undo cycle.

**Does NOT catch:** a real BuildingReports markup/ExtJS change (a broken
selector, a renamed dataIndex, a changed request/response shape) — the fake
is only as accurate as `docs/buildingreports-dom-map.md`'s documented
observations, and will happily keep working even if the real site has
drifted from what's documented. It also can't validate anything about real
server-side business rules (permission checks, actual current rate-limit
thresholds, validation BuildingReports itself performs).

**Practical workflow:** run new business-logic rules through
`npm test` → `dev/fake-report` (Preview/Apply/Undo, plus chaos controls if
the write path is involved) first. Reserve an actual live-report MCP
session (`docs/live-testing-workflow.md`) for genuinely new adapter-surface
work (a new field mapping, a new kind of interaction) or an occasional
drift check — not for every ordinary rule change. Still use your own
judgment about which changes are "ordinary" vs. "adapter-surface" per
CLAUDE.md's "Definition of done."

## Adding a new fixture record

Add a new `record({...})` call in `fixtures.js` — only fields that differ
from the defaults need to be specified. Re-run `node dev/fake-report/
verify.js` to confirm it flows through the real pipeline without error
before opening a browser. Nothing else in `dev/fake-report/` needs to
change for a new scenario.
