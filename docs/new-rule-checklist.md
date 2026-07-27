# New-rule checklist

Follow this for every new cleanup rule, large or small. Don't skip steps
because a rule looks trivial — the small ones are exactly where a shortcut
causes the kind of mess `docs/buildingreports-dom-map.md` §5.1 describes.

1. **Read `CLAUDE.md`.** It's the whole mental model in one file.
2. **Read `docs/current-state.md`.** Confirms what's actually implemented
   and working right now, not what an older conversation might assume.
3. **Read the relevant existing rule and its tests.** Annual/Semi-Annual →
   `src/config/inspection-profiles/annual.js` + `classify.js` +
   `tests/classify.test.js`/`semi-annual.test.js`. Battery → `src/cleanup/
   rules/battery-cleanup.js` + `tests/battery-cleanup.test.js`. Copy the
   shape, don't invent a new one.
4. **Inspect the real BuildingReports fields through Chrome DevTools MCP**
   before writing any logic — attach to the existing, already-authenticated
   report tab (never a fresh blank window — see `CLAUDE.md`'s MCP section),
   and confirm the actual dataIndex/field names, real Service values, and
   device types involved. Don't guess a field mapping.
5. **Document newly discovered BuildingReports behavior** in
   `docs/buildingreports-dom-map.md` immediately — selectors, field
   mappings, quirks, anything that took real investigation to find. Future
   sessions shouldn't have to re-discover it.
6. **Implement the smallest requested rule only.** No speculative
   generalization, no unrequested device types, no "while I'm here"
   refactors. See the project's general engineering conventions (no
   premature abstraction, no unused code).
7. **Add pure-logic tests** in `tests/` using `tests/fixtures.js`'s
   `makeRecord()`/`makeBatteryRecord()`. Cover: the common safe variations,
   an already-correct value, a blank value, a preserved/custom value, a
   genuinely ambiguous/conflicting value, and (if applicable) the existing
   profile/rule's behavior remaining unchanged.
8. **Add adapter mappings only when necessary** — a new BuildingReports
   dataIndex the pure logic needs. Keep `adapter.js` JSON-in/JSON-out,
   single-record, and the only file that touches `window.Ext`. Bump
   `ADAPTER_VERSION` if you change it.
9. **Use the existing Preview, Apply, verification, Undo, and write-queue
   systems** — never write a new bulk-save path, never call an adapter
   save function outside `write-queue.js`'s `runQueue`. See `CLAUDE.md`'s
   write-queue section.
10. **Test with a small controlled set first** on the real, live report
    (a handful of hand-picked devices) before anything larger — see the
    rate-limit incident in `docs/buildingreports-dom-map.md` §5.1 for why
    this matters. Increase gradually, only after each stage is clean.
11. **Restore deliberately changed test records** to their exact original
    values before ending the session — a live test report is a real
    customer report, not a sandbox.
12. **Run the complete test suite** (`npm test`) — confirm the new tests
    pass AND every existing test still passes.
13. **Update documentation and current state** — `docs/current-state.md`,
    `docs/rule-inventory.md`, and whichever of `docs/cleanup-rules.md` /
    `docs/battery-cleanup-rules.md` / `docs/architecture.md` /
    `docs/buildingreports-dom-map.md` the change touches.
14. **Report exactly which file should receive the next related rule** —
    e.g. "the next Semi-Annual device-type addition goes in
    `semi-annual.js`'s `VISUAL_FUNCTIONAL_DEVICE_TYPES`" — so the next
    session (or the next request) doesn't have to re-figure out the
    architecture.
