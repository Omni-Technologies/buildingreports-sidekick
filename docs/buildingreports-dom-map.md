# BuildingReports DOM / App Map

Findings from live inspection of the Device Editor (two real, older
FireScan reports, ~230-620 devices each). This is the reference for
repairing `src/site-adapters/buildingreports/adapter.js` if BuildingReports
changes something.

## 1. Page structure: classic frameset, not a normal SPA route

The visible app is **not** a single-page app with real URLs per report.
`https://www.buildingreports.com/` loads a classic HTML `<frameset>`. The
"tabs" you see at the top (FireScan, BRForms, SecurityScan, and one tab per
open report) are custom-drawn by the app itself, not real browser tabs.

Frame chain observed (2 levels deep, all same-origin):

```
top:  https://www.buildingreports.com/
  └─ frame "topframe": .../reports.ReportsServlet?command=view-inspection-log...
       └─ frame (unnamed): .../reports.ReportsServlet?command=load-device-edit-page&appid=F1&bldid=<id>&inspid=<id>...
```

The innermost frame is where the ExtJS "Device Editor" application
(`DeviceEdit`, Sencha ExtJS 6.5.1 classic/touch theme) actually lives.

**Important consequence:** reloading or navigating the *top-level* page
loses all of this in-app state and drops you back to the plain dashboard
(`Get My Reports` / `Access My Buildings`) - there is no URL that reopens a
specific report's open tab directly. **Never call `location.reload()` or
navigate the top frame from the extension.** If you need to "refresh" data,
re-run the grid's own store operations (see below) instead.

Because the exact nesting is an implementation detail that could change,
the adapter does **not** hardcode frame indices/names. It is injected into
**every** frame (`allFrames: true`) and each copy self-checks for
`window.Ext` and the grid; only the one real match does anything.

## 2. Finding the grid and its data

Once inside the right frame:

```js
const grid = window.Ext.ComponentQuery.query('#devicelistGrid')[0];
const store = grid.getStore();
```

- `grid.itemId === 'devicelistGrid'`, xtype `mainlist`.
- The grid uses `Ext.grid.plugin.CellEditing` (per-cell inline editing) and
  `Ext.grid.plugin.BufferedRenderer` (DOM virtualization for scrolling
  only - **not** server paging; see §4).
- Columns are keyed by `dataIndex`: `scannumber`, `inspectiondate`,
  `devicetype`, `manufacturer`, `modelnumber`, `floor`, `direction`,
  `location`, `description`, `areasuite`, `passed` (bool), `scanned` (bool),
  `service`, `comment`, `solution`, `note`, `controlpanel`, `zone`,
  `address`, `installdate`, plus device-attribute-specific fields.
  `installdate` is Battery Cleanup's expiration input as of 2026-08-06
  (`installDate` semantic name, read-only, same `toLocalDateOnlyString`
  treatment as `inspectiondate`) - confirmed live it's a genuinely
  per-device value (e.g. a replaced battery carries the replacement date),
  unlike `inspectiondate` which is effectively the same for every device in
  one inspection visit. `inspectiondate` itself is still read on every
  record (semantic name `inspectionDate`) - used by Clean Up Service
  Entries' Communicator rule as a date fallback, see
  `docs/cleanup-rules.md`.
- Every record field can be read with `record.get('<dataIndex>')`.
- Battery Cleanup reads `floor`, `direction`, `location`, `description`,
  and `areasuite` as read-only context for conservative Left/Right pair
  matching. `areasuite` was added to the adapter's returned record shape in
  adapter version 4; none of these pairing fields is written by that rule.
- Confirmed live: the standalone `Left`/`Right` word that identifies a
  Battery's side is **not** reliably in any one column - one real report
  had `direction` holding an unrelated building label for both Batteries
  in a pair, with the actual marker in `description` instead ("Left
  Battery"/"Right Battery"). Since which column carries it isn't
  predictable, `battery-engine.js`'s pairing logic scans all five
  identifying columns (`floor`, `direction`, `location`, `description`,
  `areasuite`) for the marker rather than hardcoding one or two - see
  `docs/battery-cleanup-rules.md`.

Useful page globals inside that frame (used for report identity, no DOM
query needed): `window.ReportBuildingId`, `window.ReportBuildingName`,
`window.ReportInspectionId`, `window.ReportAppId`, `window.br_adm`, and
`window.BRC.Utilities.hasPriv('Modify Inspection Report')` for a permission
check.

### 2.1 Where the inspection's frequency (Annual/Semi-Annual) actually lives

The Device Editor frame itself has **no** frequency field anywhere -
confirmed by scanning both its visible text and its `window` globals. The
frequency lives one frame **up**, in the inspection-log grid on the
`view-inspection-log` frame (the "topframe" in the chain in section 1), not
inside the Device Editor at all.

```js
// From the topframe (window.frames[0] relative to the outermost document):
const grid = Ext.ComponentQuery.query('#inspGrid_F1')[1]; // per-appId grid, e.g. F1 = FireScan
                                                            // (ComponentQuery can return more than
                                                            // one match for the same itemId - the
                                                            // one with a non-zero store count is
                                                            // the real, populated one)
const store = grid.getStore();
let record;
store.each(rec => { if (String(rec.get('inspectionid')) === '<id>') record = rec; });
record.get('frequency');      // numeric code, e.g. 10
record.get('frequencyname');  // display string, e.g. "Annual"
```

Confirmed live: `frequency: 10, frequencyname: "Annual"` for a real Annual
inspection. The Semi-Annual numeric code was not observed live in this
session - don't guess it; re-derive it the same way from a real Semi-Annual
report if it's ever needed. The inspection-log grid is paginated/searchable
(same shape as the "Get My Reports" building/inspection search), so a
specific `inspectionid` may not be in the currently-loaded page of the store
- searching for the building name first (as the real UI does) loads the
matching row.

This extension does **not** currently read this field for anything - the
popup's Annual/Semi-Annual selector is a manual, human choice, not
auto-detected from the report. If a future feature wants to auto-select the
profile, this is where that value would have to come from, and it requires
reaching into the parent frame, not the Device Editor frame the adapter
already lives in.

## 3. Editing a field programmatically

The Service column's cell editor is an editable ExtJS combobox (free text
allowed - the dropdown is just suggestions like "Annual", "Bar Coded",
"Cleaned", etc., **not** a closed set; "Visual & Functional, Passed" itself
is not even in that list).

You do **not** need to simulate a real double-click + type + blur. Setting
the underlying record field directly is equivalent and is what the adapter
does:

```js
const rec = store.findRecord('scannumber', scannumber, ...) // or store.getAt(store.findExact(...))
rec.set('service', 'Visual & Functional, Passed');
```

This marks the record dirty, and - confirmed by direct testing - pushes it
into a **custom, non-standard** array the app maintains itself:
`store.modifiedRecord` (not ExtJS's built-in dirty-record tracking). The
toolbar's Save button (`#saveDeviceEditPage`) is enabled/disabled based on
this array being non-empty.

To cleanly discard *unsaved* edits (only useful before Save is clicked):
`store.rejectChanges()` - confirmed to revert the field and re-disable Save.

## 4. Processing the entire report (no pagination needed)

The Device Type / Model Number quick-filter combos at the top apply
**client-side** Ext store filters (`massChangeDeviceTypeFilter`,
`massChangeModelNumberFilter`) - confirmed by checking
`store.getCount()` (289, filtered) vs `store.getTotalCount()` (621,
unfiltered) on the same store, then removing the filters and seeing
`getCount()` jump to 621 with **no additional network request**. All
devices for the inspection are fetched once up front; `BufferedRenderer`
only virtualizes which rows are in the DOM for scrolling.

**Practical effect:** to process every device in the report, just clear
those two filters and iterate:

```js
store.removeFilter('massChangeDeviceTypeFilter');
store.removeFilter('massChangeModelNumberFilter');
store.each(rec => { /* ... */ });
```

No scrolling, paging, or "load more" is required. There is exactly one
device grid per inspection (all device types share one store) - there are
no separate per-category sections to visit separately.

## 5. Saving and verifying persistence

BuildingReports has its own Save button (itemId `saveDeviceEditPage`,
bottom-right of the grid toolbar, disabled when there are no dirty
records). Clicking it runs
`mainPanel.getController().onSaveDeviceEditPage(saveBtn)`. The adapter
calls that exact method directly (equivalent to a real click) instead of
re-implementing the save protocol, so it automatically benefits from
whatever validation/business logic BuildingReports has (including the
`hasPriv('Modify Inspection Report')` gate - if the user lacks permission,
this call is a silent no-op, which is why `detect()` also surfaces
`canModify`).

For a normal (non-admin, non-mass-change) edit, this triggers one
`POST https://www.buildingreports.com/api/` per dirty record:

```
a=deviceWrite
xml=<device>...entire record serialized as XML...</device>
scannumber=<scannumber>
inspectionid=<inspectionId>
appid=F1
buildingid=<buildingId>
```

Response (also XML, `content-type: text/xml`):

```xml
<response success="true"><responsedetail><error>200 OK</error><errormessage></errormessage><count>0</count></responsedetail></response>
```

**Verification strategy used by the adapter:** rather than trust the
optimistic client-side store state, it registers listeners on
`Ext.Ajax` (`requestcomplete` / `requestexception`) *before* triggering
save, matches each event by `options.params.a === 'deviceWrite'` and
`options.params.scannumber`, and resolves per-record success only when the
response body matches `/<error>\s*200 OK\s*<\/error>/`. A timeout (30s)
guards against a record that never gets a response. This was confirmed
against real saves for 5 different device types in one batch - all 5
POSTs, all matched and confirmed independently.

On full success BuildingReports itself also shows an
`Ext.toast({title: 'Saved', html: 'Changes Saved'})` and disables the Save
button - a secondary, human-visible confirmation of the same thing.

## 5.1 Rate limiting on bulk saves (critical - confirmed live)

**`onSaveDeviceEditPage` fires one POST per dirty record essentially
concurrently, not sequentially.** If N records are dirty when Save is
clicked (e.g. because `rec.set()` was called on all N before the one Save
click, which is what the pre-coordinator `applyFieldChanges` did), all N
`a=deviceWrite` requests go out together. Confirmed live on a real 228-device
report: setting 197 records dirty and clicking Save once produced a mix of
successes and this rate-limit response for the rest:

```xml
<response success="false"><responsedetail><error>410 Rate Limit Exceeded</error><errormessage>You have exceeded the maximum number of requests allowed for a short period of time. Please wait and try your request again.</errormessage><count>0</count></responsedetail></response>
```

Observed characteristics (from that live run):

- **No `Retry-After` header** was present on the rate-limited responses (nor
  on successful ones) - confirmed via `response.getAllResponseHeaders()`
  inside the `Ext.Ajax` `requestcomplete`/`requestexception` handlers. Any
  backoff has to be a client-side guess, not server-directed.
- Of 197 concurrently-fired requests, **52 succeeded and 145 were rejected**
  with the error above - the threshold is well under 197 concurrent
  requests for this account/session.
- A **second** burst of 52 concurrent requests (an Undo attempt immediately
  after) got **zero** confirmed responses within the adapter's 30s
  `DEVICE_WRITE_TIMEOUT_MS` - every one of the 52 resolved as `"timeout
  waiting for save confirmation"` rather than an explicit rate-limit body.
  This means a timeout does **not** distinguish "server never responded
  because still throttled" from "response arrived after we stopped
  listening" - it is genuinely ambiguous, not a confirmed failure or
  success either way.
- After waiting (several minutes of unrelated work in between), a **single,
  isolated** `deviceWrite` request succeeded in **328ms** with a normal `200
  OK` body and no rate-limit response - confirming the limit is a
  short-window throttle that clears on its own, not a hard per-session cap.
- No `Retry-After`-style cooldown hint is exposed anywhere else observed
  (no response header, no error body field beyond the free-text message).

**Practical conclusion used by the write coordinator
(`src/cleanup/write-queue.js` + `src/background/background.js`):** never let
more than one `deviceWrite` be in flight at a time. Set exactly one record
dirty, click Save, wait for that one record's own
`requestcomplete`/`requestexception` (or the 30s timeout), *then* set the
next record dirty and repeat - with a minimum delay after each completed
request (not measured from when it started) before starting the next one.
On a rate-limit response, stop immediately, back off, and retry the *same*
still-pending record rather than assuming failure or moving on. See
`docs/architecture.md`'s "Throttled write queue" section for the full
design.

**No legitimate BuildingReports batch-save endpoint was found.** The
Device Type/Model Number "mass edit" tool mentioned in §8 only covers a
handful of numeric device-attribute fields (Sensitivity Result/Rating/
Minus/Plus) for the currently-selected Device Type - it does not support
`service`, and its own request shape was not investigated further since it
doesn't cover this extension's fields. `onSaveDeviceEditPage` (one XHR per
dirty record) remains the only observed way to persist `service` or
Battery attribute changes, so pacing at the client is the only available
mitigation.

**Chrome DevTools MCP's network log did not capture any of this.**
`list_network_requests` on the report tab returned only the initial
page-load request sequence (asset/API GETs through the point the Device
Editor finished loading) and never grew to include any `deviceWrite` POSTs
issued afterward via the injected adapter, even long after dozens of real
saves had happened. The only reliable way to observe `deviceWrite`
responses (status, headers, body, timing) is what the adapter already
does: registering direct `Ext.Ajax` `requestcomplete`/`requestexception`
listeners before triggering a save. Don't rely on `list_network_requests`/
`get_network_request` for this app's write traffic.

## 6. Selector/API stability notes (for repairs)

If BuildingReports changes its build and something breaks, check these in
order:

1. `Ext.ComponentQuery.query('#devicelistGrid')` still finding the grid.
   If not, the itemId changed - open the report, run
   `Ext.ComponentQuery.query('grid').map(g => g.itemId)` in the console to
   find the new one.
2. `grid.getColumns()` dataIndex list still includes `service`,
   `devicetype`, `scannumber`, `passed`.
3. `Ext.ComponentQuery.query('#saveDeviceEditPage')` still finds the Save
   button, and `mainPanel.getController()` still exposes
   `onSaveDeviceEditPage`.
4. The `a=deviceWrite` / `<error>200 OK</error>` request/response shape via
   the Network tab on a manual edit+save.

All of the above are only referenced from `adapter.js` - nothing else in
the codebase touches BuildingReports internals, so a break is a one-file
fix.

## 7. Device-type-specific attributes: `#deviceAttrGrid` and its field quirks

Fields like Rated Voltage, Amps, Pre Test, Post Test, Min Ah, Tested Ah
(used by Battery Cleanup) are **not** columns on `#devicelistGrid` - they
live on a second, single-row grid, `Ext.ComponentQuery.query('#deviceAttrGrid')[0]`
(itemId `deviceAttrGrid`, xtype `mainDeviceAttr`), which shows a different
set of columns depending on the currently selected device's type.

Confirmed live: `#deviceAttrGrid` has its **own** `Ext.data.Store`
(`attrGrid.getStore() !== mainGrid.getStore()`), but selecting a row in
`#devicelistGrid` loads that store with exactly one record - and it is
**the same record instance** as the one in the main grid's store
(`attrStore.getAt(0) === mainGridRecord`, confirmed by reference equality).
Practical effect: there is no need to interact with `#deviceAttrGrid` at
all to read or write these fields - `rec.set({...})` on a record obtained
from `#devicelistGrid`'s store (via `store.findExact('scannumber', ...)`,
exactly what `getAllRecords()`/`applySingleFieldChange()` already do) is fully
equivalent to editing it through that panel, dirty-tracking and Save
button included.

To find a device type's column -> dataIndex mapping (needed once per new
field/device-type combination), select a device of that type, then run:

```js
Ext.ComponentQuery.query('#deviceAttrGrid')[0]
  .getColumns()
  .map(c => ({ text: c.text, dataIndex: c.dataIndex }));
```

For Battery, this is where the following mapping was confirmed (see
`docs/battery-cleanup-rules.md` and `BATTERY_FIELD_MAP` in `adapter.js`):
`voltage` = "Rated Voltage", `amps` = "Amps", `pretestvoltage` = "Pre Test",
`posttestvoltage` = "Post Test", `modelnumber` = "Model Number". Two are a
genuine BuildingReports quirk worth calling out specifically:
`velocity1door` = "Min Ah" and `velocity2door` = "Tested Ah" - these are
the same generic attribute-grid columns labeled "Air Flow Value" on Damper
Control devices, repurposed and relabeled per device type. There is no
naming convention to rely on here; each device type's mapping has to be
confirmed live the same way.

Confirmed live (2026-08-06, same technique, `COMMS_FIELD_MAP` in
`adapter.js`) for Clean Up Service Entries' Communicator/Communication
Line/Monitoring rules (see `docs/cleanup-rules.md`): Communicator's
`#deviceAttrGrid` has `manufacturedate`/`type`/`seconds` ("Restore Time");
Monitoring's has `manufacturedate`/`type`/`time` ("Confirmed Time")/
`sensitivity` ("Confirmed With" - not used by this extension); Communication
Line's has only `manufacturedate` (Manufacture Date) - no attribute field
at all for that device type, confirmed by direct inspection of a real
Communication Line record.

Confirmed live (2026-08-06, same technique, `HEAT_DETECTOR_FIELD_MAP` in
`adapter.js`) for the Annual Heat Detector Restorable rule (see
`docs/cleanup-rules.md`): Heat Detector's `#deviceAttrGrid` has
`manufacturedate`/`type`/`seconds` ("Response Time")/`pressure`
("Temperature Rating")/`devicefunction` ("Function")/**`simulated`
("Restorable")**/`intelligible` ("Supporting Field Device (SFD)") - a
plain boolean `checkcolumn` field (`fieldModel.getType() === 'bool'`),
same simple pass-through as Battery's `passed` checkbox, not one of the
generic-attribute-column-reused-for-a-different-purpose quirks like Min
Ah/Tested Ah.

A useful shortcut for finding the underlying dataIndex behind any visible
attribute-panel label without selecting a device first: every field also
gets an auto-generated search-box `itemId` of the form
`<dataIndex>-translated<LabelWithNoSpaces>searchbutton` (e.g.
`velocity1door-translatedMinAhsearchbutton`), visible via
`Ext.ComponentQuery.query('component').filter(c => c.itemId).map(c => c.itemId)`.

## 8. Other things noticed during inspection (not implemented)

- BuildingReports has its **own** bulk "mass edit" tool (the Field / New
  Value combos next to the search box), but it only offers device-attribute
  numeric fields (Sensitivity Result/Rating/Minus/Plus for the currently
  selected Device Type) - it does **not** support Service, which is why
  this extension adds real value here.
- An "Apply Sensitivity" and an "Export" button exist on the same toolbar;
  not investigated further, but worth a look for future automations.
- Real (already-clean) reports still contain plenty of legitimate
  non-"Visual & Functional" Service values worth knowing about: `"Bar
  Coded"`, `"Svc. By Hooper 2/25"` (this exact shape is now a **supported**
  canonical value for Air Pressure Switch/Tamper Switch/Waterflow Switch/
  Kitchen Hood as of 2026-08-06 - see `docs/cleanup-rules.md`'s
  "Third-Party Serviced Devices" section - confirmed live on a real report
  that 5 real Tamper Switch/Waterflow Switch records already carried
  exactly this value and classified `alreadyCorrect`), timestamp-style
  entries like `"Yes, 11:02 AM"`, and `"Restored @ 11:29 AM 5/1/25"`.
  `"Bar Coded"` remains genuinely unsupported (not third-party-serviced
  device types in that same report). These are exactly why the
  cleanup engine has a dedicated "unsupported field format" bucket instead
  of forcing everything into Passed/Failed.
