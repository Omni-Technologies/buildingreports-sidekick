#!/usr/bin/env node
// Release tooling for BuildingReports Sidekick - a small, dependency-free
// Node script (no npm packages beyond Node's own built-ins) that implements:
//
//   node scripts/release.js check              (npm run release:check)
//   node scripts/release.js dry-run            (npm run release:dry-run)
//   node scripts/release.js release <bump>     (npm run release:patch/minor/major)
//
// See RELEASING.md for the full human workflow this supports.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { createZip, readZipEntries, extractZipEntry } from './lib/zip.js';
import {
  collectRuntimeFiles,
  stageFiles,
  validateStagedDir,
  scanFilesForForbiddenContent,
  scanFilesForRemoteCode,
} from './lib/runtime.js';
import { bumpChangelog } from './lib/changelog.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT_DIR, 'manifest.json');
const PACKAGE_PATH = path.join(ROOT_DIR, 'package.json');
const CHANGELOG_PATH = path.join(ROOT_DIR, 'CHANGELOG.md');
const RELEASES_DIR = path.join(ROOT_DIR, 'releases');
const STAGING_DIR = path.join(RELEASES_DIR, '.staging');

const MAX_REASONABLE_ZIP_BYTES = 5 * 1024 * 1024; // 5 MB - this project is a few small JS/PNG files

function log(msg) {
  console.log(msg);
}
function section(title) {
  console.log(`\n== ${title} ==`);
}
function fail(msg) {
  console.error(`\nFAILED: ${msg}`);
  process.exitCode = 1;
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
}

function bumpVersion(version, kind) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!m) throw new Error(`version "${version}" is not in MAJOR.MINOR.PATCH form`);
  let [major, minor, patch] = m.slice(1).map(Number);
  if (kind === 'major') {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (kind === 'minor') {
    minor += 1;
    patch = 0;
  } else if (kind === 'patch') {
    patch += 1;
  } else {
    throw new Error(`unknown version bump kind "${kind}" (expected patch, minor, or major)`);
  }
  return `${major}.${minor}.${patch}`;
}

// ---- Step: validate the source tree's manifest/package.json before doing anything else ----
function validateSourceManifest() {
  const problems = [];
  let manifest = null;
  try {
    manifest = readJson(MANIFEST_PATH);
  } catch (err) {
    problems.push(`manifest.json does not parse: ${err.message}`);
    return { ok: false, problems, manifest: null };
  }

  if (manifest.manifest_version !== 3) problems.push(`manifest_version is ${manifest.manifest_version}, expected 3`);
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version || '')) {
    problems.push(`manifest.json "version" (${manifest.version}) is not in MAJOR.MINOR.PATCH form`);
  }

  const referenced = [];
  if (manifest.background && manifest.background.service_worker) referenced.push(manifest.background.service_worker);
  if (manifest.action && manifest.action.default_popup) referenced.push(manifest.action.default_popup);
  if (manifest.icons) referenced.push(...Object.values(manifest.icons));
  if (manifest.action && manifest.action.default_icon) referenced.push(...Object.values(manifest.action.default_icon));
  for (const rel of referenced) {
    if (!fs.existsSync(path.join(ROOT_DIR, rel))) problems.push(`manifest references "${rel}" but it does not exist in the source tree`);
  }

  if (Array.isArray(manifest.host_permissions)) {
    for (const hp of manifest.host_permissions) {
      if (hp === '<all_urls>' || hp === '*://*/*' || hp === 'http://*/*' || hp === 'https://*/*') {
        problems.push(`host_permissions includes an overly broad pattern ("${hp}") - confirm this is really required`);
      }
    }
  }

  let pkg = null;
  try {
    pkg = readJson(PACKAGE_PATH);
  } catch (err) {
    problems.push(`package.json does not parse: ${err.message}`);
  }
  if (pkg && manifest && pkg.version !== manifest.version) {
    problems.push(`package.json version (${pkg.version}) does not match manifest.json version (${manifest.version})`);
  }

  return { ok: problems.length === 0, problems, manifest, pkg };
}

// ---- Step: run the existing test suite ----
function runTests() {
  const testsDir = path.join(ROOT_DIR, 'tests');
  const testFiles = fs
    .readdirSync(testsDir)
    .filter((f) => f.endsWith('.test.js'))
    .map((f) => path.join('tests', f));
  const result = spawnSync(process.execPath, ['--test', ...testFiles], {
    cwd: ROOT_DIR,
    encoding: 'utf8',
  });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  return result.status === 0;
}

// ---- Step: repo hygiene scan (informational, does not block by itself) ----
function repoHygieneScan() {
  const result = spawnSync('git', ['ls-files'], { cwd: ROOT_DIR, encoding: 'utf8' });
  if (result.status !== 0) {
    log('(skipping repo-wide hygiene scan - git ls-files unavailable)');
    return [];
  }
  const tracked = result.stdout.split('\n').filter(Boolean).map((f) => path.join(ROOT_DIR, f));
  return scanFilesForForbiddenContent(tracked);
}

// ---- Shared "check" pipeline used by check / dry-run / release ----
function runCheckPipeline() {
  section('Validating manifest.json / package.json');
  const src = validateSourceManifest();
  if (!src.ok) {
    src.problems.forEach((p) => log(`  ✗ ${p}`));
    return { ok: false };
  }
  log(`  ✓ manifest.json valid, version ${src.manifest.version}, MV3`);
  log(`  ✓ package.json version matches (${src.pkg.version})`);

  section('Runtime file allowlist');
  const runtimeFiles = collectRuntimeFiles(ROOT_DIR);
  log(`  ${runtimeFiles.length} runtime files will ship:`);
  for (const f of runtimeFiles) log(`    ${f}`);

  section('Scanning runtime files for secrets / report identifiers');
  const absRuntime = runtimeFiles.map((f) => path.join(ROOT_DIR, f));
  const secretHits = scanFilesForForbiddenContent(absRuntime);
  if (secretHits.length) {
    for (const h of secretHits) log(`  ✗ ${path.relative(ROOT_DIR, h.file)}:${h.line} - ${h.pattern} - ${h.snippet}`);
    return { ok: false };
  }
  log('  ✓ no secrets or report identifiers found in shipped files');

  section('Scanning runtime files for remote-code patterns');
  const remoteHits = scanFilesForRemoteCode(absRuntime);
  if (remoteHits.length) {
    for (const h of remoteHits) log(`  ✗ ${path.relative(ROOT_DIR, h.file)}:${h.line} - ${h.pattern} - ${h.snippet}`);
    return { ok: false };
  }
  log('  ✓ no eval/new Function/remote-script patterns found');

  section('Repository hygiene scan (informational, all tracked files)');
  const hygieneHits = repoHygieneScan();
  if (hygieneHits.length) {
    log('  ⚠ possible secrets/report identifiers found in tracked (non-shipped) files - review before committing:');
    for (const h of hygieneHits) log(`    ${path.relative(ROOT_DIR, h.file)}:${h.line} - ${h.pattern} - ${h.snippet}`);
  } else {
    log('  ✓ nothing suspicious found across all tracked files');
  }

  section('Running test suite (npm test)');
  const testsOk = runTests();
  if (!testsOk) {
    log('  ✗ test suite failed');
    return { ok: false };
  }
  log('  ✓ all tests passed');

  return { ok: true, manifest: src.manifest, pkg: src.pkg, runtimeFiles };
}

// ---- Staging + zip + validation, shared by dry-run and release ----
function stageBuildValidate({ stagingDir, zipOutPath, expectedVersion }) {
  section('Staging runtime files');
  const runtimeFiles = collectRuntimeFiles(ROOT_DIR);
  stageFiles(ROOT_DIR, runtimeFiles, stagingDir);
  log(`  ✓ staged ${runtimeFiles.length} files into ${path.relative(ROOT_DIR, stagingDir)}`);

  section('Validating staged package');
  const staged = validateStagedDir(stagingDir);
  if (!staged.ok) {
    staged.problems.forEach((p) => log(`  ✗ ${p}`));
    return { ok: false };
  }
  log('  ✓ manifest.json present at staged root, parses, MV3, all references resolve');
  log('  ✓ no forbidden files/extensions in staged package');

  section('Building ZIP');
  const entries = runtimeFiles.map((rel) => ({
    name: rel,
    data: fs.readFileSync(path.join(stagingDir, rel)),
  }));
  const zipBuffer = createZip(entries);
  fs.mkdirSync(path.dirname(zipOutPath), { recursive: true });
  fs.writeFileSync(zipOutPath, zipBuffer);
  log(`  ✓ wrote ${zipOutPath} (${zipBuffer.length} bytes)`);

  section('Validating ZIP');
  const zipProblems = [];
  const zipBytes = fs.readFileSync(zipOutPath);
  if (zipBytes.length === 0) zipProblems.push('ZIP file is empty');
  if (zipBytes.length > MAX_REASONABLE_ZIP_BYTES) {
    zipProblems.push(`ZIP file is unexpectedly large (${zipBytes.length} bytes > ${MAX_REASONABLE_ZIP_BYTES} byte sanity limit)`);
  }

  let zipEntries = [];
  try {
    zipEntries = readZipEntries(zipBytes);
  } catch (err) {
    zipProblems.push(`ZIP does not parse: ${err.message}`);
  }

  if (zipEntries.length) {
    const manifestEntry = zipEntries.find((e) => e.name === 'manifest.json');
    if (!manifestEntry) {
      zipProblems.push('manifest.json is not present at the ZIP root');
    } else {
      const manifestBuf = extractZipEntry(zipBytes, manifestEntry);
      let manifestInZip;
      try {
        manifestInZip = JSON.parse(manifestBuf.toString('utf8'));
      } catch (err) {
        zipProblems.push(`manifest.json inside the ZIP does not parse: ${err.message}`);
      }
      if (manifestInZip) {
        if (manifestInZip.manifest_version !== 3) zipProblems.push('manifest.json inside the ZIP is not manifest_version 3');
        if (expectedVersion && manifestInZip.version !== expectedVersion) {
          zipProblems.push(`ZIP's manifest version (${manifestInZip.version}) does not match expected version (${expectedVersion})`);
        }
      }
    }

    const hasExtraParentDir = zipEntries.length > 0 && zipEntries.every((e) => e.name.includes('/'));
    if (hasExtraParentDir) {
      zipProblems.push('every entry is nested under a subdirectory - manifest.json is not directly at the ZIP root');
    }
    const forbiddenInZip = zipEntries.filter((e) => /\.(map|log|tmp)$/i.test(e.name) || /(^|\/)(\.git|\.github|\.claude|node_modules)(\/|$)/.test(e.name));
    if (forbiddenInZip.length) {
      zipProblems.push(`ZIP contains forbidden entries: ${forbiddenInZip.map((e) => e.name).join(', ')}`);
    }
  }

  if (zipProblems.length) {
    zipProblems.forEach((p) => log(`  ✗ ${p}`));
    return { ok: false };
  }
  log(`  ✓ ${zipEntries.length} entries, manifest.json at root, version matches, no forbidden entries`);

  section('Extracting ZIP to a fresh directory for independent verification');
  const verifyDir = `${stagingDir}-verify`;
  fs.rmSync(verifyDir, { recursive: true, force: true });
  fs.mkdirSync(verifyDir, { recursive: true });
  for (const e of zipEntries) {
    const dest = path.join(verifyDir, e.name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, extractZipEntry(zipBytes, e));
  }
  const extractedManifestOk = fs.existsSync(path.join(verifyDir, 'manifest.json'));
  log(`  ${extractedManifestOk ? '✓' : '✗'} extracted package root contains manifest.json (${verifyDir})`);
  fs.rmSync(verifyDir, { recursive: true, force: true });
  if (!extractedManifestOk) return { ok: false };

  return { ok: true, entryCount: zipEntries.length, zipBytes: zipBytes.length };
}

function sha256Of(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// ---- Commands ----

function cmdCheck() {
  section('BuildingReports Sidekick — release:check');
  const result = runCheckPipeline();
  if (!result.ok) {
    fail('release:check found problems above - fix them before releasing.');
    return;
  }
  log('\nrelease:check passed. Source tree and packaging config look releasable.');
}

function cmdDryRun() {
  section('BuildingReports Sidekick — release:dry-run');
  const result = runCheckPipeline();
  if (!result.ok) {
    fail('release:dry-run: pre-release checks failed above.');
    return;
  }

  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'br-sidekick-dry-run-'));
  const stagingDir = path.join(tmpBase, 'staging');
  const zipOutPath = path.join(tmpBase, `buildingreports-sidekick-v${result.manifest.version}.zip`);

  try {
    const built = stageBuildValidate({ stagingDir, zipOutPath, expectedVersion: result.manifest.version });
    if (!built.ok) {
      fail('release:dry-run: staging/zip validation failed above.');
      return;
    }
    log(`\nDry run succeeded: a valid v${result.manifest.version} package was built and validated at a temporary`);
    log('location and has now been cleaned up. No files were changed, no version was bumped, nothing was written to releases/.');
  } finally {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  }
}

function cmdRelease(bumpKind) {
  section(`BuildingReports Sidekick — release:${bumpKind}`);
  const result = runCheckPipeline();
  if (!result.ok) {
    fail('Pre-release checks failed above - no version was changed.');
    return;
  }

  const originalManifestText = fs.readFileSync(MANIFEST_PATH, 'utf8');
  const originalPackageText = fs.readFileSync(PACKAGE_PATH, 'utf8');
  const originalChangelogText = fs.readFileSync(CHANGELOG_PATH, 'utf8');

  function restoreOnFailure(reason) {
    fs.writeFileSync(MANIFEST_PATH, originalManifestText);
    fs.writeFileSync(PACKAGE_PATH, originalPackageText);
    fs.writeFileSync(CHANGELOG_PATH, originalChangelogText);
    fs.rmSync(STAGING_DIR, { recursive: true, force: true });
    fail(`${reason} — manifest.json, package.json, and CHANGELOG.md were restored to their pre-release state.`);
  }

  const newVersion = bumpVersion(result.manifest.version, bumpKind);
  section(`Bumping version ${result.manifest.version} -> ${newVersion}`);

  const manifest = readJson(MANIFEST_PATH);
  manifest.version = newVersion;
  writeJson(MANIFEST_PATH, manifest);

  const pkg = readJson(PACKAGE_PATH);
  pkg.version = newVersion;
  writeJson(PACKAGE_PATH, pkg);

  log(`  ✓ manifest.json and package.json both set to ${newVersion}`);

  const dateStr = new Date().toISOString().slice(0, 10);
  try {
    const { hadDraftNotes } = bumpChangelog(CHANGELOG_PATH, newVersion, dateStr);
    log(`  ✓ CHANGELOG.md: moved ${hadDraftNotes ? 'recorded' : 'placeholder (no notes were written)'} Unreleased notes into [${newVersion}] - ${dateStr}`);
  } catch (err) {
    restoreOnFailure(`Could not update CHANGELOG.md: ${err.message}`);
    return;
  }

  const zipName = `buildingreports-sidekick-v${newVersion}.zip`;
  const zipOutPath = path.join(RELEASES_DIR, zipName);

  let built;
  try {
    built = stageBuildValidate({ stagingDir: STAGING_DIR, zipOutPath, expectedVersion: newVersion });
  } catch (err) {
    restoreOnFailure(`Unexpected error while building the package: ${err.message}`);
    return;
  }
  if (!built.ok) {
    fs.rmSync(zipOutPath, { force: true });
    restoreOnFailure('Staging/ZIP validation failed above.');
    return;
  }

  fs.rmSync(STAGING_DIR, { recursive: true, force: true });

  const checksum = sha256Of(zipOutPath);
  fs.writeFileSync(`${zipOutPath}.sha256`, `${checksum}  ${zipName}\n`);

  section('Release complete');
  log(`  Version:       ${newVersion}`);
  log(`  ZIP path:      ${path.relative(ROOT_DIR, zipOutPath)}`);
  log(`  SHA-256:       ${checksum}`);
  log(`  Entry count:   ${built.entryCount}`);
  log(`  ZIP size:      ${built.zipBytes} bytes`);
  log('  Validation:    passed (manifest at root, MV3, version matches, no forbidden files)');
  log('\nEdit CHANGELOG.md\'s new version section further if needed, then follow RELEASING.md to upload to the Chrome Web Store.');
}

// ---- Entry point ----
const [, , command, arg] = process.argv;

if (command === 'check') {
  cmdCheck();
} else if (command === 'dry-run') {
  cmdDryRun();
} else if (command === 'release') {
  if (!['patch', 'minor', 'major'].includes(arg)) {
    fail('Usage: node scripts/release.js release <patch|minor|major>');
  } else {
    cmdRelease(arg);
  }
} else {
  fail('Usage: node scripts/release.js <check|dry-run|release> [patch|minor|major]');
}
