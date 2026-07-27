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
(e.g. real examples found in testing: Tamper Switch, Waterflow Switch,
Communicator, Communication Line, Monitoring) is left completely alone,
regardless of what its Service field says.

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
testing: `Bar Coded`, `Svc. By Hooper 2/25`, `Yes, 11:02 AM`) - preserved,
listed for review, never guessed at.

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

## Adding to Battery Cleanup instead

See `docs/battery-cleanup-rules.md` - Battery Cleanup has no Inspection
Profile of its own and isn't affected by anything in this file.
