# Privacy Policy — BuildingReports Sidekick

**Last updated: 2026-08-06**

BuildingReports Sidekick ("this extension") is an unofficial, independent
productivity tool for people who already have authorized login access to
BuildingReports.com. It is **not affiliated with, endorsed by, or
officially connected to BuildingReports** in any way.

This document describes, plainly and accurately, what the extension does
and does not do with your data. It is based directly on the extension's
source code, which is auditable in full.

## Summary

- All processing happens **locally in your browser**.
- The extension does **not** operate its own server, and does **not**
  send report data, credentials, or usage information to the developer or
  to any third party.
- The extension does **not** use analytics, telemetry, tracking pixels,
  or crash-reporting services.
- The extension does **not** collect, sell, or share personal or
  inspection-report data.
- The only network traffic the extension causes is to
  `https://www.buildingreports.com`, using **your own already-authenticated
  browser session** — the same way BuildingReports' own web app saves your
  edits when you click its own Save button.

## What data the extension touches

The extension reads and writes exactly two kinds of information, both
scoped to the BuildingReports Device Editor page you already have open:

1. **Device Service field / Battery fields / Communicator, Communication
   Line, and Monitoring fields, and pairing context** — read from the
   report's own device grid (via BuildingReports' own in-page ExtJS
   application state, not a network request the extension makes itself),
   classified locally, and — only if you click **Apply** — the changes are
   written back through BuildingReports' own Save button/save API. This
   covers: the Service field (every supported device type); Battery's
   outcome fields (Passed/Comment/Solution/Note) and attribute fields
   (Rated Voltage/Amps/Pre Test/Post Test/Min Ah/Tested Ah/Model Number);
   and, for Communicator and Monitoring specifically, one additional
   device-attribute field each (Communicator's Restore Time, Monitoring's
   Confirmed Time) plus Monitoring's Comment/Solution fields — the same
   kind of field BuildingReports itself already exposes for that device
   type in its own Device Editor, never a new or hidden field. Battery
   Cleanup also reads Floor, Direction, Location, Description, and
   Area/Suite solely to match Left/Right battery pairs, and Battery/
   Communicator/Monitoring read Install Date/Inspection Date solely to
   decide expiration/date formatting; those read-only fields are never
   written or stored by the extension.
2. **A local Undo/checkpoint history** — stored only in
   `chrome.storage.local` (a storage area private to your browser
   profile, never synced to any account or server by this extension):
   - The before/after values of the most recent Apply run, so **Undo**
     can restore them.
   - A short-lived checkpoint of an in-progress paced Apply/Undo run
     (which devices are pending/saved/failed), so closing the popup
     mid-run doesn't lose progress. This is deleted once the run
     completes or is cancelled/discarded.

None of this data ever leaves your machine except as part of the normal
BuildingReports save request your own click triggers — the same request
BuildingReports' own Save button would send.

## What the extension does NOT do

- It does not read, store, or transmit your BuildingReports login
  credentials. The extension only operates within a browser tab you are
  already signed into; it never sees your password.
- It does not add any analytics, advertising, or third-party SDKs.
- It does not run any remotely-hosted or dynamically-fetched code — all
  code that runs is the exact code shipped in the extension package,
  reviewed as part of the Chrome Web Store submission.
- It does not submit, certify, finalize, sign, distribute, or delete any
  report, building, or device record. It only ever writes to the specific
  device fields listed above (Service; Battery's outcome/attribute fields;
  Communicator/Monitoring's own attribute field and, for Monitoring,
  Comment/Solution), using BuildingReports' own Save mechanism.
- It does not operate on any site other than `https://www.buildingreports.com`.
- It does not collect diagnostic logs, screenshots, or usage statistics
  and send them anywhere.

## Permissions this extension requests, and why

| Permission | Why it's needed |
|---|---|
| `scripting` | To read the currently open report's device data and to trigger BuildingReports' own Save flow, by injecting a small adapter script into the Device Editor page you have open. |
| `storage` | To keep the local Undo history and in-progress checkpoint described above, using `chrome.storage.local` on your own machine. |
| `activeTab` | So the extension only ever acts on the tab you're actively viewing when you use it, rather than requesting standing access to all of your open tabs. |
| Host permission for `https://www.buildingreports.com/*` | So the extension is technically restricted to that one site and cannot run on any other page you visit. |

See `docs/chrome-web-store-submission.md` in the source repository for the
full, longer-form justification of each permission.

## Data retention and deletion

Because all extension-managed data lives in `chrome.storage.local`, it is
automatically removed when you uninstall the extension, or you can clear
it manually via `chrome://extensions` → BuildingReports Sidekick →
"Clear data", or by clearing the browser's extension storage. No copy of
this data exists anywhere else — there is no server component to delete
data from.

## Children's privacy

This extension is a professional inspection-workflow tool intended for
use by authorized BuildingReports users performing fire/life-safety
inspection work. It is not directed at children and does not knowingly
collect information from children.

## Changes to this policy

If this extension's data handling ever changes (for example, if a future
version added a genuinely new capability), this file will be updated
alongside that change, and the update will be described in `CHANGELOG.md`.

## Contact

This is an independent, unofficial tool. For questions about this privacy
policy or the extension's behavior, contact the developer at the email
address listed on the Chrome Web Store listing page.
