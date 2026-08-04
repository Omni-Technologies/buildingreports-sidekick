// BuildingReports site adapter - MAIN world script.
//
// This is the ONLY file that knows about BuildingReports' DOM/ExtJS
// internals. It is injected with chrome.scripting.executeScript
// ({ world: 'MAIN' }) into every frame of the tab; only the frame that
// actually hosts the ExtJS "Device Editor" app will find anything useful.
//
// It defines window.__brSidekickAdapter, a small, stable API the
// background service worker calls into. See docs/buildingreports-dom-map.md
// for how each selector/property below was found and how to repair this
// file if BuildingReports changes its markup.
//
// Versioned re-injection: background.js injects this file before every
// action, so a same-version adapter already on the page is left alone (this
// preserves the in-flight `busy` guard across repeated calls in one popup
// session). But bump ADAPTER_VERSION whenever this file changes and a
// STALE (older) adapter left over from before an extension reload IS
// replaced - otherwise a tab that was never manually reloaded would keep
// running old function bodies forever, which was the reported "stale
// adapter" bug. Reinjection can only reset `busy` if it races an in-flight
// save from the OLD adapter (dev-only: reloading the extension mid-Save);
// background.js's own per-tab applyInProgress guard is the primary defense
// against overlapping Apply/Undo runs regardless.
(function () {
  const ADAPTER_VERSION = 4;
  if (window.__brSidekickAdapter && window.__brSidekickAdapter.version >= ADAPTER_VERSION) {
    return;
  }

  const GRID_ITEM_ID = 'devicelistGrid';
  const MAIN_PANEL_ITEM_ID = 'mainPanel';
  const SAVE_BUTTON_ITEM_ID = 'saveDeviceEditPage';
  const DEVICE_WRITE_TIMEOUT_MS = 30000;

  const RECORD_FIELDS = [
    'scannumber',
    'devicetype',
    'service',
    'description',
    'location',
    'direction',
    'comment',
    'note',
    'solution',
    'modelnumber',
    'floor',
    'areasuite',
    'manufacturer',
    'passed',
    'tested',
  ];

  // Battery Cleanup's semantic field names -> BuildingReports' real dataIndex
  // names, confirmed live via the #deviceAttrGrid column config for a
  // selected Battery device (see docs/buildingreports-dom-map.md §7). Two of
  // these are a genuine BuildingReports quirk: "Min Ah" and "Tested Ah" are
  // not dedicated fields - they're the generic 'velocity1door'/'velocity2door'
  // attribute-grid columns (normally "Air Flow Value" on Damper Control
  // devices), repurposed and relabeled per device type. This map is the only
  // place that knowledge lives - src/cleanup/rules/battery-cleanup.js only
  // ever sees the semantic names on the left.
  const BATTERY_FIELD_MAP = {
    modelNumber: 'modelnumber',
    ratedVoltage: 'voltage',
    amps: 'amps',
    preTest: 'pretestvoltage',
    postTest: 'posttestvoltage',
    minAh: 'velocity1door',
    testedAh: 'velocity2door',
  };

  let busy = false;

  function getExt() {
    return window.Ext || null;
  }

  function getGrid() {
    const Ext = getExt();
    if (!Ext || !Ext.ComponentQuery) return null;
    const matches = Ext.ComponentQuery.query('#' + GRID_ITEM_ID);
    return matches.length ? matches[0] : null;
  }

  function getMainPanel() {
    const Ext = getExt();
    if (!Ext || !Ext.ComponentQuery) return null;
    const matches = Ext.ComponentQuery.query('#' + MAIN_PANEL_ITEM_ID);
    return matches.length ? matches[0] : null;
  }

  // 'inspectiondate' is an Ext `date`-type field - rec.get() returns a real
  // JS Date (or null), not a string. Battery Cleanup's expiration rule needs
  // a calendar day, not an instant, so this converts it to a plain
  // "YYYY-MM-DD" string using LOCAL date components (getFullYear/
  // getMonth/getDate, not toISOString/UTC) - confirmed live the stored
  // timestamp is UTC (e.g. "2025-05-01T11:56:25.000Z"), and re-parsing that
  // with `new Date(str)` or reading UTC components could shift the
  // calendar day near local midnight. This is deliberately kept separate
  // from BATTERY_FIELD_MAP (a plain rec.get() passthrough map) because it's
  // a real value transform, not a rename - see docs/battery-cleanup-rules.md.
  function toLocalDateOnlyString(value) {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function toPlainRecord(rec) {
    const out = {};
    for (const field of RECORD_FIELDS) {
      out[field] = rec.get(field);
    }
    for (const semantic of Object.keys(BATTERY_FIELD_MAP)) {
      out[semantic] = rec.get(BATTERY_FIELD_MAP[semantic]);
    }
    // Read-only: Battery Cleanup uses this to decide expiration but never
    // writes it back, so it's intentionally not in BATTERY_FIELD_MAP (which
    // toRawBatteryFields also uses as a write-time translation table).
    out.inspectionDate = toLocalDateOnlyString(rec.get('inspectiondate'));
    return out;
  }

  // Translates a Battery Cleanup change's semantic field names into the
  // real dataIndex names before they're written to the record. Most
  // Battery fields are attribute-grid quirks that need BATTERY_FIELD_MAP's
  // rename (see file header); but the pass/fail outcome fields
  // (passed/service/comment/solution/note) are ordinary #devicelistGrid
  // columns whose semantic name already IS their real dataIndex, so they
  // fall through unchanged rather than needing their own trivial map entry.
  function toRawBatteryFields(semanticFields) {
    const raw = {};
    for (const [semantic, value] of Object.entries(semanticFields)) {
      const rawKey = BATTERY_FIELD_MAP[semantic] || semantic;
      raw[rawKey] = value;
    }
    return raw;
  }

  // Returns report metadata when this frame hosts the Device Editor, or
  // null when it doesn't (the caller should just ignore this frame).
  function detect() {
    const grid = getGrid();
    if (!grid) return null;
    const store = grid.getStore();
    const Ext = getExt();
    let canModify = true;
    try {
      canModify = !!(window.br_adm || (Ext.util && window.BRC && window.BRC.Utilities.hasPriv('Modify Inspection Report')));
    } catch (e) {
      canModify = true; // fail open on the capability probe; the Save button itself is the real gate
    }
    return {
      buildingId: window.ReportBuildingId != null ? window.ReportBuildingId : null,
      buildingName: window.ReportBuildingName || null,
      inspectionId: window.ReportInspectionId != null ? window.ReportInspectionId : null,
      appId: window.ReportAppId || null,
      deviceCount: store.getCount(),
      canModify,
    };
  }

  // Clears any client-side Device Type / Model Number quick-filters so the
  // full report (not just the currently filtered view) is loaded, then
  // returns every device as a plain object. BufferedRenderer only
  // virtualizes the DOM rows - store.getCount()/each() already cover the
  // whole report without any pagination/scrolling needed.
  function getAllRecords() {
    const grid = getGrid();
    if (!grid) return null;
    const store = grid.getStore();
    store.removeFilter('massChangeDeviceTypeFilter');
    store.removeFilter('massChangeModelNumberFilter');
    const out = [];
    store.each((rec) => out.push(toPlainRecord(rec)));
    return out;
  }

  function findRecord(store, scannumber) {
    const idx = store.findExact('scannumber', String(scannumber));
    return idx >= 0 ? store.getAt(idx) : null;
  }

  // Mirrors write-queue.js's isRateLimitResponse pattern (kept as a local
  // copy, not an import: this file is injected as a plain classic script via
  // chrome.scripting.executeScript's `files` option, not as an ES module, so
  // it cannot `import` from src/cleanup/. See docs/buildingreports-dom-map.md
  // 5.1 for the exact BuildingReports error text this matches
  // ("410 Rate Limit Exceeded" / "exceeded the maximum number of requests").
  const RATE_LIMIT_TEXT_PATTERN = /rate limit|too many requests|exceeded the maximum number of requests/i;

  // Saves EXACTLY ONE record's field changes through BuildingReports' own
  // Save button/controller, so every existing server-side validation and
  // persistence path is reused as-is. Deliberately single-record, never
  // batched: see docs/buildingreports-dom-map.md 5.1 - clicking Save while
  // multiple records are dirty fires one concurrent deviceWrite POST per
  // dirty record, and BuildingReports rate-limits bursts of those. The
  // paced write-queue coordinator (src/cleanup/write-queue.js, driven from
  // background.js) is what's responsible for calling this once per item
  // with a delay in between - this function itself has no pacing logic,
  // it just guarantees only one record is ever dirty per Save click.
  //
  // Resolves with one of:
  //   { ok: true }
  //   { ok: false, error }                     - a real, non-rate-limit failure
  //   { rateLimited: true, error }              - explicit BuildingReports rate-limit response
  //   { rateLimited: true, error, ambiguousTimeout: true } - no response arrived within
  //     DEVICE_WRITE_TIMEOUT_MS. Treated as a rate-limit-style pause (retried
  //     with backoff) rather than a hard failure: confirmed live that a
  //     timeout immediately after a rate-limited burst is genuinely
  //     ambiguous (could be a still-throttled request, or a real response
  //     that arrived after this function stopped listening) - see
  //     docs/buildingreports-dom-map.md 5.1.
  async function applySingleFieldChange(scannumber, fields) {
    if (busy) {
      return { ok: false, error: 'busy' };
    }
    busy = true;
    try {
      const grid = getGrid();
      const mainPanel = getMainPanel();
      if (!grid || !mainPanel) {
        return { ok: false, error: 'grid-not-found' };
      }
      const store = grid.getStore();
      const Ext = getExt();
      const saveBtn = Ext.ComponentQuery.query('#' + SAVE_BUTTON_ITEM_ID)[0];
      if (!saveBtn) {
        return { ok: false, error: 'save-button-not-found' };
      }
      const rec = findRecord(store, scannumber);
      if (!rec) {
        return { ok: false, error: 'record-not-found' };
      }
      rec.set(fields);
      const sn = String(scannumber);

      return await new Promise((resolve) => {
        let settled = false;

        function settle(value) {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(value);
        }

        function onComplete(conn, response, options) {
          const params = options && options.params;
          if (!params || params.a !== 'deviceWrite' || String(params.scannumber) !== sn) return;
          const text = (response && response.responseText) || '';
          if (/<error>\s*200 OK\s*<\/error>/.test(text)) {
            settle({ ok: true });
          } else if (RATE_LIMIT_TEXT_PATTERN.test(text)) {
            settle({ rateLimited: true, error: text.slice(0, 300) });
          } else {
            settle({ ok: false, error: text.slice(0, 300) });
          }
        }

        function onException(conn, response, options) {
          const params = options && options.params;
          if (!params || params.a !== 'deviceWrite' || String(params.scannumber) !== sn) return;
          settle({ ok: false, error: 'network error' });
        }

        function cleanup() {
          Ext.Ajax.un('requestcomplete', onComplete);
          Ext.Ajax.un('requestexception', onException);
          clearTimeout(timer);
        }

        Ext.Ajax.on('requestcomplete', onComplete);
        Ext.Ajax.on('requestexception', onException);

        const timer = setTimeout(() => {
          settle({
            rateLimited: true,
            ambiguousTimeout: true,
            error: 'timeout waiting for save confirmation (ambiguous - may or may not have been throttled)',
          });
        }, DEVICE_WRITE_TIMEOUT_MS);

        const controller = mainPanel.getController();
        controller.onSaveDeviceEditPage(saveBtn);
      });
    } finally {
      busy = false;
    }
  }

  // Clean Up Service Entries: writes the 'service' field on exactly one record.
  function applySingleServiceChange(scannumber, newValue) {
    return applySingleFieldChange(scannumber, { service: newValue });
  }

  // Battery Cleanup: `fields` uses the semantic names in BATTERY_FIELD_MAP
  // (ratedVoltage, amps, preTest, postTest, minAh, testedAh, modelNumber),
  // plus the pass/fail outcome fields (passed, service, comment, solution,
  // note) which pass through under their own name - translated to real
  // dataIndex names here, on exactly one record.
  function applySingleBatteryChange(scannumber, fields) {
    return applySingleFieldChange(scannumber, toRawBatteryFields(fields));
  }

  function isBusy() {
    return busy;
  }

  window.__brSidekickAdapter = {
    version: ADAPTER_VERSION,
    detect,
    getAllRecords,
    applySingleServiceChange,
    applySingleBatteryChange,
    isBusy,
  };
})();
