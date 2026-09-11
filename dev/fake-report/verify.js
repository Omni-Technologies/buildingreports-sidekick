// Headless sanity check for dev/fake-report/ — no Chrome needed. Loads
// fixtures.js + fake-ext.js + the REAL adapter.js (the one Chrome injects
// into the actual report tab) into a vm sandbox shaped like a browser
// (window === the global scope object, same as real Chrome), calls the
// real adapter API exactly like background.js does, then feeds the result
// through the REAL, unmodified classify.js/engine.js pipeline. Confirms the
// three fake-report files stay wired together correctly whenever any of
// them changes - run with `node dev/fake-report/verify.js`.
//
// This is NOT a replacement for `npm test` (that's the source of truth for
// business-logic correctness) or for actually opening the page in Chrome
// (that's what confirms write-queue pacing/backoff/checkpointing works
// through real chrome.scripting.executeScript + Ext.Ajax event timing) -
// see docs/fake-report-testing.md.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const sandbox = {};
sandbox.window = sandbox; // browser reality: window === the global scope object
sandbox.console = console;
vm.createContext(sandbox);

for (const file of ['fixtures.js', 'fake-ext.js']) {
  const code = fs.readFileSync(path.join(__dirname, file), 'utf8');
  vm.runInContext(code, sandbox, { filename: file });
}
const adapterPath = path.join(__dirname, '..', '..', 'src', 'site-adapters', 'buildingreports', 'adapter.js');
vm.runInContext(fs.readFileSync(adapterPath, 'utf8'), sandbox, { filename: 'adapter.js' });

const adapter = sandbox.window.__brSidekickAdapter;
if (!adapter) throw new Error('adapter.js did not attach window.__brSidekickAdapter');

const meta = adapter.detect();
if (!meta) throw new Error('detect() returned null - fake Ext shim is not wired correctly');
console.log('detect():', meta);

const records = adapter.getAllRecords();
console.log(`getAllRecords(): ${records.length} records`);
if (records.length === 0) throw new Error('getAllRecords() returned zero records - check fixtures.js');

const { classifyRecord } = await import('../../src/cleanup/classify.js');
const { annualProfile } = await import('../../src/config/inspection-profiles/annual.js');
const { semiAnnualProfile } = await import('../../src/config/inspection-profiles/semi-annual.js');
const { runBatteryCleanup } = await import('../../src/cleanup/battery-engine.js');

for (const profile of [annualProfile, semiAnnualProfile]) {
  const counts = {};
  for (const record of records) {
    const result = classifyRecord(record, profile); // throws on any real bug, not caught deliberately
    counts[result.bucket] = (counts[result.bucket] || 0) + 1;
  }
  console.log(`Service Cleanup buckets (${profile.name || (profile === annualProfile ? 'Annual' : 'Semi-Annual')}):`, counts);
}

const batteryResult = runBatteryCleanup(records);
console.log(
  `Battery Cleanup: ${batteryResult.totalBatteryDevicesFound} battery device(s) found, ` +
    `${batteryResult.alreadyCorrect} already correct, ${batteryResult.batteryAttributeChanges} attribute change(s), ` +
    `${batteryResult.dateExpiredCount} date-expired, ${batteryResult.failedLoadTestCount} failed-load-test`
);

console.log('\nOK — fake-report fixtures flow through the real adapter + classify + battery-engine pipeline without error.');
