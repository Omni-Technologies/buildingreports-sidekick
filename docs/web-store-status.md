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
| Latest locally generated version | 0.1.2 (`releases/buildingreports-sidekick-v0.1.2.zip`) |
| Latest version submitted for review | 0.1.1 (initial submission) — 0.1.2 not yet submitted |
| Latest version approved/published | Unknown — not yet confirmed by the user. Do not assume approval. |

## Since the last release

- **Permissions changed since prior release?** No.
- **Privacy disclosures need updating?** No — `PRIVACY.md` and
  `docs/chrome-web-store-submission.md` were updated and reviewed against
  the current code on 2026-08-04 for Left/Right Battery pairing context.
- **0.1.2 release notes**: see `CHANGELOG.md`'s `## [0.1.2]` section
  (Battery Cleanup Left/Right pair failure propagation).

## Reminder

Always upload updates to the **existing** listing. Never create a new
Chrome Web Store item — that would break automatic updates for everyone
who already installed the unlisted link, and would require re-sharing a
new link to every coworker.
