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
| Latest locally generated version | 0.1.5 (`releases/buildingreports-sidekick-v0.1.5.zip`) — generated 2026-08-24, not yet confirmed submitted |
| Latest version submitted for review | 0.1.4 — user confirmed submitted 2026-08-06, pending review (not yet approved/rejected) as of this writing. Supersedes 0.1.3 (submitted 2026-08-05) and the earlier 0.1.1 initial submission. **0.1.5 exceeds this and is ready to upload once the user submits it** — update this row only after the user confirms it was actually submitted. |
| Latest version approved/published | Unknown — not yet confirmed by the user. Do not assume approval. |

## Since the last submitted release (0.1.4)

- **Permissions changed?** No — manifest permissions unchanged
  (`scripting`, `storage`, `activeTab`, and the
  `https://www.buildingreports.com/*` host permission). Everything in
  0.1.5, including the new Install Date **write** and the Repaired/Fixed
  action's typed-note input, goes through the existing adapter/
  single-record-save/write-queue machinery under those same permissions.
- **Privacy disclosures updated?** Yes, twice since 0.1.4: 2026-08-06 (see
  history below) and **2026-08-24** — `PRIVACY.md` and
  `docs/chrome-web-store-submission.md` both revised to describe the new
  Repaired/Fixed action, including that it writes Install Date (previously
  read-only) and takes typed technician/company/note input from the user,
  written into existing device fields.
- **0.1.5 release notes**: see `CHANGELOG.md`'s `## [0.1.5]` section - the
  new Repaired/Fixed action (Battery form + generic fallback form for
  every other device type, own Apply/Undo buttons/Undo history); Battery
  Cleanup merged into Service Cleanup's Preview/Apply/Undo buttons (no
  more separate Battery buttons, though the underlying actions stay fully
  independent); blank Battery Post Test filled with a generated
  `12.00`-`13.00` reading; a `0.00` Post Test + `0.00` Tested Ah with no
  "flat" marker now passes instead of fails; Communicator's time parser
  recognizes a 24-hour-clock hour; the Undo confirmation now shows real
  entry counts before restoring. **0.1.5 was generated 2026-08-24**, not
  yet confirmed submitted by the user.

### Prior release history (0.1.4 and earlier)

- **Privacy disclosures updated 2026-08-06** — `PRIVACY.md` and
  `docs/chrome-web-store-submission.md` were revised to describe the new
  Communicator/Communication Line/Monitoring Service Cleanup rules
  (including that Communicator/Monitoring now write one existing
  device-attribute field each, plus Monitoring's Comment/Solution),
  Battery Cleanup's expiration source changing from Inspection Date to
  Install Date, and (same day, second revision) the new Annual Heat
  Detector Restorable field and Third-Party Serviced Devices
  Comment/Solution/Note fields. No manifest permission changes for any of
  this.
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
