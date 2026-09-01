# Live testing workflow

The single procedure doc for a session that connects to a real, live
BuildingReports report via Chrome DevTools MCP. Written to be read cold,
with zero memory of any prior session — read this **before** touching the
browser, any time a task involves live testing (a bugfix, a new rule, a
"why didn't this work" investigation). `CLAUDE.md`'s "Starting a session"
list points here.

## The two standing facts to internalize before anything else

1. **You cannot open the report yourself.** BuildingReports requires the
   user's own login session. Every live-testing session starts with the
   user navigating to and opening the specific report's Device Editor in
   their own Chrome — you can open new tabs/pages via MCP, but you cannot
   sign in or pick the report. If no report is open yet, say so and wait;
   don't try to work around it (see "Connecting" below for what "no
   report yet" looks like and how to tell).
2. **You are pre-authorized to hand-edit any field on the live report to
   set up a test scenario, every session, without asking first** - this
   was explicitly granted by the user (2026-09-01) and doesn't need to be
   re-requested. The one obligation that comes with it, non-negotiable:
   **put every field you touched back to its exact original value before
   you finish** (see "The restore obligation" below). The one thing that
   still needs a fresh confirmation each time is a **full-report-scale**
   Apply (hundreds of records at once, not a small hand-picked test set) -
   see `CLAUDE.md`'s "Safety restrictions".

## Connecting

1. Confirm the MCP connection (`list_pages`).
2. Find the real BuildingReports.com tab. **If you only see the plain
   `https://www.buildingreports.com/` dashboard/homepage** (no device
   grid), the user hasn't opened a report yet - say so and wait; don't
   guess or navigate anywhere yourself.
3. The report app is a classic nested frameset - the outermost
   `window.location.href` **never changes** even once a report is open,
   so don't use it to judge whether you're connected. Instead, scan
   frames for the real Device Editor:

   ```js
   // From the top-level page:
   window.frames[0].frames[N]   // N varies - don't hardcode it
   ```

   The right frame is the one where `window.Ext` is an object and
   `window.ReportInspectionId` is set. A working one-shot scan:

   ```js
   () => {
     const f = window.frames[0]; // "topframe" (view-inspection-log)
     for (let i = 0; i < f.frames.length; i++) {
       try {
         const w = f.frames[i];
         if (typeof w.Ext === 'object' && w.ReportInspectionId) {
           return { index: i, reportId: w.ReportInspectionId };
         }
       } catch (e) { /* cross-origin frame (e.g. Stripe) - skip */ }
     }
     return null;
   }
   ```

   Full detail: `docs/buildingreports-dom-map.md` §1.
4. Confirm the grid itself: `w.Ext.ComponentQuery.query('#devicelistGrid')[0].getStore().getCount()`
   should match the "Devices Displayed" count shown on screen.
5. **If MCP opens or shows only a blank Chrome window, or launches a
   new/separate Chrome instance instead of attaching to the existing one:
   stop.** Don't continue testing against it, don't silently switch
   automation methods, don't treat a blank page as the report. Re-check
   the connection and re-list pages; ask the user to reconnect only when
   it genuinely can't be found any other way.

## Loading/reloading the extension

- If `list_extensions`/`list_pages`'s service workers don't show this
  project's path (`src/background/background.js`), it isn't loaded yet -
  use `install_extension` with the repo root path.
- **After editing any `src/` file, `reload_extension` before testing
  again** - a stale loaded copy will silently keep running old logic and
  you'll draw wrong conclusions from what looks like a live bug. This bit
  a real session on 2026-08-31: three fixes appeared to do nothing in
  Preview until the extension was reloaded.
- Reloading kills the injected adapter in every open frame - the next
  `applySingleServiceChange`/etc. call from a stale reference will throw
  "Cannot read properties of undefined." Re-trigger the popup once (which
  causes `background.js` to re-inject) before making direct adapter calls
  again.

## Testing the actual popup UI

`trigger_extension_action` opens the real ephemeral toolbar popup, but it
reliably auto-closes (`No page found` on the next tool call) before a
multi-step click/wait/snapshot sequence can finish - confirmed unreliable
for anything beyond a single screenshot.

**Use this instead:** with the report tab as the foreground/active tab,
open `popup.html` directly as a normal, persistent, backgrounded tab:

```
new_page({
  url: 'chrome-extension://<extensionId>/src/popup/popup.html',
  background: true,
})
```

`popup.js` finds its target via `chrome.tabs.query({active: true,
currentWindow: true})`, which still correctly resolves to the *report*
tab (not the new popup tab) as long as `background: true` was used -
confirmed live 2026-08-31. This gives a normal tab that survives
arbitrarily many `click`/`wait_for`/`take_snapshot` round-trips, exactly
like testing any other page - drive it with the ordinary
click/fill/wait_for/take_snapshot tool sequence.

## Setting up a test scenario (hand-editing fields)

For most bugfixes you need a real device in a specific, currently-absent
state (a typo, a missing unit, a specific manufacturer spelling). Two
ways to get there, in order of preference:

1. **Direct adapter call** (fast, precise, no UI interaction needed) -
   from the *report* page's real frame (see "Connecting" above):
   ```js
   const w = /* the real frame, see above */;
   const a = w.__brSidekickAdapter; // injected once background.js has run once this session
   await a.applySingleServiceChange(scannumber, 'Visually & Functional, Passed');
   await a.applySingleServiceFieldsChange(scannumber, { service: '...', confirmedTime: '...' });
   await a.applySingleBatteryChange(scannumber, { ratedVoltage: '12 V', amps: '75.0 AH' });
   ```
   Each call is a real, verified, single-record save (same code path
   Apply itself uses) - space consecutive calls ~500ms apart to avoid
   looking like a burst to BuildingReports' rate limiter.
2. Through the popup's own Repaired/Fixed wizard or a manual edit in the
   BuildingReports UI itself, when the adapter doesn't expose the field
   you need (rare).

**Before editing anything, read and record the current value of every
field you're about to touch** - you will need to restore it exactly, and
"restore" means the literal pre-existing value, not a guess at what looks
right.

**Prefer Preview-only verification over a full Apply** when the edit
would create an unrealistic side effect on an unrelated field (e.g.
setting Amps to an unrealistically high test value to check unit-suffix
stripping will also inflate Min Ah past the battery's real Tested Ah and
flip its Pass/Fail outcome). Preview is read-only and still exercises the
real classification code against the real live data - you don't need a
full Apply/Undo/restore cycle just to confirm a value parses and formats
correctly. Reserve the full Apply cycle for cases where the outcome won't
spuriously change, or where testing the write/verify/Undo path itself is
the point.

## The restore obligation

Every field you hand-set (directly, or via a real Apply during testing)
must be back to its true original value before the session ends - this
is not optional and not "close enough." The reliable sequence:

1. **Capture full original state before touching anything** - not just
   the field you're testing, but anything that might derive from it
   (e.g. editing Rated Voltage/Amps also affects Min Ah, Model Number,
   and potentially the whole Pass/Fail outcome/Note).
2. Run your test (Preview-only, or a full Apply if warranted).
3. If you ran a real Apply, **check the Undo entry count in
   `chrome.storage.local` before ever clicking Undo** -
   `brSidekick.undo.<inspectionId>` / `brSidekick.batteryUndo.<...>` /
   `brSidekick.repairUndo.<...>`. **"Undo Last Cleanup" reverts the
   report's ENTIRE accumulated history for that kind, not just the
   changes you personally just made.** A real incident (2026-08-06) and
   a real recurrence (2026-08-31, a different stray entry, same report)
   both found leftover entries from earlier, never-fully-cleared
   sessions silently merged into what looked like a clean N-item run. If
   the count doesn't match what you expect, inspect the extra entries
   (`.entries` array, each `{ scannumber, before, after }`) before
   deciding what to do - a stray entry's live value may already be
   *correct* (matching `after`), in which case clicking Undo would
   actively break something you weren't even testing.
4. **"Undo Last Cleanup" restores each field to its value immediately
   before that Apply ran - which is your hand-set TEST value, not the
   true original**, if you hand-edited the field before running Apply.
   This is documented, expected behavior, not a bug. After Undo (or
   instead of it, if you skipped Undo per step 3's finding), do a final
   **direct corrective write** via the adapter to reach the actual
   pre-test original values for every field you touched.
5. If you skipped Undo (or partially used it) because of a stray-entry
   finding in step 3, **discard the stale checkpoint/undo storage key
   yourself** (`chrome.storage.local.remove([...])`) rather than leaving
   it for a future session to trip over - matching the documented
   recovery pattern from the 2026-08-06 incident (see
   `docs/current-state.md`'s "Known limitations").
6. **Run one final Preview** (and Battery Preview, since they run
   together) to confirm the report is back to its exact original
   baseline - `0 safe changes`/`0 fields affected` on both engines, and
   the `already correct`/`unsupported field`/outcome counts matching what
   they were before you started. This is the actual proof of restoration,
   not just "I wrote the values back."

## Known gotchas worth not rediscovering

- **A same-value write looks identical to a rate-limit hang.**
  `applySingleFieldChange` waits for a `deviceWrite` response; if the
  value you're writing already equals the record's current value, ExtJS
  never marks the record dirty, no request is ever sent, and the call
  times out with the same `{ rateLimited: true, ambiguousTimeout: true }`
  shape used for genuine rate-limit uncertainty. This happens naturally
  when "restoring" a field that a prior step already happened to leave at
  the right value (e.g. a canonical value that equals the true original).
  **Verify via a direct read before assuming a real problem or retrying
  further.** Full detail: `docs/buildingreports-dom-map.md` §5.1.
- **Reading the clipboard back (`navigator.clipboard.readText()`) blocks
  on a native permission dialog** that browser automation can't dismiss -
  the tool call hangs until stopped (`TaskStop`). Don't attempt this to
  verify "Copy Review Items"; a successful `writeText()` (no thrown
  error) plus the popup's own status message is sufficient confirmation.
- **`list_network_requests` does not reliably show `deviceWrite`
  traffic** issued via the injected adapter - don't use it to debug
  writes; the adapter's own `Ext.Ajax` listeners (what `applySingle*`
  already does internally) are the only reliable observation point.
- Chrome's remote-debugging port sometimes isn't open yet when a session
  starts (`Could not connect to Chrome`) - this means Chrome needs to be
  (re)launched the way the user normally starts it for these sessions,
  not that MCP itself is broken. Don't work around it by launching a
  separate ad-hoc instance.

## Definition of done still applies

This doc covers the *mechanics* of live testing. `CLAUDE.md`'s
"Definition of done for every feature" is the full checklist (tests,
minimum-necessary live verification, doc updates, commit, permission/
privacy reporting) - this doc is what step 3-5 of that checklist actually
look like in practice.
