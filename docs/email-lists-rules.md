# Copy Email Lists - rule reference

**Added 2026-09-09.** Architecturally unlike the three cleanup actions:
this feature never writes anything to BuildingReports and never depends on
Service/Battery Cleanup having run. It's a standalone, read-only report
scan whose entire job is to produce the two grouped bullet lists the user
was previously retyping by hand into a customer discrepancy email after
running Cleanup and doing their own manual review.

Source: `src/cleanup/email-summary.js` (pure logic, `buildEmailSummary`) +
`background.js`'s `emailSummary` message (fetches fresh records the same
way `handlePreview` does) + `popup.js`'s `copyEmailBtn` handler (turns the
groups into HTML/plain-text and writes both to the clipboard).

## What counts as "Failed" vs "Passed/Untested With Notes"

Every device currently in the report is classified independently of
whatever Service/Battery Cleanup would do to it:

- **Failed**: `passed === false`. Needs a usable reason (see below) or it's
  excluded and flagged instead - see "Devices with no usable reason."
- **Passed/Untested With Notes**: everything else (`passed !== false` -
  covers an explicit Passed as well as an Untested/null value) **that
  still has a non-blank reason**. A Passed device with no
  Comment/Solution/Note at all is excluded from both lists entirely - it's
  not a discrepancy worth mentioning.

## Reason text

The sub-bullet under each group. **Note wins whenever it's non-blank** -
this is deliberately where Battery Cleanup's own failure/replacement
wording already lives (e.g. `Date Expired/Failed Load Test - Replace
Battery`) and where a technician's free-text note goes (e.g. `Unable To
Test - Device Currently Not In Service For Upgrade/Replacement`). Only
when Note is blank does it fall back to `<Comment> - <Solution>` (or just
whichever of the two is non-blank) - this fallback exists for a device
type this tool has no dedicated rule for yet, not for Battery.

**Devices with no usable reason**: a Failed device with a blank Note and
blank Comment/Solution is never guessed at - it's left out of the Failed
list and surfaced separately in `needsReview` (shown in the popup below
the copy status, with scannumber + device type) so the human notices it
and fills it in by hand. Same "never invent domain text" principle as
everywhere else in this codebase.

## Grouping

Devices are grouped into one bullet when they share **all four** of:
device type, Model Number (verbatim - this is also where a Battery's
`12V-7Ah`-style size lives, no special-casing needed since Battery Cleanup
already writes that exact string into the Model Number field), location
text (see below), and reason text (compared pre-pluralization). The
group's `count` is however many records matched, and both the device-type
word in the header and, when it also appears in the reason text, the
device-type word there too get pluralized whenever `count > 1` (standard
English rule - see "Pluralization" below).

## Location text and the Left/Right suffix

Built from the same five identifying columns Battery Cleanup's Left/Right
pairing already uses - `floor`, `direction`, `location`, `description`,
`areasuite` (see `docs/battery-cleanup-rules.md` and
`src/cleanup/battery-engine.js`'s `PAIR_COLUMNS`) - joined with spaces,
blank columns skipped. The standalone word "Left" or "Right" is stripped
from whichever single column has it, **only when it appears in exactly
one column total** across all five (BuildingReports doesn't put the
marker in a consistent column, and if the marker word coincidentally
appears more than once - e.g. it's also part of genuine location text
elsewhere - the transformation is skipped entirely rather than guessed:
every column's raw text is used untouched, same as an unpaired record).

When a group's members include at least one "left"-marked record and at
least one "right"-marked record, `" Left And Right <Plural(deviceType)>"`
is appended to the location text (e.g. `... Left And Right Batteries`) -
this applies regardless of whether the group is exactly a matched pair
(count 2) or several pairs sharing one location+reason (count 4, e.g. two
Left/Right battery pairs in the same closet).

Only the standalone marker word itself is stripped - a real-world
convention like `"Left Battery"` in one column leaves the word `"Battery"`
behind in the composed location text (the code has no per-device-type
knowledge of what words might accompany the marker, by design - stripping
more than the literal marker word risks removing genuine content in some
other report's convention). This is a cosmetic loose end the user can
trivially edit out when pasting; it's not a data-correctness issue.

## Pluralization

`pluralize()` is a general English rule (consonant+y → ies, s/x/z/ch/sh →
es, otherwise +s), not a per-device-type dictionary - `"Battery"` →
`"Batteries"` falls out of the consonant+y case with no special-casing.
If a real device type or reason phrase is ever found where this rule
produces something wrong, add a narrow override in `email-summary.js` then
(same "never guess, add exceptions as identified" approach as the
Manufacturer dictionary in `rules/battery-cleanup.js`) - don't build a
general irregular-plurals table speculatively.

Reason-text pluralization only replaces a **whole-word, case-sensitive**
match of the singular device type name inside its own reason text (e.g.
`"...Replace Battery"` → `"...Replace Batteries"` inside a Battery group's
reason). It's a no-op for reason text that doesn't happen to mention the
device type by name (e.g. the Annunciator "Unable To Test..." example).

## Clipboard format

Written as both `text/html` and `text/plain` via a single `ClipboardItem`
(`navigator.clipboard.write`), not the plain `writeText` "Copy Review
Items" uses - the whole point of this feature is to preserve the visual
shape of the user's real template (a red Failed section, a black
Passed/Untested With Notes section, real bulleted/nested lists) when
pasted into Outlook/Gmail, which plain text can't carry. This needs no new
manifest permission - it's the same user-gesture-gated Async Clipboard API
`writeText` already uses.

No subject line, greeting, or sign-off is generated - explicitly not
wanted (the user handles those). Two bold headers are generated above each
list (`Devices Failed Listed:` in red, `Devices Passed/Untested With Notes
Listed:` in black) matching the one confirmed from a real example; a
section with zero groups is omitted entirely rather than printed empty.

## What's NOT yet handled / open questions

- The Failed section's header wording (`Devices Failed Listed:`) is an
  assumption - the real email example this was built from was a
  screenshot cropped above that point, so only the second header
  (`Devices Passed/Untested With Notes Listed:`) was actually confirmed.
  Correct it here and in `popup.js`'s `buildEmailHtml` if the real wording
  turns out to differ.
- Sort order within each list is report order (whatever order
  `#devicelistGrid`'s store already holds records in) - no floor/location-
  based sorting has been requested or built.
- The exact red hex color (`EMAIL_FAILED_COLOR` in `popup.js`, currently
  `#c00000`) was not sampled from the real screenshot - adjust it there if
  it doesn't match the user's actual template closely enough.
- Not yet live-tested against a real report - see
  `docs/live-testing-workflow.md` before doing so. Being entirely
  read-only (no writes, no Apply/Undo, no write queue involvement), the
  risk profile is much lower than any of the three cleanup actions.
