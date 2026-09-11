# Chrome Web Store submission guide

Everything needed to fill out the Chrome Web Store developer dashboard for
the **unlisted** listing of BuildingReports Sidekick. Text in this file is
meant to be copy-pasted directly into the dashboard's fields. Placeholders
that require something external (screenshots, a hosted URL) are marked
`[PLACEHOLDER: ...]`.

**Current status**: this listing already exists (created and submitted
Unlisted with version `0.1.1`) — see `docs/web-store-status.md` for the
live-tracked status. The listing-creation instructions below remain as
reference for what was done originally and for disaster recovery; a
normal future update only needs the listing text/justifications here plus
`RELEASING.md`'s "Upload future versions to the same existing listing"
step.

This extension is reviewed against Chrome's Manifest V3 platform and the
Chrome Web Store Program Policies as of this writing. Re-check
https://developer.chrome.com/docs/webstore/program-policies/ and
https://developer.chrome.com/docs/extensions/reference/manifest before
each submission in case policy has changed since.

## Suggested store title

```
BuildingReports Sidekick (Unofficial)
```

Keeping "(Unofficial)" directly in the title (in addition to the
description) removes any ambiguity about affiliation at the point where a
user is most likely to only skim the title.

## Short description (≤ 132 characters, shown in search/listing cards)

```
Unofficial cleanup tools for BuildingReports inspection reports. Not affiliated with or endorsed by BuildingReports.
```

(120 characters — matches `manifest.json`'s `description` field.)

## Detailed description

```
BuildingReports Sidekick is an independent, unofficial productivity
extension for people who already have authorized login access to
BuildingReports.com. It is not affiliated with, endorsed by, or
officially connected to BuildingReports in any way — it is a third-party
tool built to save time on specific, repetitive data-entry cleanup tasks
inside BuildingReports' own Device Editor page.

WHAT IT DOES

1. Clean Up Service Entries — scans every device's Service field in the
   currently open report and normalizes clear "Visual [& Functional],
   Passed/Failed" variations to one canonical form, under either an
   Annual or Semi-Annual inspection profile you choose. Communicator,
   Communication Line, and Monitoring devices have their own fixed
   Service-field formats instead (e.g. "Restored @ <time> <date>" for
   Communicator, "Yes, <time>" for Communication Line/Monitoring) and are
   normalized the same way under either profile; Communicator and
   Monitoring also mirror the corrected time into one small device-attribute
   field BuildingReports itself already exposes for that device type
   (Restore Time / Confirmed Time). Under the Annual profile, a Heat
   Detector's existing Visual-only Service value is preserved as a
   deliberate restorable/non-restorable signal, and BuildingReports' own
   "Restorable" checkbox for that device is kept in sync. Air Pressure
   Switch/Tamper Switch/Waterflow Switch/Kitchen Hood/Fire Pump Phase
   Reversal/Fire Pump Power/Fire Pump Running/Fire Pump Trouble/Pre-Action
   System devices (serviced by outside companies, not Passed/Failed
   tested) are normalized to "Svc. By <Company> <Date>", abbreviating
   known industry words to fit
   BuildingReports' character limit, and flag Comment/Solution/Note for
   review when the service date is more than a year past. Anything blank,
   ambiguous, unsupported, or already correct is left untouched.

2. Battery Cleanup — scans every Battery device in the report and
   normalizes Rated Voltage / Amps / Post Test / Tested Ah formatting
   (tolerating a trailing unit suffix like "12 V"), clears Pre Test,
   recalculates Min Ah, corrects Model Number, normalizes known
   Manufacturer spelling variants (a narrow, growing dictionary, e.g.
   "Power-Sonic"), and sets the Passed/Failed outcome from Install Date
   and Tested Ah vs Min Ah. When either side of an unambiguous Left/Right
   battery pair fails, both sides are failed together; Floor, Direction,
   Location, Description, and Area/Suite are read only to identify that
   pair. Anything missing,
   invalid, or suspicious is flagged instead of guessed at, and ambiguous
   pairs are left unpaired. Shares its Preview/Apply/Undo buttons with
   Clean Up Service Entries (both run together on one click) while staying
   independent under the hood.

3. Repaired / Fixed — a separate, human-driven action: walks only the
   devices the currently open report already shows as Failed, one at a
   time, and asks you to confirm whether each was actually repaired or
   replaced before changing anything. For a Battery you confirm was
   replaced, a short form asks for the new amperage (if it changed), the
   date it was replaced/fixed, and who did the work (technician/customer
   name and company name) — every other field (Post Test, Tested Ah, Min
   Ah, Model Number, Passed, Service, Comment, Solution) is then set or
   recalculated automatically from that input, and a dated note
   summarizing the repair is appended below any existing notes. Every
   other device type gets a simpler generic form (just a note you type)
   that marks the device Passed with canonical Service text and a cleared
   Comment/Solution — a placeholder until a dedicated rule exists for that
   device type. Nothing is written until you review the full list and
   click Apply.

All three actions follow the same safe workflow: Preview/scan (read-only,
shows exactly what would change and why) → Apply (writes only the changes
you confirmed, through BuildingReports' own Save button/save API, one
device at a time so BuildingReports' own rate limits are respected) →
Undo (restores the exact original values). Every Apply/Undo run is
checkpointed locally so closing the popup mid-run never loses progress.

WHAT IT DOES NOT DO

This extension only ever edits a small, fixed set of device fields —
Service; Battery's outcome and attribute fields, including Install Date
when you use Repaired/Fixed; for Communicator and Monitoring specifically,
one existing device-attribute field each plus Monitoring's
Comment/Solution; for an Annual Heat Detector, one existing
device-attribute checkbox (Restorable); and for third-party serviced
devices, Comment/Solution/Note — through BuildingReports' own Save
button/save API. It has no ability to submit, certify, finalize, sign,
distribute, or delete a report, building, or device record, and no such
capability is planned.

DATA HANDLING

All processing happens locally in your browser. The extension has no
server component, uses no analytics, and does not transmit report data
anywhere except to https://www.buildingreports.com itself, through your
own already-authenticated session, exactly the way BuildingReports' own
Save button would. See the full privacy policy for details.

WHO THIS IS FOR

This is an internal/limited-distribution tool shared directly with
coworkers who perform BuildingReports inspection data entry. It requires
your own valid BuildingReports login and "Modify Inspection Report"
permission on the report you're working on — the extension does not grant
any access you don't already have.
```

## Single-purpose explanation

Chrome Web Store policy requires every extension to have a single,
narrow purpose. Paste this into the "Single purpose" field:

```
This extension has one purpose: to normalize and correct specific,
well-defined data-entry fields (the Service field, Battery's outcome
and attribute fields including Install Date, and a small matching set
of fields for Communicator/Communication Line/Monitoring devices,
Annual Heat Detectors, and third-party serviced devices) on
BuildingReports.com's Device Editor page, using BuildingReports' own
existing save mechanism. Clean Up Service Entries, Battery Cleanup,
and Repaired/Fixed are three facets of that same purpose (device
record field normalization/correction) rather than unrelated
features — all three read the same report's device records and write
back through the same paced save queue; Repaired/Fixed additionally
takes a small amount of typed confirmation input (who did a repair
and when) but writes it into the exact same kind of existing device
field the other two actions already write. It does not add unrelated
functionality (no reporting/export/analytics/scheduling features, no
navigation or report-submission capability).
```

## Permission justifications (paste per-permission in the dashboard)

**`scripting`**
```
Required to read the currently open BuildingReports report's device
data and to trigger BuildingReports' own existing Save flow. The
extension injects a small adapter script into the Device Editor page
you already have open (only when you click Preview/Apply/Undo in the
popup) so it can classify device fields and, if you choose to Apply,
call BuildingReports' own save function for the field it corrects. No
code is fetched remotely — the injected script ships inside the
extension package.
```

**`storage`**
```
Required to keep two small pieces of state locally in
chrome.storage.local, scoped to your own browser profile: (1) the
before/after values from the most recent Apply run, so Undo can
restore them exactly, and (2) a short-lived progress checkpoint during
a paced Apply/Undo run, so closing the popup mid-run doesn't lose
progress. Nothing is synced to any account or server.
```

**`activeTab`**
```
Limits the extension to only ever act on the browser tab you are
actively viewing when you use it (open the popup and click a button),
rather than requesting standing background access to all of your open
tabs.
```

**Host permission: `https://www.buildingreports.com/*`**
```
Restricts the extension's ability to inject scripts and read/write
page data to BuildingReports' own domain only. BuildingReports' Device
Editor lives inside a nested frameset (a top page, an inspection-log
frame, and the actual Device Editor frame, all same-origin), so the
adapter is injected into every frame of the tab to self-detect which
one hosts the real editor - this permission is what allows checking
each of those same-origin frames. The extension cannot run on, or
access data from, any other website.
```

## Data-use disclosures (Chrome Web Store "Data Use" form)

When the dashboard's Privacy Practices tab asks what data is collected:

- **Personally identifiable information**: Not collected by the
  extension itself. (BuildingReports report data may incidentally
  contain device install locations, technician notes, etc. — this stays
  entirely within your BuildingReports session and the extension's local
  `chrome.storage.local`; it is never sent to the developer. Repaired/
  Fixed additionally lets you type a technician/customer name and company
  name directly into the popup, which is written into the device's Note
  field on BuildingReports the same way any other cleanup change is —
  never sent anywhere besides BuildingReports itself.)
- **Health information**: No.
- **Financial and payment information**: No.
- **Authentication information**: No — the extension never sees your
  BuildingReports password; it only acts within a tab you are already
  signed into.
- **Personal communications**: No.
- **Location**: No.
- **Web history**: No — the extension does not track browsing outside
  BuildingReports.com, and has no `content_scripts` running on any other
  site.
- **User activity**: No analytics/telemetry of any kind.
- **Website content**: Yes — device record fields (Service text, Battery
  attribute values including Install Date and Manufacturer, Communicator/
  Monitoring's attribute field, an Annual Heat Detector's Restorable
  field, third-party serviced devices' Comment/Solution/Note, and the
  Floor/Direction/Location/Description/Area-Suite context used to
  identify battery pairs) from the BuildingReports report you have open,
  processed locally as described above and in `PRIVACY.md`. A "Copy
  Review Items" button additionally copies a plain-text summary of
  unrecognized/needs-review items to your own system clipboard on
  request — nothing is stored or sent anywhere by that action. A "Copy
  Email Lists" button similarly copies two formatted device lists
  (Failed, and Passed/Untested-with-notes) to your own system clipboard
  on request, from the same already-disclosed device fields — also
  nothing stored or sent anywhere.

Certify: "I do not sell or transfer user data to third parties" and "I do
not use or transfer user data for purposes unrelated to the item's single
purpose" — both true based on the code review in this repository.

## Unofficial / not-affiliated disclaimer

Already present in:
- `manifest.json`'s `description` field.
- The suggested store title above.
- The detailed description above.
- `PRIVACY.md`.

Do not remove this disclaimer from any of those in a future update
without a specific reason to.

## Unlisted-distribution instructions

1. In the Chrome Web Store Developer Dashboard, create a **new item**.
2. Upload the release ZIP (see `RELEASING.md` for how it's generated).
3. Under **Visibility**, choose **Unlisted** (not "Public", not
   "Private" — Unlisted means anyone with the direct listing link can
   install it, but it won't appear in search or browse results).
4. Complete the required listing fields using the text in this document.
5. Complete the Privacy Practices / Data Use tab using the disclosures
   above, and set the **Privacy policy URL** to the hosted location of
   `PRIVACY.md` — `[PLACEHOLDER: hosted PRIVACY.md URL, e.g. a GitHub
   raw link, GitHub Pages URL, or gist]`.
6. Submit for review.
7. Once approved, share the unlisted item's URL directly with coworkers
   (see `RELEASING.md` for the full workflow, including how future
   updates reach installed users).

## Manual Chrome Web Store dashboard checklist

Things that must be done by hand in the dashboard — not automatable from
this repository:

- [ ] Sign in with the Chrome Web Store developer account (one-time
      $5 registration fee if not already a registered developer).
- [ ] Create the item and upload the first release ZIP.
- [ ] Set visibility to **Unlisted**.
- [ ] Paste in the store title, short description, and detailed
      description from this document.
- [ ] Upload icons/promotional images if the dashboard requests them
      beyond what's already embedded in the package (see "Screenshots
      and promotional assets" below).
- [ ] Fill in the Privacy Practices tab (permissions justification +
      data-use disclosures above).
- [ ] Set the Privacy policy URL once `PRIVACY.md` is hosted somewhere
      public.
- [ ] Choose a support/contact email.
- [ ] Submit for review.
- [ ] After approval, copy the unlisted item URL and share it with
      coworkers (e.g. via internal chat/email — do not post it publicly,
      since "Unlisted" relies on the link not being broadly published).
- [ ] For every future version: upload the new ZIP to the **same**
      existing item (never create a new item), then submit again for
      review. See `RELEASING.md`.

## Screenshots / promotional assets still needed

The Chrome Web Store listing page supports (and for some visibility
levels may require) at least one screenshot. None are included in this
repository because they would need to show a real BuildingReports report
(risking exposing customer/report data) or a synthetic mock:

- `[PLACEHOLDER: at least one 1280x800 or 640x400 PNG/JPEG screenshot of
  the popup UI, ideally captured against a synthetic/test report — never
  a real customer report]`
- `[PLACEHOLDER: optional small promotional tile image, 440x280, if the
  dashboard requests one for an Unlisted item — not always required]`

Store-listing assets (screenshots, promo tiles, this document itself)
intentionally live outside `src/` and are **not** included in the
production release ZIP (see `RELEASING.md`'s runtime allowlist) — Chrome
only needs the packaged extension files at install time, not marketing
assets.
