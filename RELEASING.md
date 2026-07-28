# Releasing BuildingReports Sidekick

This is the full, step-by-step process for testing, packaging, and
publishing updates to the Chrome Web Store **Unlisted** listing. Read
`docs/chrome-web-store-submission.md` alongside this for the exact text
to paste into the dashboard.

**Current status**: the initial Unlisted listing already exists and was
submitted with version `0.1.1`. See `docs/web-store-status.md` for the
live-tracked status (latest generated/submitted/approved version,
whether permissions or privacy disclosures need updating before the next
release). Steps 5-6 below (signing in, creating the listing) are kept as
reference for what already happened and for disaster-recovery — every
future release skips straight to step 13 ("upload to the same existing
listing").

## 0. Before you start a release

Edit `CHANGELOG.md`'s `## [Unreleased]` section and describe what
changed, from the user's point of view (added rules, fixed behavior,
BuildingReports compatibility changes, permission changes, security/
reliability changes — see the guidance at the top of that file). The
release commands move whatever is written there into the new version's
section automatically; they never invent release notes from Git history.

## 1. Test changes locally with Load unpacked

1. Make your code changes under `src/`.
2. Run `npm test` — all `tests/*.test.js` must pass.
3. Go to `chrome://extensions`, enable **Developer mode**, click **Load
   unpacked** (or, if already loaded, click the reload icon on the
   extension's card — or use the Chrome DevTools MCP `reload_extension`
   tool if you're working with Claude Code).
4. Reopen the popup fresh (old popup instances don't pick up new code).
5. If you changed `src/site-adapters/buildingreports/adapter.js`, bump
   `ADAPTER_VERSION` in that file first (see `CLAUDE.md`/`docs/architecture.md`
   — a same-or-newer adapter already in an open tab is otherwise never
   replaced).
6. Manually verify Preview/Apply/Undo behavior against a real (but
   already-authenticated) BuildingReports report tab before releasing —
   see `CLAUDE.md`'s "Connecting through Chrome DevTools MCP" and "Safety
   restrictions" sections. Every write is production-affecting; there is
   no sandbox.

## 2. Confirm the working tree contains no private data

`npm run release:check` (see step 3) already runs an informational scan
of every tracked file for obvious secrets/report identifiers as part of
its "Repository hygiene scan" section. Review its output. Also do a
manual sanity check before committing anything:

```
git status
git diff
```

Look for anything that looks like a real customer name, building/report
ID, credential, or a recovery/debug dump that shouldn't be there. See
`CLAUDE.md`'s "Do not include..." note and this project's `.gitignore`,
which already backstops common patterns (`credentials.json`, `*.env`,
`*recovery-state*`, etc).

## 3. Create patch, minor, and major releases

```
npm run release:check      # validate only - no version change, no zip
npm run release:dry-run    # full build+validate in a temp location - no version change, nothing written to releases/
npm run release:patch      # bump 0.1.0 -> 0.1.1, build, validate, write releases/buildingreports-sidekick-vX.Y.Z.zip
npm run release:minor      # bump 0.1.1 -> 0.2.0
npm run release:major      # bump 0.2.0 -> 1.0.0
```

Use **patch** for bug fixes and BuildingReports compatibility repairs,
**minor** for a new rule/feature that doesn't change existing behavior,
**major** for a breaking change to how an existing cleanup action behaves
(rare — this project is deliberately conservative about that).

Each `release:*` command:

1. Validates `manifest.json`/`package.json` (parses, Manifest V3, version
   format, referenced files exist, permissions look sane, versions in
   sync).
2. Scans the files that will actually ship for secrets/report identifiers
   and remote-code patterns (hard failure if anything is found).
3. Runs an informational scan across **all** tracked files (not just
   shipped ones) for the same patterns.
4. Runs the full `npm test` suite.
5. Only if all of the above pass: bumps the version in both
   `manifest.json` and `package.json`, moves `CHANGELOG.md`'s Unreleased
   notes into a new dated section.
6. Stages exactly the runtime allowlist (see "What's excluded from
   releases" below) into a fresh `releases/.staging/` directory.
7. Validates the staged directory (manifest at root, references resolve,
   no forbidden files).
8. Builds `releases/buildingreports-sidekick-vX.Y.Z.zip` and validates it
   (parses as a ZIP, manifest at root with no extra parent directory,
   version in the manifest matches the filename, no forbidden entries, no
   source maps, not empty, not unexpectedly large).
9. Extracts the ZIP into a second fresh directory purely to confirm the
   extracted root really does contain `manifest.json` — independent proof
   the package works, not just an assumption from the source tree.
10. Writes a `.sha256` checksum file next to the ZIP.
11. Prints the final version, ZIP path, entry count, size, and validation
    result.

**If step 6 or later fails after the version was already bumped**, the
script automatically restores `manifest.json`, `package.json`, and
`CHANGELOG.md` to their exact pre-release content and removes any
partially-written ZIP/staging directory — you are left with a clean,
unchanged working tree, not a half-released state.

`release:check` and `release:dry-run` never touch the version, the
changelog, or `releases/` — safe to run as often as you like, including
in a normal development loop.

## 4. Locate and validate the generated ZIP

```
releases/buildingreports-sidekick-vX.Y.Z.zip
releases/buildingreports-sidekick-vX.Y.Z.zip.sha256
```

The release command already validates the ZIP as part of the process
(see step 3 above). To re-check an already-built ZIP by hand later:

```
npm run release:check
```

(`release:check` re-validates the current source tree, not a past ZIP —
if you need to re-verify a specific old ZIP file, extract it manually and
confirm `manifest.json` is at its root and parses.)

## 5. Sign into the Chrome Web Store developer dashboard

Go to https://chrome.google.com/webstore/devconsole and sign in with the
Google account you want to own this listing (one-time $5 registration fee
if you've never registered as a Chrome Web Store developer before). This
is a manual step — nothing in this repository can or should do this for
you, and no credentials are ever stored in this project.

## 6. Create the initial listing

Click **New Item**, upload
`releases/buildingreports-sidekick-vX.Y.Z.zip` (the first one you
generate), and let the dashboard create a new listing from it.

## 7. Choose Unlisted visibility

Under the listing's **Visibility** / **Distribution** settings, choose
**Unlisted** (not Public, not Private). Unlisted means:

- Anyone with the direct listing URL can view and install it.
- It never appears in Chrome Web Store search or category browsing.
- You control who gets the link — treat the link itself as something not
  to post publicly.

## 8. Upload the ZIP

If you haven't already in step 6, upload the ZIP from step 4 under the
listing's **Package** tab.

## 9. Complete privacy and permission disclosures

Use `docs/chrome-web-store-submission.md`'s "Permission justifications"
and "Data-use disclosures" sections — paste them directly into the
dashboard's Privacy Practices tab. Set the **Privacy policy URL** field to
wherever you've hosted `PRIVACY.md` (a GitHub raw link, GitHub Pages, or a
gist all work — `docs/chrome-web-store-submission.md` has a placeholder
for this).

## 10. Add listing text, icons, and screenshots

Use `docs/chrome-web-store-submission.md`'s title/short description/
detailed description text. The extension's own icons (`src/icons/`) are
already bundled in the ZIP and will be picked up automatically for the
listing's icon. Screenshots are not included in this repo (see that
doc's "Screenshots / promotional assets still needed" section) — capture
at least one against a synthetic/test report, never a real customer
report, before submitting.

## 11. Submit the first version for review

Click **Submit for review**. Even Unlisted items go through Google's
automated (and sometimes manual) review — this can take anywhere from a
few hours to a few days.

## 12. Share the unlisted listing link with coworkers

Once approved, the dashboard shows the item's public (but unlisted) URL.
Share that link directly with coworkers (internal chat/email) — they open
it and click **Add to Chrome** like any normal extension. They do **not**
need Developer Mode enabled and do **not** need to manually load an
unpacked folder; the listing itself is what they install from.

## 13. Upload future versions to the same existing listing

For every subsequent release:

1. Do steps 0-4 above (write changelog notes, run `npm run release:patch`
   /`minor`/`major`, locate the new ZIP).
2. In the dashboard, open the **same existing item** (never create a new
   one) and upload the new ZIP under its Package tab.

## 14. Submit updates for review

Click **Submit for review** again. Same review process as the first
version.

## 15. Verify the approved version is live

After Google approves it, the dashboard's item page shows the new
version number as the current published version. Confirm the version
shown matches the one you just released.

## 16. Verify installed users received the new version

Chrome checks for extension updates automatically on its own schedule
(typically within a few hours, sometimes up to ~24h) — there is no
"push" you trigger yourself. To confirm a specific coworker's install
updated: have them open `chrome://extensions`, enable Developer mode, and
check the version shown on the BuildingReports Sidekick card, or click
"Update" on that page to force an immediate check.

## 17. Same listing and identity, automatic updates

Because you always upload to the same existing item (never a new one),
the extension's ID never changes, and everyone who installed it from the
unlisted link keeps the exact same installed extension — Chrome just
swaps in the newer approved version in place, automatically, once
Google's review approves it. No reinstall, no new link, no action needed
from your coworkers for an ordinary update.

## 18. Handle updates that introduce new permissions

If a future change to `manifest.json`'s `permissions` or
`host_permissions` actually needs something new (rare — re-read
`docs/chrome-web-store-submission.md`'s justifications first and prefer
not to), be aware that:

## 19. Chrome may pause the update until permissions are accepted

Chrome does not silently grant new, more powerful permissions to an
already-installed extension. Instead, it disables the updated version
for each user until they explicitly review and accept the new permission
prompt (visible on `chrome://extensions` as "This extension has been
disabled" / a permissions-review banner). Until a user does that, they
keep running the last version they already approved.

## 20. Avoid unnecessary permission changes

Because of #19, adding a permission — even one that seems harmless —
creates real friction for every installed user, not just a dashboard
formality. Default to solving a new requirement within the existing
`scripting`/`storage`/`activeTab` + BuildingReports-only host permission
set already justified in `docs/chrome-web-store-submission.md` before
reaching for a new one.

## 21. Stop or roll back a broken release

If a just-published version turns out to be broken:

1. In the dashboard, you can **Unpublish** the current version (removes
   it from being installable/updatable further) — existing installs keep
   whatever version they already have; this does not roll them back.
2. There is no dashboard action that "reverts" a published version back
   to an older version number. Chrome Web Store does not allow
   re-publishing a lower version number over a higher one that was
   already live — **do not** tell yourself "I'll just re-upload the old
   ZIP", because its version number will be less than or equal to what
   was already published and the dashboard will reject it.

## 22. Re-release a known-good state with a newer version number

The actual recovery procedure:

1. `git checkout` (or otherwise restore) the last known-good source
   state.
2. Run `npm run release:patch` (or whatever bump is appropriate) from
   that known-good state — this produces a **new, higher** version number
   built from old-but-good code.
3. Upload that new ZIP to the same existing listing and submit for
   review, exactly like any other update.
4. Once approved, this becomes the new "current" version, and installed
   users update to it the same automatic way described in steps 16-17.

## 23. Preserve the same listing and extension identity throughout

Every one of the above always targets the **one** existing Unlisted
item/listing created in step 6 — never delete and recreate the listing,
and never manually change the extension's ID. Doing either would force
every coworker to reinstall from a brand-new link, defeating the whole
point of "automatic updates to the same install."

## What's excluded from releases

The release ZIP is built from an explicit allowlist
(`scripts/lib/runtime.js`'s `RUNTIME_ROOT_FILES`/`RUNTIME_DIRS`) — only
`manifest.json` plus the actual runtime HTML/CSS/JS/PNG under `src/`.
Everything else in this repository — and specifically the following — is
never staged and never ends up in the ZIP:

- `.git`, `.github`, `.claude`
- `CLAUDE.md`, all of `docs/`, `README.md`, `PRIVACY.md`, `CHANGELOG.md`,
  `RELEASING.md` (documentation, not runtime)
- `tests/`, `tests/fixtures.js`
- `node_modules/` (there are none currently, but the allowlist wouldn't
  include it regardless)
- `scripts/` (release tooling and the icon generator are dev-only, not
  shipped)
- `releases/` (build output, would be nonsensical to package itself)
- Any `.map`, `.log`, `.tmp` files, editor/OS artifacts, or existing ZIPs

## Should release ZIPs be committed to Git?

**No** — `releases/` is fully `.gitignore`d. A release ZIP is a build
artifact, fully reproducible at any time by running
`npm run release:patch/minor/major` (or `release:dry-run` for a
throwaway build) against a given commit — there's no unique information
in the ZIP that isn't already in the source tree at that commit's
`manifest.json` version. Committing binary ZIPs on every release would
only bloat the repository's history for no benefit. If you need to hand
someone a specific past version's ZIP, check out that commit/tag and
re-run the release command.

## Optional Chrome Web Store API automation

This project does **not** currently include automated upload-via-API
support, and the manual ZIP-upload workflow above is fully functional
without any credentials or extra setup — that remains the primary,
always-working path.

If you want to add optional automation later (uploading a built ZIP via
the Chrome Web Store Publish API instead of the dashboard's file picker),
keep these constraints if you do:

- It must be entirely opt-in — `npm run release:*` must keep working with
  zero credentials for anyone who doesn't set it up.
- Read credentials only from environment variables or a
  git-ignored local config file (e.g. `.cws-publish.env`, already added
  to `.gitignore` above) — never commit a real client secret/refresh
  token. Provide only an example placeholder file (e.g.
  `.cws-publish.env.example`) if you build this.
- Keep "upload a new package version" and "submit for review/publish"
  as two separate, explicit commands — never auto-publish without a
  human explicitly running the publish step.
- Official setup reference if you build this later: Google's Chrome Web
  Store Publish API documentation (OAuth client credentials + refresh
  token from Google Cloud Console, scoped to the Chrome Web Store API).

None of this exists yet in this repository — this section is guidance for
if/when it's worth building, not a description of current behavior.
