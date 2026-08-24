# Repaired / Fixed - rule reference

**Added 2026-08-24.** Architecturally unlike Clean Up Service Entries and
Battery Cleanup: those two classify every device automatically and only
ever ask a human to review the results. Repair/Fixed does the opposite -
it's a human-driven, device-by-device walkthrough, because "was this
device actually repaired/replaced?" isn't something derivable from the
report data itself. Every device gets an explicit answer from a person;
only a device type with a rule (currently just Battery) then gets an
automated field-change form on top of that answer.

## Device scope

Repair/Fixed only ever walks devices **currently marked Failed** (`passed
=== false`) - not the whole report. `src/cleanup/repair-engine.js`'s
`scanFailedDevices(records)` filters for this and preserves report order
(the same order `#devicelistGrid`'s store already holds them in - "in
order by device"). A report with a handful of failures means a handful of
quick questions, not hundreds.

## The walkthrough (popup.js)

A sequential, one-device-at-a-time wizard, not a single scrollable list:

1. **Every** Failed device gets a "was this repaired/replaced?" question
   (Yes / No / Stop & Review), regardless of device type.
2. **No** → advance to the next device, no changes recorded.
3. **Yes**, and the device type has a rule (`ruleKey` from
   `getRepairRuleKey`) → show that rule's form (see "Battery" below).
   Submitting the form computes the write payload immediately via the
   rule's pure `buildBatteryRepairChange`-style function (imported
   directly into `popup.js` - pure logic, no `chrome.*` dependency, so it
   can run in the popup itself without a round-trip through
   `background.js`) and queues it in-memory; nothing is written to
   BuildingReports yet.
4. **Yes**, and the device type has **no rule yet** → the device is added
   to a "needs manual review" list and the walkthrough moves on
   immediately - no form, no automated field change. This is deliberate
   (see "How to add the next device type's rule" below): a wrong guess for
   a device type nobody has built a rule for yet is worse than just
   flagging it.
5. **Stop & Review** ends the walkthrough early (any devices not yet asked
   about are simply left for a future run - re-running Repair/Fixed asks
   about the whole current Failed list again, since it re-scans fresh
   every time).
6. At the end, a summary shows how many repairs are ready to apply and how
   many need manual review, with an **Apply Repairs** button (only enabled
   if at least one repair is queued) and a **Discard All** button that
   throws away everything collected without writing anything.

**Nothing is written to BuildingReports until "Apply Repairs" is
clicked.** That single click runs every queued item through the exact same
paced write queue/checkpoint/verification machinery as every other write
path in this extension (see CLAUDE.md "The shared paced write queue") -
checkpoint kind `repairApply`, one save at a time, checkpointed after every
item, rate-limit backoff, Pause/Cancel Remaining. A separate **Undo Last
Repair** button reverses the same way (checkpoint kind `repairUndo`), with
its own Undo history (`brSidekick.repairUndo.<inspectionId>` in
`chrome.storage.local`) - kept **separate from Battery Cleanup's Undo
history** even though both can touch the same Battery fields, since
they're conceptually distinct actions (an automated classify-and-fix pass
vs. a human-confirmed one-time repair record). Both buttons show a real
entry count in their confirmation before running, via the same
`undoStatus` message Service/Battery Cleanup's combined Undo uses (now
extended to also report `repairEntries`).

## Battery (`src/cleanup/repair-battery.js`)

The only device type with a rule so far. On "Yes, repaired/replaced" for a
Battery, the form asks for exactly four things - everything else is either
fixed or derived, per "avoid human input wherever it can be avoided
safely":

| Field asked | Default shown | Why it's asked |
|---|---|---|
| Amps | The Battery's current Amps value | The replacement battery's capacity can differ (e.g. 7Ah → 8Ah) - Rated Voltage is *not* asked, since it's effectively always 12.00 and doesn't change on a battery swap. |
| Date replaced/fixed | Today's local date | Becomes the new Install Date - most repairs are logged the same day, but always editable. |
| Technician/Customer name | *(blank)* | No sensible default exists. |
| Company name | *(blank)* | No sensible default exists. |

**Never asked, kept exactly as-is:** Rated Voltage.

**Never asked, fixed constants:** Post Test → `0.00`, Tested Ah → `0.00`
(the new battery hasn't been re-tested yet - this is exactly the 0.00/0.00
"already completed" placeholder Battery Cleanup's own load-test exception
recognizes, see `docs/battery-cleanup-rules.md` - a Repair'd battery
showing 0.00/0.00 is never re-flagged as failed by Battery Cleanup unless
a `flat` marker is later added). Passed → checked. Comment → cleared.
Solution → cleared. Service → `Visual & Functional, Passed`.

**Never asked, derived from the new Amps via the exact same formulas
Battery Cleanup uses** (`parseNumericField`/`formatTwoDecimals`/
`trimTrailingZeros`/`MIN_AH_FACTOR`, exported from
`rules/battery-cleanup.js` and reused here, never a second hand-rolled
copy): Min Ah = Amps × 0.65. Model Number = `<Rated Voltage>V-<Amps>Ah`
(only generated if the existing Rated Voltage is valid - left out of the
write payload otherwise, same "don't guess" convention as Battery
Cleanup's own Model Number rule).

**Note** gets a new line appended *below* whatever's already there (never
overwritten - real report evidence: an existing `"Failed Load Test -
Replace Battery"` line from a prior Battery Cleanup Failed run stays, with
the new line added underneath):

```
Battery Replaced By <Technician/Customer name> With <Company name> - <M/D/YY>
```

No quotes, exactly the data provided - confirmed live 2026-08-24:
`Battery Replaced By Test Tech With Test Fire & Safety Co - 8/24/26`.

### Install Date - a brand-new write capability

Every other Battery field this extension writes was already writable
before this feature (see `docs/battery-cleanup-rules.md`). Install Date
was **read-only everywhere in this codebase** until now (`installDate` was
deliberately left out of `adapter.js`'s `BATTERY_FIELD_MAP`, which doubles
as the write-time translation table - see that file's comments). Repair/
Fixed needed to write it, so `adapter.js` gained:

- `BATTERY_DATE_FIELD_MAP` (`installDate` → real dataIndex `installdate`),
  kept separate from `BATTERY_FIELD_MAP` because writing it needs a real
  value transform, not just a rename.
- `parseLocalDateOnlyString(value)` - the inverse of the existing
  `toLocalDateOnlyString` (which converts a real `Date` to this
  extension's own `"YYYY-MM-DD"` string on read). Parses that same
  `"YYYY-MM-DD"` string back into a real JS `Date` at **local midnight**
  via the multi-arg `Date` constructor - never `new Date(str)`, which
  parses a date-only ISO string as UTC midnight per spec and can shift the
  calendar day near local midnight (same "avoid timezone errors" reasoning
  as `rules/battery-cleanup.js`'s `parseDateOnly`). An unparseable value is
  skipped entirely (never written as `null`) - real validation happens
  upstream in `repair-battery.js`/the popup form, this is just a safety net.
- `ADAPTER_VERSION` bumped to 7.

Confirmed live 2026-08-24 (a real report, no customer/report identifiers
recorded here): writing `"2026-08-24"` produced a real `Date` reading
`Mon Aug 24 2026 00:00:00` in the local timezone (no off-by-one-day
shift), and Undo correctly restored the real prior Install Date (`Mon Jan
02 2023 00:00:00`, the Battery's actual original expired date) exactly.

## How to add the next device type's rule

1. Write the rule's pure logic file (`src/cleanup/repair-<devicetype>.js`,
   mirroring `repair-battery.js`) - a `buildXxxRepairChange(record, input)`
   function returning `{ ok: true, writeValue, priorValue, summary }` or
   `{ ok: false, errors }`. Reuse existing pure helpers
   (`rules/battery-cleanup.js`'s exported ones, or add new exports to
   whichever Cleanup rule file already has the formula you need) rather
   than duplicating a formula.
2. Register it in `src/cleanup/repair-engine.js`'s `REPAIR_RULES` list
   (an `isXxx` predicate + a `ruleKey`).
3. If the device type needs a genuinely new BuildingReports field written
   (like Install Date above), add the mapping/transform to `adapter.js`
   and bump `ADAPTER_VERSION` - confirm live via `#deviceAttrGrid`'s
   column config the same way every other field mapping in this codebase
   was confirmed (see `docs/buildingreports-dom-map.md` §7).
4. Add the device type's form to `popup.html`/`popup.js` (a new hidden
   `<section>`, shown when `device.ruleKey === '<your key>'` in the
   `repairYesBtn` handler - see `repairBatteryForm` for the pattern) and
   import the pure `buildXxxRepairChange` function directly into
   `popup.js`, same as `buildBatteryRepairChange`.
5. Decide the write's `saveItemFn` in `background.js`'s
   `handleRepairApply`/`handleRepairUndo` - currently hardcoded to
   `saveBatteryItem` since only Battery exists; if a new device type needs
   a *different* adapter write path (e.g. `applySingleServiceFieldsChange`
   for a plain Service-field device type), `handleRepairApply` will need
   to pick `saveItemFn` per-item based on device type rather than a single
   fixed function - don't assume every future rule writes Battery fields.
6. Add tests (`tests/repair-<devicetype>.test.js`, mirroring
   `tests/repair-battery.test.js`) and update `tests/repair-engine.test.js`
   if `scanFailedDevices`'s per-device dispatch needs new coverage.
7. Update this file's per-device-type table and
   `docs/rule-inventory.md`'s Repair/Fixed table.

## Classification/state, for reference

Unlike the other two actions, Repair/Fixed has no `alreadyCorrect`/
`safeChange`-style bucket system - every device gets exactly one of:

| State | Meaning |
|---|---|
| *(not shown)* | Device is currently Passed - not part of the walkthrough at all. |
| Answered "No" | Failed device, not repaired - no change, not tracked further. |
| Answered "Yes", rule exists, form submitted | Queued in `repairPendingItems` (popup.js), written on Apply. |
| Answered "Yes", rule exists, form errors | Form stays open with `errors` shown - nothing is queued until it validates. |
| Answered "Yes", no rule exists yet | Queued in `repairReviewOnlyDevices` (popup.js) - shown in the summary's review list, never auto-applied. |
| Walkthrough stopped early | Any devices not yet reached are simply left for the next run (re-scans fresh). |
