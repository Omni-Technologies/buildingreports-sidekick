# Chrome Web Store submission guide

Everything needed to fill out the Chrome Web Store developer dashboard for
the **unlisted** listing of BuildingReports Sidekick. Text in this file is
meant to be copy-pasted directly into the dashboard's fields. Placeholders
that require something external (screenshots, a hosted URL) are marked
`[PLACEHOLDER: ...]`.

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
tool built to save time on two specific, repetitive data-entry cleanup
tasks inside BuildingReports' own Device Editor page.

WHAT IT DOES

1. Clean Up Service Entries — scans every device's Service field in the
   currently open report and normalizes clear "Visual [& Functional],
   Passed/Failed" variations to one canonical form, under either an
   Annual or Semi-Annual inspection profile you choose. Anything blank,
   ambiguous, unsupported, or already correct is left untouched.

2. Battery Cleanup — scans every Battery device in the report and
   normalizes Rated Voltage / Amps / Post Test / Tested Ah formatting,
   clears Pre Test, recalculates Min Ah, corrects Model Number, and sets
   the Passed/Failed outcome from Inspection Date and Tested Ah vs Min
   Ah — again leaving anything missing, invalid, or suspicious untouched
   and flagged for review instead of guessed at.

Both actions follow the same safe workflow: Preview (read-only, shows
exactly what would change and why) → Apply (writes only the changes
classified as safe, through BuildingReports' own Save button/save API,
one device at a time so BuildingReports' own rate limits are respected) →
Undo (restores the exact original values). Every Apply/Undo run is
checkpointed locally so closing the popup mid-run never loses progress.

WHAT IT DOES NOT DO

This extension only ever edits a device's Service field or Battery
attribute fields, through BuildingReports' own Save button/save API. It
has no ability to submit, certify, finalize, sign, distribute, or delete
a report, building, or device record, and no such capability is planned.

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
well-defined data-entry fields (the Service field, and Battery
attribute fields) on BuildingReports.com's Device Editor page, using
BuildingReports' own existing save mechanism. Clean Up Service Entries
and Battery Cleanup are two facets of that same purpose (device
record field normalization) rather than two unrelated features — both
read the same report's device records, classify them with the same
safe/ambiguous/needs-review logic, and write back through the same
paced save queue. It does not add unrelated functionality (no
reporting/export/analytics/scheduling features, no navigation or
report-submission capability).
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
  `chrome.storage.local`; it is never sent to the developer.)
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
- **Website content**: Yes — device record fields (Service text,
  Battery attribute values) from the BuildingReports report you have
  open, read/written locally as described above and in `PRIVACY.md`.

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
