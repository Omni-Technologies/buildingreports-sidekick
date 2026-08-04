# Current state

A snapshot of exactly what's implemented and verified as of this writing.
Update this file whenever a rule, test count, or architectural piece
changes — it's meant to save a future session from re-deriving all of this.

## Implemented actions

- **Clean Up Service Entries** — Annual profile (enabled) and Semi-Annual
  profile (enabled). Preview / Apply / Undo, both routed through the shared
  paced write queue. Full rule reference: `docs/cleanup-rules.md`.
- **Battery Cleanup** — universal, no Inspection Profile. Preview / Apply /
  Undo, independent Undo history from Service Cleanup, same write queue.
  Full rule reference: `docs/battery-cleanup-rules.md`.
- **Shared paced write queue** (`src/cleanup/write-queue.js`) — concurrency
  1, checkpointed to `chrome.storage.local`, rate-limit backoff + bounded
  retries + manual Resume, Pause / Cancel Remaining. Used by all four write
  paths (Service/Battery × Apply/Undo). See `docs/architecture.md`.

## Tests

```
npm test
```

**130 tests, 0 failures** across `tests/*.test.js`
(`battery-cleanup.test.js`, `battery-engine.test.js`, `classify.test.js`,
`engine.test.js`, `semi-annual.test.js`, `write-queue.test.js`). Synthetic
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

`ADAPTER_VERSION = 4` (`src/site-adapters/buildingreports/adapter.js`) —
single-record save API (`applySingleServiceChange`/
`applySingleBatteryChange`). Bump this constant whenever `adapter.js`
changes, per the versioned-re-injection scheme in `docs/architecture.md`.

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
  entries put it in `description` instead (see
  `docs/battery-cleanup-rules.md`) - both columns are now checked.

## Most recent successful live verification

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
- The report was left in its original, fully-consistent state after
  testing (confirmed via a final Preview showing zero safe changes across
  the whole report).
- The rate-limit incident that led to building the write queue (see
  dom-map §5.1) happened, was recovered from, and the fix was verified live
  in the same session - see `docs/architecture.md` and
  `docs/buildingreports-dom-map.md` for the technical detail.

## Files most likely to change for future rules

- `src/config/inspection-profiles/*.js` — device lists, phrases, a new
  profile file.
- `src/cleanup/classify.js` / `device-type-matcher.js` — prefix-selection
  logic shared by all Service Cleanup profiles.
- `src/cleanup/rules/battery-cleanup.js` / `battery-engine.js` — a new
  Battery field rule.
- `src/site-adapters/buildingreports/adapter.js` — only if a new field
  mapping or a genuinely new BuildingReports interaction is needed; keep
  single-record, keep JSON-in/JSON-out.
- `tests/*.test.js` — always, alongside any of the above.
