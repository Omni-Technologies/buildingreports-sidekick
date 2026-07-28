// Moves CHANGELOG.md's "## [Unreleased]" section into a new dated version
// section. Never invents release notes from git history - whatever a human
// wrote under Unreleased (or nothing, if they forgot) is exactly what
// carries over, clearly labeled if it was empty.

import fs from 'node:fs';

const UNRELEASED_HEADING = '## [Unreleased]';
const PLACEHOLDER = '- (add notes here before running a release)';

export function bumpChangelog(changelogPath, newVersion, dateStr) {
  const original = fs.readFileSync(changelogPath, 'utf8');
  const lines = original.split('\n');
  const startIdx = lines.findIndex((l) => l.trim() === UNRELEASED_HEADING);
  if (startIdx === -1) {
    throw new Error(`CHANGELOG.md is missing a "${UNRELEASED_HEADING}" section`);
  }
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## [')) {
      endIdx = i;
      break;
    }
  }
  const body = lines.slice(startIdx + 1, endIdx).join('\n').trim();
  const isPlaceholderOnly = body === '' || body === PLACEHOLDER;
  const releaseNotes = isPlaceholderOnly ? '- No release notes were recorded before this release.' : body;

  const newLines = [
    ...lines.slice(0, startIdx),
    UNRELEASED_HEADING,
    PLACEHOLDER,
    '',
    `## [${newVersion}] - ${dateStr}`,
    releaseNotes,
    '',
    ...lines.slice(endIdx),
  ];

  fs.writeFileSync(changelogPath, newLines.join('\n'));
  return { hadDraftNotes: !isPlaceholderOnly };
}
