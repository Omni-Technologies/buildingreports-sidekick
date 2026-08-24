# Web Store status

Tracks the Chrome Web Store listing's real-world state. Kept concise and
free of secrets/credentials — no account passwords, access tokens, or
other private account information ever get recorded here. See
`RELEASING.md` for the full release process and
`docs/chrome-web-store-submission.md` for listing text/permission
justifications.

**Do not guess whether a submitted version has been approved.** Only
update the "Latest version approved/published" row when the user
explicitly says so.

## Distribution

- **Distribution**: Unlisted
- **Existing listing**: Yes — one listing exists. All future releases
  upload to this same listing. **Never create a new Chrome Web Store
  item for a normal update.**
- **Initial submitted version**: 0.1.1

## Version tracking

| Field | Value |
|---|---|
| Latest locally generated version | 0.1.4 (`releases/buildingreports-sidekick-v0.1.4.zip`) — submitted |
| Latest version submitted for review | 0.1.4 — user confirmed submitted 2026-08-06, pending review (not yet approved/rejected). Supersedes 0.1.3 (submitted 2026-08-05) and the earlier 0.1.1 initial submission. |
| Latest version approved/published | Unknown — not yet confirmed by the user. Do not assume approval. |

## Since the last release

- **Permissions changed since prior release?** No — manifest permissions
  unchanged (`scripting`, `storage`, `activeTab`, and the
  `https://www.buildingreports.com/*` host permission already covered the
  new Communicator/Monitoring attribute-field write, the Install Date
  read, the Annual Heat Detector Restorable attribute-field write, and the
  Third-Party Serviced Devices Comment/Solution/Note write; all go through
  the existing adapter/single-record-save/write-queue machinery).
- **Privacy disclosures need updating?** Updated 2026-08-06 — `PRIVACY.md`
  and `docs/chrome-web-store-submission.md` were revised to describe the
  new Communicator/Communication Line/Monitoring Service Cleanup rules
  (including that Communicator/Monitoring now write one existing
  device-attribute field each, plus Monitoring's Comment/Solution),
  Battery Cleanup's expiration source changing from Inspection Date to
  Install Date, and (same day, second revision) the new Annual Heat
  Detector Restorable field and Third-Party Serviced Devices
  Comment/Solution/Note fields.
- **Unreleased notes (2026-08-24, not yet packaged into a release)**:
  Battery Cleanup merged into Service Cleanup's Preview/Apply/Undo buttons
  (no separate Battery buttons in the popup anymore, though the underlying
  actions stay fully independent - checkpoints, Undo history, write
  queue); a new `undoStatus` message so the combined Undo confirmation
  shows real Service/Battery entry counts before restoring; Communicator's
  time parser now recognizes a 24-hour-clock hour (e.g. `15:14:26 pm`) and
  converts it to 12-hour form; blank Battery Post Test is now filled with
  a generated `12.00`-`13.00` reading (cosmetic only); a `0.00` Post Test +
  `0.00` Tested Ah with no "flat" marker anywhere now passes instead of
  fails (marks an already-replaced battery, not a genuine failure) -
  Install Date expiration still independently applies. **Also (same day):
  a new Repaired/Fixed action** - a human-driven, device-by-device
  walkthrough of currently-Failed devices, with an automated Battery rule
  (Amps/replacement date/technician/company form → Post Test/Tested Ah
  reset, Min Ah/Model Number recalculated, Passed/Service/Comment/Solution
  set, a dated Note line appended) and its own Apply/Undo buttons/Undo
  history. This is the first feature to **write** Install Date
  (`ADAPTER_VERSION` bumped to 7 - previously read-only) and the first to
  take free-text human input (technician/company name) written into a
  device field. No manifest permission changes for any of this. Privacy
  disclosures **were** updated 2026-08-24 for the Repaired/Fixed action
  specifically (`PRIVACY.md` and `docs/chrome-web-store-submission.md`
  both revised to describe the Install Date write and the typed
  technician/company name input) - the Battery Cleanup/Communicator
  changes listed above needed no privacy-disclosure changes (no new data
  read, stored, or transmitted beyond what was already listed).
- **0.1.4 release notes**: see `CHANGELOG.md`'s `## [0.1.4]` section
  (Annual Heat Detector Restorable rule; Third-Party Serviced Devices
  rule; Communicator/Communication Line/Monitoring rules; Battery Cleanup
  Install Date expiration — all built up since 0.1.3 and released
  together). **0.1.4 was submitted 2026-08-06** (the same day 0.1.3 was
  still pending from its own 2026-08-05 submission) and is now the
  version pending review.

## Reminder

Always upload updates to the **existing** listing. Never create a new
Chrome Web Store item — that would break automatic updates for everyone
who already installed the unlisted link, and would require re-sharing a
new link to every coworker.
