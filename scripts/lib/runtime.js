// Explicit allowlist of what's actually required for the extension to run
// in the browser - the release ZIP is built from exactly this list, never
// by copying everything and then excluding unwanted files. Adding a new
// runtime directory (e.g. a new src/ subfolder) requires a deliberate edit
// here, which is the point.

import fs from 'node:fs';
import path from 'node:path';

export const RUNTIME_ROOT_FILES = ['manifest.json'];

export const RUNTIME_DIRS = [
  { dir: 'src/popup', extensions: ['.html', '.css', '.js'] },
  { dir: 'src/background', extensions: ['.js'] },
  { dir: 'src/cleanup', extensions: ['.js'] },
  { dir: 'src/config', extensions: ['.js'] },
  { dir: 'src/shared', extensions: ['.js'] },
  { dir: 'src/site-adapters', extensions: ['.js'] },
  { dir: 'src/icons', extensions: ['.png'] },
];

function walk(absDir, extensions, rootDir, out) {
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const full = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      walk(full, extensions, rootDir, out);
    } else if (entry.isFile() && extensions.includes(path.extname(entry.name).toLowerCase())) {
      out.push(path.relative(rootDir, full).split(path.sep).join('/'));
    }
  }
}

// Returns a sorted list of repo-root-relative, forward-slash paths for
// every file that belongs in the shipped extension.
export function collectRuntimeFiles(rootDir) {
  const files = [];
  for (const rel of RUNTIME_ROOT_FILES) {
    if (fs.existsSync(path.join(rootDir, rel))) files.push(rel);
  }
  for (const { dir, extensions } of RUNTIME_DIRS) {
    const abs = path.join(rootDir, dir);
    if (fs.existsSync(abs)) walk(abs, extensions, rootDir, files);
  }
  return files.sort();
}

// Copies exactly the given relative file list from rootDir into stagingDir,
// preserving relative structure. stagingDir is created fresh (removed first
// if it already exists) so a prior failed run never leaks into the next.
export function stageFiles(rootDir, relFiles, stagingDir) {
  fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.mkdirSync(stagingDir, { recursive: true });
  for (const rel of relFiles) {
    const src = path.join(rootDir, rel);
    const dest = path.join(stagingDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

const FORBIDDEN_NAMES = new Set(['.git', '.github', '.claude', 'node_modules', '.DS_Store', 'Thumbs.db', 'releases']);
const FORBIDDEN_EXTENSIONS = new Set(['.map', '.log', '.tmp', '.zip']);

// Defense-in-depth structural check on an already-staged directory: even
// though staging only ever copies from the allowlist above, this confirms
// nothing forbidden snuck in and that the manifest's own references
// (service worker, popup, icons) actually resolve inside the staged tree.
export function validateStagedDir(stagingDir) {
  const problems = [];

  const manifestPath = path.join(stagingDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    problems.push('manifest.json is missing from the staged package root');
    return { ok: false, problems, manifest: null };
  }

  let manifest = null;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    problems.push(`manifest.json does not parse as JSON: ${err.message}`);
  }

  if (manifest) {
    if (manifest.manifest_version !== 3) {
      problems.push(`manifest_version is ${manifest.manifest_version}, expected 3`);
    }
    const referenced = [];
    if (manifest.background && manifest.background.service_worker) referenced.push(manifest.background.service_worker);
    if (manifest.action && manifest.action.default_popup) referenced.push(manifest.action.default_popup);
    if (manifest.icons) referenced.push(...Object.values(manifest.icons));
    if (manifest.action && manifest.action.default_icon) referenced.push(...Object.values(manifest.action.default_icon));
    for (const rel of referenced) {
      if (!fs.existsSync(path.join(stagingDir, rel))) {
        problems.push(`manifest references "${rel}" but it is not present in the staged package`);
      }
    }
  }

  (function scan(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const relForReport = path.relative(stagingDir, full);
      if (FORBIDDEN_NAMES.has(entry.name)) {
        problems.push(`forbidden file/directory present in staged package: ${relForReport}`);
        continue;
      }
      if (entry.isDirectory()) {
        scan(full);
      } else if (FORBIDDEN_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        problems.push(`forbidden file type present in staged package: ${relForReport}`);
      }
    }
  })(stagingDir);

  return { ok: problems.length === 0, problems, manifest };
}

// Heuristic scan for things that must never ship or be committed: secrets/
// credentials, and BuildingReports report/device identifiers. Not
// exhaustive - a human should still eyeball a diff before releasing - but
// catches the obvious cases automatically. Only scans text-like files;
// binary assets (icons) are skipped.
const TEXT_EXTENSIONS = new Set(['.js', '.json', '.html', '.css', '.md', '.txt']);

const SECRET_PATTERNS = [
  { name: 'private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'likely secret/API key/token/password assignment', re: /\b(api[_-]?key|secret|token|password)\b\s*[:=]\s*["'][^"']{8,}["']/i },
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'suspicious BuildingReports report/device identifier', re: /\b(scannumber|inspectionid|buildingid|bldid|inspid)\b\s*[:=]\s*["']?\d{3,}/i },
];

export function scanFilesForForbiddenContent(absFilePaths) {
  const hits = [];
  for (const file of absFilePaths) {
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) continue;
    if (!TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, idx) => {
      for (const pattern of SECRET_PATTERNS) {
        if (pattern.re.test(line)) {
          hits.push({ file, line: idx + 1, pattern: pattern.name, snippet: line.trim().slice(0, 120) });
        }
      }
    });
  }
  return hits;
}

// Chrome Web Store forbids remotely-hosted/dynamically-fetched code. This
// project doesn't use any, but the release check scans the staged JS for
// the obvious ways that could sneak in, as a guardrail against a future
// regression.
const REMOTE_CODE_PATTERNS = [
  { name: 'eval(', re: /\beval\s*\(/ },
  { name: 'new Function(', re: /\bnew\s+Function\s*\(/ },
  { name: 'importScripts( with remote URL', re: /importScripts\s*\(\s*["']https?:\/\// },
  { name: '<script src> with remote URL', re: /<script[^>]+src\s*=\s*["']https?:\/\//i },
];

export function scanFilesForRemoteCode(absFilePaths) {
  const hits = [];
  for (const file of absFilePaths) {
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) continue;
    const ext = path.extname(file).toLowerCase();
    if (!['.js', '.html'].includes(ext)) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, idx) => {
      for (const pattern of REMOTE_CODE_PATTERNS) {
        if (pattern.re.test(line)) {
          hits.push({ file, line: idx + 1, pattern: pattern.name, snippet: line.trim().slice(0, 120) });
        }
      }
    });
  }
  return hits;
}
