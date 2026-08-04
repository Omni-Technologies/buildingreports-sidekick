# Battery Cleanup - rule reference

Battery Cleanup is universal: it applies to every device whose Device Type
normalizes to exactly `Battery` (see `isSupportedDeviceType`-style matching
in `src/cleanup/rules/battery-cleanup.js`'s `isBattery()` - case/whitespace
tolerant, never substring/fuzzy), regardless of which Inspection Profile
(Annual/Semi-Annual) is selected elsewhere in the popup. It has no profile
of its own and does not read `src/config/inspection-profiles/`.

Unlike Clean Up Service Entries, a single device can need several
independent field changes at once, so classification is field-level, not a
single bucket per device. Every Battery record produces:

- `fieldChanges`: the only changes Apply is ever allowed to write.
- `reviewFlags`: surfaced to the user, never auto-applied.
- `bucket`: one representative label for compact list views (picked by
  priority - see `pickDeviceBucket` in `rules/battery-cleanup.js` - review
  flags always win over safe changes, and among safe changes Model Number >
  Min Ah > Pre Test > formatting).

## Fields and where they live

| Semantic name (pure logic) | Preview label | BuildingReports dataIndex |
|---|---|---|
| `ratedVoltage` | Rated Voltage | `voltage` |
| `amps` | Amps | `amps` |
| `preTest` | Pre Test | `pretestvoltage` |
| `postTest` | Post Test | `posttestvoltage` |
| `minAh` | Min Ah | `velocity1door` |
| `testedAh` | Tested Ah | `velocity2door` |
| `modelNumber` | Model Number | `modelnumber` |

The dataIndex column is a genuine BuildingReports quirk, confirmed live via
the `#deviceAttrGrid` (`mainDeviceAttr`) column config for a selected
Battery row: "Min Ah" and "Tested Ah" are not dedicated fields.
`velocity1door`/`velocity2door` are the generic attribute-grid columns
normally labeled "Air Flow Value" on Damper Control devices, repurposed and
relabeled per device type. That mapping (`BATTERY_FIELD_MAP`) lives entirely
in `src/site-adapters/buildingreports/adapter.js` - the pure cleanup logic
in `rules/battery-cleanup.js` only ever sees the semantic names on the left,
and never needs to change if BuildingReports renames a dataIndex again (only
the adapter's map does).

`#deviceAttrGrid` is a second, single-row grid that mirrors whichever record
is selected in `#devicelistGrid` - confirmed live that its store record is
the *same record instance* as the main grid's, so writing via
`rec.set({...})` on a record from `#devicelistGrid`'s store (exactly what
the adapter already does) is equivalent to editing it through that panel.

## Rules

### Rated Voltage / Amps

Must be numeric and non-negative. Formatted to exactly two decimal places,
preserving the actual value (`12`, `12.0`, `12.000` -> `12.00`). Blank ->
`Missing Required Value`. Non-numeric or negative -> `Invalid Numeric
Value`. Both block Min Ah/Model Number generation for that record (see
below) - already surfaced via this flag, no separate error is raised.

### Pre Test

Must always be blank. Any non-blank value is cleared unconditionally,
regardless of its content or format (`Pre Test Will Be Cleared`).

### Post Test

Preserve the actual reading, formatted to two decimals. Values in the
common 11.00-13.00 range for a 12V battery are not enforced or assumed -
`0.00` (a failed/dead battery) is a real, confirmed value in production
reports and is left untouched. A negative reading is flagged
`Suspicious Reading`; non-numeric text is flagged `Invalid Numeric Value`.
Neither is ever rewritten. Blank Post Test is left blank, not flagged (not
every battery has been load-tested yet).

### Min Ah

Always `Amps x 0.65`, rounded and formatted to two decimals. Recomputed
from the *current* Amps value every time (never trusts the existing Min Ah
value as a source of truth) and corrected if blank, wrongly formatted, or
simply wrong (`Min Ah Recalculation`). Only computable when Amps is a valid
non-negative number - if not, Min Ah is left completely untouched (Amps'
own review flag already explains why).

### Tested Ah

Preserve the actual reading, formatted to two decimals, exactly like Post
Test. Blank Tested Ah is left blank but flagged `Missing Required Value`
for a human to fill in - unlike Post Test, this is called out explicitly
because a completed load test should have a Tested Ah reading. Never
invented. Negative -> `Suspicious Reading`; non-numeric -> `Invalid Numeric
Value`.

### Model Number

Derived only from the record's *actual* Rated Voltage and Amps (never from
the existing Model Number, which is not trusted even if it looks
plausible): `<Rated Voltage>V-<Amps>Ah`, with insignificant trailing zeros
stripped (`12.00` -> `12`, `7.50` -> `7.5` - a genuine fractional capacity
keeps its decimal). Only generated when *both* Rated Voltage and Amps are
valid; if either is missing/invalid, Model Number is left untouched (the
relevant field's own review flag already covers it).

## Pass/Fail outcome

In addition to the attribute rules above, every Battery gets a record-level
Pass/Fail/Review decision (`classifyBatteryRecord`'s `outcome`, one of
`BatteryOutcome.PASSED` / `DATE_EXPIRED` / `FAILED_LOAD_TEST` /
`DATE_EXPIRED_AND_FAILED_LOAD_TEST` / `REVIEW`), computed from the Inspection
Date and the *newly calculated* Min Ah vs. Tested Ah - never from stale
stored values. This reuses ordinary `#devicelistGrid` columns, not the
attribute-grid quirks above:

| Semantic name (pure logic) | Preview label | BuildingReports dataIndex | Type |
|---|---|---|---|
| `inspectionDate` | Inspection Date | `inspectiondate` | Ext `date` field (real `Date`, per-device) |
| `passed` | Passed (checkbox) | `passed` | boolean |
| `service` | Service | `service` | string |
| `comment` | Comment | `comment` | string |
| `solution` | Solution | `solution` | string |
| `note` | Note | `note` | string |

`inspectionDate` is read-only for Battery Cleanup - it's used to decide
expiration but never written back, so it's not in `BATTERY_FIELD_MAP`.
`passed`/`service`/`comment`/`solution`/`note` already share their real
dataIndex name 1:1, so the adapter's `toRawBatteryFields` falls back to the
semantic name itself when there's no `BATTERY_FIELD_MAP` entry, rather than
needing five trivial identity map entries.

### Left/Right battery pairs

After each Battery has its own outcome classified, `battery-engine.js`
checks for a matching Left/Right pair. If either side has a proven failing
outcome, the other side receives that same failure outcome so the pair is
failed together.

A pair is accepted only when exactly one Left and one Right Battery match
on all five requested Device Editor columns:

- Floor (`floor`)
- Direction (`direction`)
- Location (`location`)
- Description (`description`)
- Area/Suite (`areasuite`)

The standalone `Left`/`Right` word itself is not assumed to live in any one
particular column - real reports have been observed putting it in
Direction, Description, or elsewhere (see below), and there's no reason to
assume those are the only two. So **all five** columns above are scanned
for the marker, and whichever single column actually has it gets that word
swapped out (`Left`<->`Right`) before the rest of its text is compared; every
other column (including that same column when it has none) is compared as
plain text. Matching is case-insensitive, trims leading/trailing
whitespace, and collapses repeated internal whitespace. A record is left
unpaired (never guessed) when: the marker appears in none of the five
columns, the marker appears in more than one of them (whether duplicated
within a single column or split across several), any of the five columns
mismatches between the candidates, or there's more than one Left or Right
candidate in a group.

**Confirmed live** (a real report, 2026-08-04, no customer/report
identifiers recorded here): real technician entries do not reliably put
`Left`/`Right` in Direction - one real pair had Direction holding an
unrelated building label for both Batteries, with the actual marker in
Description ("Left Battery"/"Right Battery") instead. Because the marker's
location isn't predictable, the rule checks all five identifying columns
rather than hardcoding any particular one or two.

The paired side uses the source Battery's existing failure outputs (Date
Expired, Failed Load Test, or both). If both Batteries have their own
proven failures, each keeps its own outcome. Preview reports how many
Batteries were failed due to their pair and identifies the source Battery.

### Expiration (date-only, local calendar)

```
Expired when Inspection Date <= Current Date minus 3 calendar years
```

`adapter.js`'s `toLocalDateOnlyString` converts the record's real `Date`
(`rec.get('inspectiondate')`, stored as a UTC instant, e.g.
`"2025-05-01T11:56:25.000Z"`) into a plain `"YYYY-MM-DD"` string using
**local** `getFullYear`/`getMonth`/`getDate` (never `toISOString`/UTC
components), because the local calendar day can differ from the UTC one
near midnight. `rules/battery-cleanup.js`'s `parseDateOnly` then re-parses
that string with the multi-arg `Date` constructor (`new Date(y, m-1, d)`),
which builds the date from local wall-clock components directly - the
"parse it without timezone errors" path, since `new Date("YYYY-MM-DD")`
would parse as UTC midnight instead. The 3-year cutoff and the inspection
date are both compared as local-midnight `Date`s, so only the calendar date
matters, never time-of-day. `classifyBatteryRecord(record, now)` takes `now`
as an explicit (optional, defaults to `new Date()`) parameter so tests can
fix the reference date.

### Load-test comparison

```
Failed when Tested Ah is numerically lower than the newly calculated Min Ah
```

Uses the same `Amps x 0.65` value computed earlier in this file's Min Ah
rule (recalculated fresh every time, never the stored Min Ah), compared
against the newly-normalized Tested Ah reading. `0.00` Tested Ah is a real
reading and fails like any other value lower than a positive Min Ah - there
is no exemption for it, for a prior Passed state, or for existing
replacement-history text in Note.

### The three failure outputs

| Outcome | Comment | Note |
|---|---|---|
| Date expired only | `Date Expired` | `Date Expired - Replace Battery` |
| Failed load test only | `Failed Test` | `Failed Load Test - Replace Battery` |
| Both | `Date Expired` (date expiration always wins the Comment slot) | `Date Expired/Failed Load Test - Replace Battery` |

All three also set: Passed checkbox unchecked, Service =
`Visual & Functional, Failed`, Solution = `Replace Battery`. Note is
overwritten with the exact wording above whenever Battery Cleanup itself
determines a failing outcome - even if the existing Note contains earlier
replacement-history text - because that history belongs to a *previous*
failure, and the current run is a fresh, independent determination.

### Passing

A Battery passes only when the Inspection Date is valid and not expired,
Tested Ah and Min Ah are both known valid numbers, and Tested Ah >= Min Ah.
Sets: Passed checkbox checked, Service = `Visual & Functional, Passed`,
Comment and Solution cleared. **Note is never touched on a pass** - existing
replacement-history text (e.g. `"Failed Load Test - Replace
Battery\nBattery Replaced By ... - 8/6/25"`) is preserved exactly, since a
passing outcome doesn't mean the history should be erased.

### Missing or invalid data

Deterministic, never assumes missing means Passed:

- A proven expiration or a proven load-test failure always wins, even if
  the *other* input is missing/invalid (e.g. a proven expired date fails
  the Battery even with a blank Tested Ah).
- If neither failure is proven, but the Inspection Date, Min Ah (via Amps),
  or Tested Ah is missing/invalid, the outcome is `REVIEW`: Passed/Service/
  Comment/Solution/Note are left completely untouched, and a `reviewFlags`
  entry with `field: 'outcome'`, bucket `OUTCOME_REQUIRES_REVIEW`, lists
  which piece(s) are unknown. Safe attribute formatting (Rated
  Voltage/Amps/etc.) still applies independently even when the outcome
  itself needs review.

## Classification buckets

| Bucket | Meaning | Auto-applied? |
|---|---|---|
| `alreadyCorrect` | Battery has zero field changes and zero review flags | n/a |
| `safeFormatting` | Rated Voltage / Amps / Post Test / Tested Ah reformatted | Yes |
| `minAhRecalculation` | Min Ah blank, misformatted, or wrong | Yes |
| `modelNumberCorrection` | Model Number doesn't match derived value | Yes |
| `preTestWillBeCleared` | Pre Test had a value | Yes |
| `missingRequiredValue` | Rated Voltage / Amps / Tested Ah blank | No - review only |
| `invalidNumericValue` | Non-numeric or negative Rated Voltage / Amps | No - review only |
| `suspiciousReading` | Negative Post Test / Tested Ah | No - review only |
| `unsupportedBatteryRecord` | Device Type is not confidently `Battery` | No - not processed at all |
| `updateOrSaveFailure` | Apply-time only: the deviceWrite save for this scannumber didn't confirm | n/a |
| `outcomePassed` | Pass/Fail outcome: Passed | Yes |
| `outcomeDateExpired` | Pass/Fail outcome: Failed - Date Expired only | Yes |
| `outcomeFailedLoadTest` | Pass/Fail outcome: Failed - Failed Load Test only | Yes |
| `outcomeDateExpiredAndFailedLoadTest` | Pass/Fail outcome: Failed - both | Yes |
| `outcomeRequiresReview` | Cannot prove Pass or Fail from the available data | No - review only |

A record can contribute to several of the "auto-applied" rows at once (e.g.
Rated Voltage formatting *and* a Model Number correction on the same
Battery) - Preview reports both the number of devices affected and the
total number of individual fields affected, and Apply writes every changed
field for that device in a single `rec.set({...})` call followed by one
overall Save, so a Battery with five field issues gets exactly one save,
not five. The four outcome buckets and `outcomeRequiresReview` take
priority over the plain attribute buckets when `bucket` picks one
representative label for a device (see `pickDeviceBucket`'s
`REVIEW_PRIORITY`/`CHANGE_PRIORITY` in `rules/battery-cleanup.js`) - whether
a Battery passed or failed is the most important thing to see at a glance.

## How to add the next Battery rule

1. If the rule needs a new BuildingReports field, add one entry to
   `BATTERY_FIELD_MAP` in `src/site-adapters/buildingreports/adapter.js`
   (semantic name -> real dataIndex, confirmed live the same way the
   existing seven were - via `#deviceAttrGrid`'s column config for a
   selected device of that type). If the field already shares its semantic
   name with its real dataIndex (an ordinary `#devicelistGrid` column, like
   `passed`/`service`/`comment`/`solution`/`note`), no map entry is needed -
   `toRawBatteryFields` falls back to the semantic name itself. If the field
   is read-only (used to decide an outcome but never written back, like
   `inspectionDate`), read it directly in `toPlainRecord` instead of adding
   it to `BATTERY_FIELD_MAP` (which doubles as the write-time translation
   table) - see `toLocalDateOnlyString` for the pattern.
2. Add the check itself to `classifyBatteryRecord` in
   `src/cleanup/rules/battery-cleanup.js` - follow the existing pattern of
   an `addChange(...)` for a safe, deterministic fix or `addFlag(...)` for
   something only a human should decide. Reuse an existing `BatteryBucket`
   value where it fits (e.g. `SAFE_FORMATTING`, `MISSING_REQUIRED_VALUE`) or
   add a new one if it's a genuinely new kind of outcome.
3. Add the new field's count key to `FIELD_TO_COUNT_KEY` in
   `src/cleanup/battery-engine.js` so Preview's per-field counts pick it up
   automatically.
4. If the new bucket needs its own popup label, add it to
   `BATTERY_BUCKET_LABELS` / `BATTERY_FIELD_LABELS` /
   `BATTERY_COUNT_LABELS` in `src/popup/popup.js`.
5. Add tests to `tests/battery-cleanup.test.js` (per-field logic) and, if it
   changes aggregate counts, `tests/battery-engine.test.js`.

No changes to the popup's button wiring, `background.js`'s message
handlers, or the adapter's save/verify mechanics are needed for a new field
rule - only for a wholly new Battery Cleanup *action* (see
`docs/adding-a-rule.md`).
