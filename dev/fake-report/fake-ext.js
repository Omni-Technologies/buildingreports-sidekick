// A minimal fake of the ONE narrow slice of ExtJS that
// src/site-adapters/buildingreports/adapter.js actually touches - not a
// real ExtJS build, not a visual replica of BuildingReports. See
// docs/fake-report-testing.md for what this can and can't catch.
//
// adapter.js only ever calls:
//   Ext.ComponentQuery.query('#devicelistGrid' | '#mainPanel' | '#saveDeviceEditPage')
//   grid.getStore() -> store.removeFilter/getCount/each/findExact/getAt
//   rec.get(field) / rec.set(fields)
//   mainPanel.getController().onSaveDeviceEditPage(saveBtn)
//   Ext.Ajax.on/un('requestcomplete'|'requestexception', handler)
//   window.ReportBuildingId/ReportBuildingName/ReportInspectionId/ReportAppId
//   window.br_adm (the canModify probe's fast path)
// That exact surface is what's implemented here - see
// docs/buildingreports-dom-map.md for the confirmed-live request/response
// shapes this mirrors (§5/§5.1).
(function () {
  window.ReportBuildingId = 90001;
  window.ReportBuildingName = 'Fake Test Building (dev/fake-report)';
  window.ReportInspectionId = 700001;
  window.ReportAppId = 'F1';
  window.br_adm = true; // short-circuits detect()'s canModify probe to true

  const SUCCESS_BODY =
    '<response success="true"><responsedetail><error>200 OK</error><errormessage></errormessage><count>0</count></responsedetail></response>';
  const RATE_LIMIT_BODY =
    '<response success="false"><responsedetail><error>410 Rate Limit Exceeded</error><errormessage>You have exceeded the maximum number of requests allowed for a short period of time. Please wait and try your request again.</errormessage><count>0</count></responsedetail></response>';

  // --- Ext.Ajax: a tiny event pub/sub, matching the on/un/fire shape
  // adapter.js calls (conn, response, options) - conn is unused there. ---
  const listeners = { requestcomplete: [], requestexception: [] };
  const Ajax = {
    on(evt, cb) {
      (listeners[evt] || (listeners[evt] = [])).push(cb);
    },
    un(evt, cb) {
      if (!listeners[evt]) return;
      listeners[evt] = listeners[evt].filter((f) => f !== cb);
    },
    _fire(evt, response, options) {
      (listeners[evt] || []).slice().forEach((cb) => cb(null, response, options));
    },
  };

  // --- Fake record model: plain data + dirty tracking. Mirrors the one
  // real quirk documented live (dom-map §5.1): setting a field to its
  // CURRENT value does not mark the record dirty, so no deviceWrite fires
  // for it - same "same-value write looks identical to a rate-limit hang"
  // behavior is reproducible here for anyone who wants to test that edge
  // case deliberately. ---
  function makeRecord(data) {
    const _data = { ...data };
    let _dirty = false;
    return {
      get(field) {
        return _data[field];
      },
      set(fields) {
        let changed = false;
        for (const [k, v] of Object.entries(fields)) {
          const cur = _data[k];
          const same = cur instanceof Date && v instanceof Date ? cur.getTime() === v.getTime() : cur === v;
          if (!same) {
            _data[k] = v;
            changed = true;
          }
        }
        if (changed) _dirty = true;
      },
      isDirty() {
        return _dirty;
      },
      clearDirty() {
        _dirty = false;
      },
      raw() {
        return _data;
      },
    };
  }

  function makeStore(seedRecords) {
    const list = seedRecords.map(makeRecord);
    return {
      getCount() {
        return list.length;
      },
      each(fn) {
        list.forEach(fn);
      },
      findExact(field, value) {
        return list.findIndex((r) => String(r.get(field)) === String(value));
      },
      getAt(i) {
        return list[i];
      },
      // Real BuildingReports uses these two named client-side quick-filters
      // (see dom-map §4) - the fake store is never filtered, so this is a
      // deliberate no-op, not a stub for something unimplemented.
      removeFilter() {},
      _list: list,
    };
  }

  const store = makeStore(window.FAKE_REPORT_FIXTURES || []);

  // --- Chaos controls: deliberately injectable failure modes, driven by
  // the on-page UI (index.html), so write-queue.js's pacing/backoff/pause/
  // resume/checkpoint logic can be exercised through the REAL adapter.js
  // Ext.Ajax event wiring - not just the pure unit tests in
  // tests/write-queue.test.js. Counters are consumed one-per-simulated-save
  // (each simulateSave() call decrements at most one, in this priority
  // order), so "next N saves" means exactly that. ---
  const chaos = {
    rateLimitNext: 0,
    timeoutNext: 0,
    networkErrorNext: 0,
    baseDelayMs: 300, // matches the ~328ms single isolated save confirmed live, dom-map §5.1
    jitterMs: 150,
  };
  window.__fakeReportChaos = chaos;

  function simulateSave(rec) {
    const scannumber = rec.get('scannumber');
    const options = { params: { a: 'deviceWrite', scannumber: String(scannumber) } };
    const delay = chaos.baseDelayMs + Math.random() * chaos.jitterMs;
    setTimeout(() => {
      if (chaos.timeoutNext > 0) {
        chaos.timeoutNext -= 1;
        // Deliberately never fires an Ajax event - reproduces the
        // confirmed-live "ambiguous timeout" path (dom-map §5.1): adapter.js's
        // own 30s DEVICE_WRITE_TIMEOUT_MS is what resolves this, unmodified.
        return;
      }
      if (chaos.networkErrorNext > 0) {
        chaos.networkErrorNext -= 1;
        Ajax._fire('requestexception', { responseText: '' }, options);
        return;
      }
      if (chaos.rateLimitNext > 0) {
        chaos.rateLimitNext -= 1;
        Ajax._fire('requestcomplete', { responseText: RATE_LIMIT_BODY }, options);
        return;
      }
      rec.clearDirty();
      Ajax._fire('requestcomplete', { responseText: SUCCESS_BODY }, options);
    }, delay);
  }

  function onSaveDeviceEditPage() {
    // Real BuildingReports fires one POST per record that's dirty at the
    // moment Save is clicked, essentially concurrently (dom-map §5.1) - this
    // extension's own write-queue only ever dirties one record before
    // calling Save, so in normal Preview/Apply/Undo use this list is
    // exactly one record. See simulateConcurrentBurst() below for
    // deliberately reproducing a real multi-record burst instead.
    store._list.filter((r) => r.isDirty()).forEach(simulateSave);
  }

  // Bonus/secondary: reproduces the actual N-concurrent-requests scenario
  // dom-map §5.1 measured live (52/197 succeeded, rest rate-limited) -
  // useful for sanity-checking this fake's fidelity against that real
  // incident, NOT exercised by this extension's own code (which never
  // dirties more than one record before Save). Touches a harmless field to
  // force `dirty` without changing anything meaningful.
  function simulateConcurrentBurst(n, rateLimitFraction) {
    const picked = store._list.slice(0, Math.min(n, store._list.length));
    picked.forEach((r) => r.set({ tested: !r.get('tested') })); // one real change vs. original -> dirty
    picked.forEach((rec) => {
      const scannumber = rec.get('scannumber');
      const options = { params: { a: 'deviceWrite', scannumber: String(scannumber) } };
      const delay = chaos.baseDelayMs + Math.random() * chaos.jitterMs;
      setTimeout(() => {
        rec.clearDirty();
        const rateLimited = Math.random() < rateLimitFraction;
        Ajax._fire('requestcomplete', { responseText: rateLimited ? RATE_LIMIT_BODY : SUCCESS_BODY }, options);
      }, delay);
    });
    return picked.length;
  }
  window.__fakeReportSimulateConcurrentBurst = simulateConcurrentBurst;

  window.Ext = {
    ComponentQuery: {
      query(selector) {
        if (selector === '#devicelistGrid') {
          return [{ getStore: () => store }];
        }
        if (selector === '#mainPanel') {
          return [{ getController: () => ({ onSaveDeviceEditPage }) }];
        }
        if (selector === '#saveDeviceEditPage') {
          return [{}]; // adapter.js only checks this exists, never touches it
        }
        return [];
      },
    },
    Ajax,
  };

  // Exposed for index.html's own status/table rendering.
  window.__fakeReportStore = store;
})();
