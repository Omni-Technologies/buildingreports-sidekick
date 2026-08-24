# Clean Up Service Entries - rule reference

## Classification buckets (every device gets exactly one)

| Bucket | Meaning | Touched by Apply? |
|---|---|---|
| `unsupportedDeviceType` | Device type isn't in the profile's supported list | No |
| `blank` | Service field is empty/whitespace | No |
| `alreadyCorrect` | Already exactly the canonical string | No |
| `ambiguousConflict` | Contains both a Passed and a Failed token | No |
| `safeChange` | Recognized "Visual [& Functional], Passed/Failed" shape, different from canonical | **Yes** |
| `customPreserved` | Matches a known preserve phrase (Not Tested, No Access, etc.) | No |
| `unsupportedField` | Non-blank, doesn't match the recognized shape or a preserve phrase | No |
| `needsReview` | Profile disabled, or an ambiguous One Hitter reference | No |

Only `safeChange` entries are ever written. Preview shows all buckets;
the popup's "Review list" surfaces `ambiguousConflict`,
`unsupportedDeviceType`, `unsupportedField`, and `needsReview` together
since those are the ones a human should look at.

## Annual: device types (`src/config/inspection-profiles/annual.js`)

Alarm Device, Annunciator, Battery, Beam Detector, Bell/Strobe, Carbon
Dioxide (CO2), Chime/Strobe, Control Panel, Damper Control, Disconnect,
Duct Detector, Elevator, Emergency Power Off, Expander Panel, Fan Running,
Fan Shutdown, Fan Start, Fire Barrier, Gas Shutdown, Generator Running,
Handset, Heat Detector, Horn, Horn/Strobe, Indicating Device, Initiating
Device, Locking Device, Module, Monitor Device, Phone Jack, Power Supply,
Printer, Programmable Relay, Pull Station, Releasing Device, Remote Test
Switch, Roll Down Door, Smoke Detector, Speaker, Speaker/Strobe, Special
Control, Strobe, Voice Evacuation.

Matching (`src/cleanup/device-type-matcher.js` +
`src/shared/text-utils.js`) tolerates case, extra whitespace, slash spacing
("Bell / Strobe" = "Bell/Strobe"), and parenthetical spacing ("Carbon
Dioxide(CO2)" = "Carbon Dioxide (CO2)") - but is always an exact match
after normalization, never substring/fuzzy. A device type not on this list
is left completely alone, regardless of what its Service field says.
Communicator, Communication Line, and Monitoring were real-world examples
of this until their own rules were added - see "Communicator /
Communication Line / Monitoring" below; Air Pressure Switch, Tamper
Switch, Waterflow Switch, and Kitchen Hood likewise until "Third-Party
Serviced Devices" below - none of these seven are on this list (they're
intercepted earlier in `classify.js`, before this check ever runs), but
none of them are unsupported/untouched anymore either.

## Result parsing (`src/cleanup/service-parser.js`)

Recognizes: `visual` optionally followed by `& functional` or `and
functional` (case-insensitive, flexible whitespace), then an optional
comma, then `passed` or `failed` (case-insensitive), then an optional
trailing note.

Examples that normalize to `Visual & Functional, Passed`:
`visual and functional, passed`, `Visual and functional, passed`, `Visual &
functional passed`, `Visual & Functional,Passed`.

Failed equivalents normalize to `Visual & Functional, Failed`, e.g. `visual
and functional, failed`, `Visual & functional failed`, `Visual &
Functional,Failed`.

A trailing note is kept, trimmed of leading punctuation, joined with
` - `, and only its first letter is capitalized (never full title-casing,
so acronyms/model numbers/addresses inside the note are untouched):

```
visual and functional, failed - no response
  → Visual & Functional, Failed - No response

visual and functional, failed - replaced FSP-851 at panel NAC-2
  → Visual & Functional, Failed - Replaced FSP-851 at panel NAC-2
```

**Conflict check runs first and wins:** if the raw value contains both a
`passed` and a `failed` word anywhere (e.g. "Failed, retested Passed"), the
entry is classified `ambiguousConflict` and is never rewritten, even though
part of it looks parseable.

## Preserved phrases (never overwritten, no result invented)

`Not Tested`, `Unable To Test`, `Tested By Others`, `No Access`, `See
On-Site Service Records` (matched case-insensitively, as the whole value or
a clear leading phrase). Anything else that doesn't parse as a result and
isn't blank falls into `unsupportedField` (e.g. real values found in
testing: `Bar Coded`, `Yes, 11:02 AM`) - preserved, listed for review,
never guessed at. `Svc. By Hooper 2/25`-style values were also real-world
`unsupportedField` examples until 2026-08-06 - for the four "Third-Party
Serviced Devices" listed below, that exact shape is now a **supported**
canonical value instead; for every other (still-unsupported) device type
it remains `unsupportedField`.

## Heat Detector / One Hitter exception (`src/cleanup/one-hitter.js`)

Only applies when `devicetype` normalizes to `Heat Detector`. The
designation has no dedicated BuildingReports field - installers note it in
free text. The adapter/engine scans (in this order) `description`,
`location`, `direction`, `comment`, `note`, `solution`, `modelnumber`, and
the `service` text itself for a case-insensitive `one[-\s]?hitter` match.

- **Confirmed** (`one hitter` / `one-hitter` found): normalizes to `Visual,
  Passed` or `Visual, Failed` instead of the standard phrase.
- **Ambiguous** (only a weaker `1[-\s]?hitter` variant found, e.g. "1
  hitter", "1-hitter"): classified `needsReview` - the exception is
  **not** guessed at; a human decides.
- **Neither found:** treated as an ordinary Heat Detector (standard
  `Visual & Functional` phrasing).

This was validated live: setting a real Heat Detector's Note field to `One
Hitter` and its Service to `visual and functional, passed` classified it
`safeChange` → `Visual, Passed`; clearing the note reverted it to standard
`Visual & Functional, Passed` handling on the next Preview.

## Heat Detector Restorable (Annual only, `src/cleanup/classify.js`)

**Added 2026-08-06.** Independent of (but related to) the One Hitter
exception above - technicians use `Visual, Passed/Failed` (no
"& Functional") vs. `Visual & Functional, Passed/Failed` itself as a
restorable/non-restorable signal, not just the One Hitter free-text
marker. Annual-only (`annualProfile.heatDetectorVisualOnlyPreserved =
true`; Semi-Annual doesn't set this and is completely unaffected - Heat
Detector there is always `Visual`-only already, see below).

- **A Heat Detector's Service value that already parses as `Visual,
  Passed/Failed`** (no "& Functional", any spacing/capitalization
  variation, and no confirmed One Hitter marker) is **preserved as
  Visual-only** - normalized for spacing/capitalization only (e.g.
  `visual,passed` → `Visual, Passed`), never upgraded to `Visual &
  Functional`. This is the opposite of every other supported device type,
  where a bare "Visual, Passed" always upgrades to the profile's standard
  phrase.
- **BuildingReports' own "Restorable" checkbox** (`#deviceAttrGrid` label
  "Restorable", real dataIndex `simulated` - a plain boolean `checkcolumn`
  field, confirmed live 2026-08-06) is kept in sync with which prefix
  applies, corrective on every Apply run (both directions):
  - **Checked** whenever the standard `Visual & Functional` prefix applies
    (restorable, **both Passed and Failed outcomes** - restorable
    describes the device type, not whether it passed).
  - **Unchecked** whenever a Visual-only exception applies - either a
    confirmed One Hitter marker, or the preserved-as-is signal above.
  - This can make a record `safeChange` even when the Service text itself
    doesn't change (e.g. Service is already correct `Visual & Functional,
    Passed` but Restorable is still unchecked) - same "extra field can
    change independently of Service" pattern as Communicator/Monitoring's
    attribute-field sync below. Written as `{ service, restorable }` in a
    single save via `applySingleServiceFieldsChange`, same as every other
    multi-field Service Cleanup write.
- Confirmed live (2026-08-06, a real report): a real Heat Detector already
  `Visual & Functional, Passed` with Restorable unchecked classified
  `safeChange` (Service text unchanged, Restorable → checked); Apply wrote
  and verified it; Undo restored Restorable to unchecked exactly.

## Semi-Annual: device types (`src/config/inspection-profiles/semi-annual.js`)

Enabled (`enabled: true`) and selectable in the popup. Reuses Annual's full
supported-device list wholesale (imported, not duplicated -
`supportedDeviceTypeKeys`/`supportedDeviceTypes` are literally
`annualProfile`'s) and Annual's `preservePhrases` - Semi-Annual doesn't
change which device types are recognized or which free-text phrases are
preserved, only which canonical prefix each device type gets:

- **Visual & Functional** (only these five): Annunciator, Battery, Control
  Panel, Indicating Device, Power Supply.
- **Visual** (every other Annual-supported device type): Smoke Detector,
  Pull Station, Duct Detector, Heat Detector, Strobe, Horn/Strobe, and so
  on for the rest of Annual's list.

Prefix selection lives in `isVisualFunctionalDeviceType(deviceType,
profile)` (`src/cleanup/device-type-matcher.js`) - true only when
`profile.visualFunctionalDeviceTypeKeys` (Semi-Annual's five-type set,
normalized the same tolerant-but-exact way as `isSupportedDeviceType`) has
the device type; Annual doesn't define this set at all, so the check is
always false for Annual and `classify.js` falls through to
`profile.standardPhrase` ("Visual & Functional" for every Annual device) -
unchanged from before Semi-Annual existed. In `classify.js`, prefix
precedence is: a confirmed Heat Detector One Hitter exception first
(Annual-only, since Semi-Annual's `oneHitterPattern` is `null` and
`detectOneHitter` short-circuits to `'none'`), then the Visual & Functional
device-type check, then `standardPhrase` as the fallback.

Outcome preservation (Passed stays Passed, Failed stays Failed) and every
recognized spelling variation come from `service-parser.js`, which is
shared with Annual and not profile-specific - see "Result parsing" above.
`buildCanonicalService(prefix, parsed)` is what actually assembles the
final string from whichever prefix `classify.js` picked and the parsed
result/note.

Example, straight from a live Preview on a real report:

```
Battery                 Before: Visual, Passed                       After: Visual & Functional, Passed
Smoke Detector           Before: Visual & Functional, Failed           After: Visual, Failed
Pull Station             Before: visual passed                        After: Visual, Passed
```

Confirmed live end-to-end (Preview → Apply → verify → Undo → verify) on a
real report for: an Annunciator Passed case (Visual & Functional group), a
Smoke Detector Passed case (Visual-only group, lowercase variant), a
Control Panel Failed case (Visual & Functional group), and a Duct Detector
custom "Bar Coded" entry (confirmed left untouched throughout).

## Communicator / Communication Line / Monitoring (`src/cleanup/communications-parser.js`)

These three device types have their own fixed Service-field shape,
completely unlike "Visual [& Functional], Passed/Failed" - so they're
intercepted in `classify.js` **before** `isSupportedDeviceType` and handled
entirely by `communications-parser.js` instead of the device-type-matcher/
service-parser/one-hitter pipeline above. This applies **identically under
both Annual and Semi-Annual** - `communications-parser.js` doesn't take a
`profile` argument at all, so neither profile's device list or prefix rules
affect these three device types.

Unlike every other supported device type (which only ever writes `service`),
Communicator and Monitoring can also write a device-attribute field
alongside Service - the same kind of BuildingReports quirk Battery Cleanup's
`BATTERY_FIELD_MAP` already handles, confirmed live via `#deviceAttrGrid`'s
column config (see `docs/buildingreports-dom-map.md` §7):

| Device type | Attribute label | Real dataIndex | Adapter semantic name |
|---|---|---|---|
| Communicator | Restore Time | `seconds` | `restoreTime` |
| Monitoring | Confirmed Time | `time` | `confirmedTime` |
| Communication Line | *(none)* | - | - |

A classification result for these three carries an `extraFieldChanges`
array (empty for every other device type) alongside the usual `bucket`/
`before`/`after` - `engine.js`'s `safeChanges` and `background.js`'s
`handleApply` fold these into a single multi-field write
(`applySingleServiceFieldsChange`) instead of the plain single-string
`applySingleServiceChange` used everywhere else. Undo/Resume need no special
handling - `write-queue.js` and the checkpoint never look inside
`writeValue`/`priorValue` either way (see `docs/architecture.md`).

### Communicator

Always `Restored @ <time> <date>` (confirmed live: `Restored @ 11:29 AM
5/1/25`). A time (`H:MM AM/PM`, tolerant of spacing/case/missing space) is
extracted from anywhere in the raw Service text; if no date is found in
Service, the date is filled in from Inspection Date (never invented from
nothing) - formatted the same way (`M/D/YY`, no leading zeros, 2-digit
year). No time anywhere, or no date anywhere including the Inspection Date
fallback, -> `needsReview`. The normalized time is also mirrored into the
Restore Time attribute field.

**Also recognizes a 24-hour-clock hour (added 2026-08-24, confirmed live
against a real reported case):** `extractTime` in `communications-parser.js`
tolerates an optional `:SS` seconds group and an hour of `00` or `13`-`23`,
converting it to 12-hour form regardless of whether a (possibly redundant
or mismatched) am/pm marker follows - e.g. `15:14:26 pm` and a bare `15:14`
both normalize to `3:14 PM`, `00:05` normalizes to `12:05 AM`. An ordinary
`1`-`12` hour still requires an explicit am/pm marker nearby and is never
guessed, exactly as before. This applies identically to Communication
Line and Monitoring below, since all three share `extractTime`.

### Communication Line

Always `Yes, <time>`. Inspectors sometimes type `Restored @ <time>` (the
Communicator's wording) or mangle the spacing/case in this column - the
time is extracted the same tolerant way and the whole value is rebuilt into
canonical form. No recognizable time -> `needsReview`. No device-attribute
field for this device type (confirmed live - `#deviceAttrGrid` only shows
Manufacture Date for Communication Line).

### Monitoring

Same baseline as Communication Line (`Yes, <time>`, with a mirrored
Confirmed Time attribute), plus three extra rules:

- **Service already exactly `N/A`** (case-insensitive) is a valid passing
  value as-is - left untouched, only the Confirmed Time attribute is synced
  to `N/A` if it isn't already.
- **Passed unchecked WITH an explanatory Note** -> `Service = N/A`,
  `Comment = Failed Test`, `Solution = See Notes/Recommendations`,
  `Confirmed Time = N/A`. **Note is never touched** - it already explains
  the failure. This takes priority even if Service already happens to say
  `N/A`, since the unchecked+Note combination is the authoritative failure
  signal.
- **Passed unchecked with NO Note** -> `needsReview` - can't tell what
  happened, never guessed.

A passing `Yes, <time>` normalization also clears any stale Comment/
Solution left over from an earlier failure (mirrors Battery Cleanup's
Passed-clears-Comment/Solution convention), same as the N/A-passing case.

Confirmed live (a real report, 2026-08-06, no customer/report identifiers
recorded here): a full Preview/Apply/
Undo cycle for one Communicator (messy text + stale attribute -> canonical +
synced attribute), one Communication Line (wrong wording cleaned up), and
one Monitoring record (messy passing text -> canonical, synced attribute,
cleared stale Comment/Solution) - all verified against the live grid, then
restored to their original values.

## Third-Party Serviced Devices (`src/cleanup/third-party-service-parser.js`)

**Added 2026-08-06.** Air Pressure Switch, Tamper Switch, Waterflow
Switch, and Kitchen Hood are serviced by outside companies, not
Passed/Failed tested - their own fixed Service-field shape, completely
unlike "Visual [& Functional], Passed/Failed", so - same as Communicator/
Communication Line/Monitoring above - they're intercepted in `classify.js`
**before** `isSupportedDeviceType` and handled entirely by
`third-party-service-parser.js` instead. Applies **identically under both
Annual and Semi-Annual** (the module doesn't take a `profile` argument at
all).

### Canonical shape

`Svc. By <Company> <M>/<YY>` (e.g. `Svc. By Jefferson F&S 7/26`,
confirmed live 2026-08-06 that real data already uses this exact shape -
`Svc. By Hooper 2/25` on 5 real Tamper Switch/Waterflow Switch records,
now classified `alreadyCorrect`). An existing `Svc. By`/`Svc By`/
`Serviced By`/`Service By` prefix (case-insensitive, optional period) is
tolerated and stripped before re-parsing, then always rebuilt with the
canonical `Svc. By ` prefix. The trailing date must be exactly `M/YY` or
`M/YYYY` (a 4-digit year is truncated to its last two digits) at the very
end of the value - a day-included date (`4/1/26`) or any other shape isn't
recognized, never guessed at. No date found → checked against the same
preserve phrases as Annual/Semi-Annual (`Not Tested`, `No Access`, etc.,
duplicated locally rather than imported so this module stays profile-
independent) → else `unsupportedField`.

### Abbreviation (`src/config/third-party-service-abbreviations.js`)

The company text (everything before the date) is walked word by word:
a run of consecutive words matching `ABBREVIATION_DICTIONARY` (currently
`fire`→F, `protection`→P, `safety`→S, `alarm`→A, `security`→Sec,
`systems`/`system`→Sys, `suppression`→Sup, `inspection`→Insp,
`service`/`services`→Svc, `company`→Co - case-insensitive, trailing
punctuation stripped) is joined with `&` into a single abbreviation token;
`and`/`&` tokens are silent connectors, not abbreviated themselves; every
other word (proper/company names) is left byte-for-byte untouched. This
produces exactly: `Fire and Protection` → `F&P`, `Jefferson Fire And
Safety` → `Jefferson F&S`, `Hooper` → `Hooper` (no dictionary words,
unchanged). Add new words to the dictionary file as real examples turn up
- that's the only file that needs touching for a new abbreviation word.

If the abbreviated candidate still exceeds BuildingReports' 31-character
Service limit, the record is `needsReview` with a `suggestedFix` field
carrying the over-length candidate (never force-truncated) - the popup
shows this as an editable pre-filled text box with an **"Apply This Fix"**
button (see "Manual fix for records that don't fit" below). Every other
bucket sets `suggestedFix: null`.

### Expiration (Comment/Solution/Note only, never Service or Passed)

Independent of whether the Service text itself changes (same "extra field
can change on its own" pattern as Communicator/Monitoring): the service
date's **last day of that month** (e.g. `4/26` → April 30, 2026) plus
exactly one year is compared against Inspection Date. **Strictly more than
a year** past (not exactly one year) sets `Comment` = `Date Expired`,
`Solution` = `Investigate`, `Note` = `Customer To Investigate Maintenance
On Device` - only for whichever of the three don't already match
(idempotent). **Never touches the Passed checkbox, never touches Service
text beyond its own normalization above, and never auto-clears these three
fields when not expired** - deliberately conservative, since Comment/
Solution/Note could hold unrelated pre-existing notes on a device type
this extension has never touched before.

### Manual fix for records that don't fit (popup UI + `manualServiceFix`)

A rare case (confirmed live and exercised end-to-end 2026-08-06), but
needs a path forward rather than a dead-end review item: the popup's
Review list renders an inline editable text box (pre-filled with
`suggestedFix`, `maxlength="31"`) and an "Apply This Fix" button for any
`needsReview` item that carries one. Clicking it sends `{ type:
'manualServiceFix', scannumber, newValue }` to `background.js`, which:
validates non-blank/≤31 chars, re-fetches the record fresh and re-runs
`classifyThirdPartyServiceRecord` purely to pull its current expiration
`extraFieldChanges` (so a manual fix still carries independently-correct
Comment/Solution/Note), writes it through the same single-item
`runQueue`/`applySingleServiceFieldsChange` path as every other write
(reusing the `serviceApply` checkpoint kind rather than a new one), and
merges the confirmed entry into the same Undo history as an ordinary
Apply - `Undo Last Cleanup` reverts a manual fix exactly like any other
change, no special-casing. On success the popup re-runs Preview so the
fixed record drops out of the review list automatically.

Confirmed live end-to-end (2026-08-06, a real report): a Tamper Switch
hand-set to a company name too long to abbreviate under 31 characters was
correctly flagged `needsReview` with a matching `suggestedFix`; editing
the popup's input to a shorter value and clicking "Apply This Fix" saved
it, and a fresh Preview showed it `alreadyCorrect`.

## Adding to Battery Cleanup instead

See `docs/battery-cleanup-rules.md` - Battery Cleanup has no Inspection
Profile of its own and isn't affected by anything in this file. **Since
2026-08-24, the popup's Preview/Apply/Undo buttons trigger both actions
together** (no separate Battery buttons anymore - see `docs/architecture.md`
"UI note"), but they remain fully independent under the hood: separate
checkpoint kinds, separate Undo history, no shared state with anything in
this file.
