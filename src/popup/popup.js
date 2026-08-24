import { buildBatteryRepairChange } from '../cleanup/repair-battery.js';

const statusText = document.getElementById('statusText');
const profileSelect = document.getElementById('profileSelect');
const profileActive = document.getElementById('profileActive');
const previewBtn = document.getElementById('previewBtn');
const applyBtn = document.getElementById('applyBtn');
const undoBtn = document.getElementById('undoBtn');
const progressSection = document.getElementById('progress');
const progressText = document.getElementById('progressText');
const summarySection = document.getElementById('summary');
const summaryText = document.getElementById('summaryText');
const reviewList = document.getElementById('reviewList');
const reviewSummary = document.getElementById('reviewSummary');
const examplesList = document.getElementById('examplesList');
const diagnostics = document.getElementById('diagnostics');
const diagnosticsText = document.getElementById('diagnosticsText');
const confirmBar = document.getElementById('confirmBar');
const confirmText = document.getElementById('confirmText');
const confirmYes = document.getElementById('confirmYes');
const confirmNo = document.getElementById('confirmNo');
const resumeBar = document.getElementById('resumeBar');
const resumeText = document.getElementById('resumeText');
const resumeBtn = document.getElementById('resumeBtn');
const discardBtn = document.getElementById('discardBtn');
const pauseBtn = document.getElementById('pauseBtn');
const cancelRemainingBtn = document.getElementById('cancelRemainingBtn');

const batteryProgressSection = document.getElementById('batteryProgress');
const batteryProgressText = document.getElementById('batteryProgressText');
const batterySummarySection = document.getElementById('batterySummary');
const batterySummaryText = document.getElementById('batterySummaryText');
const batteryReviewList = document.getElementById('batteryReviewList');
const batteryReviewSummary = document.getElementById('batteryReviewSummary');
const batteryExamplesList = document.getElementById('batteryExamplesList');
const batteryOutcomeList = document.getElementById('batteryOutcomeList');
const batteryOutcomeSummary = document.getElementById('batteryOutcomeSummary');
const batteryFieldCountsList = document.getElementById('batteryFieldCountsList');
const batteryResumeBar = document.getElementById('batteryResumeBar');
const batteryResumeText = document.getElementById('batteryResumeText');
const batteryResumeBtn = document.getElementById('batteryResumeBtn');
const batteryDiscardBtn = document.getElementById('batteryDiscardBtn');
const batteryPauseBtn = document.getElementById('batteryPauseBtn');
const batteryCancelRemainingBtn = document.getElementById('batteryCancelRemainingBtn');

const repairStartBtn = document.getElementById('repairStartBtn');
const repairUndoBtn = document.getElementById('repairUndoBtn');
const repairResumeBar = document.getElementById('repairResumeBar');
const repairResumeText = document.getElementById('repairResumeText');
const repairResumeBtn = document.getElementById('repairResumeBtn');
const repairDiscardBtn = document.getElementById('repairDiscardBtn');
const repairProgressSection = document.getElementById('repairProgress');
const repairProgressText = document.getElementById('repairProgressText');
const repairPauseBtn = document.getElementById('repairPauseBtn');
const repairCancelRemainingBtn = document.getElementById('repairCancelRemainingBtn');
const repairWizardSection = document.getElementById('repairWizard');
const repairWizardProgress = document.getElementById('repairWizardProgress');
const repairDeviceInfo = document.getElementById('repairDeviceInfo');
const repairYesNoBar = document.getElementById('repairYesNoBar');
const repairYesBtn = document.getElementById('repairYesBtn');
const repairNoBtn = document.getElementById('repairNoBtn');
const repairStopBtn = document.getElementById('repairStopBtn');
const repairBatteryForm = document.getElementById('repairBatteryForm');
const repairAmpsInput = document.getElementById('repairAmpsInput');
const repairDateInput = document.getElementById('repairDateInput');
const repairTechInput = document.getElementById('repairTechInput');
const repairCompanyInput = document.getElementById('repairCompanyInput');
const repairFormErrors = document.getElementById('repairFormErrors');
const repairSaveContinueBtn = document.getElementById('repairSaveContinueBtn');
const repairCancelDeviceBtn = document.getElementById('repairCancelDeviceBtn');
const repairSummarySection = document.getElementById('repairSummary');
const repairSummaryText = document.getElementById('repairSummaryText');
const repairReviewSummary = document.getElementById('repairReviewSummary');
const repairReviewList = document.getElementById('repairReviewList');
const repairPendingSummary = document.getElementById('repairPendingSummary');
const repairPendingList = document.getElementById('repairPendingList');
const repairApplyBtn = document.getElementById('repairApplyBtn');
const repairCancelAllBtn = document.getElementById('repairCancelAllBtn');
const repairResultSection = document.getElementById('repairResult');
const repairResultText = document.getElementById('repairResultText');

let activeTabId = null;
let lastPreview = null; // { meta, summary }
let lastBatteryPreview = null; // { meta, summary }
let busy = false;

// Repair/Fixed wizard state - see the repairStartBtn handler onward.
let repairQueue = []; // failedDevices from the 'repairScan' message
let repairIndex = 0;
let repairPendingItems = []; // { scannumber, devicetype, writeValue, priorValue, summary } ready to apply
let repairReviewOnlyDevices = []; // { scannumber, devicetype, service } - answered "yes", no rule exists yet

const PROFILE_LABELS = {
  annual: 'Annual',
  'semi-annual': 'Semi-Annual',
};

// Every write (Service or Battery, Apply or Undo) now runs through the
// shared paced write-queue coordinator in background.js - see
// docs/architecture.md "Throttled write queue". These labels are shown in
// the paused/resume banners so it's clear which run is being resumed.
const OPERATION_KIND_LABELS = {
  serviceApply: 'Service Cleanup Apply',
  serviceUndo: 'Service Cleanup Undo',
  batteryApply: 'Battery Cleanup Apply',
  batteryUndo: 'Battery Cleanup Undo',
  repairApply: 'Repair/Fixed Apply',
  repairUndo: 'Repair/Fixed Undo',
};

const SERVICE_KINDS = ['serviceApply', 'serviceUndo'];
const BATTERY_KINDS = ['batteryApply', 'batteryUndo'];
const REPAIR_KINDS = ['repairApply', 'repairUndo'];

// Large-operation notice threshold for Preview - see docs/architecture.md:
// Preview should warn before a big paced run, not just silently take a
// while. Not a hard limit, just when to show the extra explanation.
const LARGE_OPERATION_THRESHOLD = 10;

// Labels for the extra fields Communicator/Communication Line/Monitoring
// safeChanges can carry alongside Service (see communications-parser.js) -
// shown in the Preview examples list under the Service before/after.
const SERVICE_EXTRA_FIELD_LABELS = {
  restoreTime: 'Restore Time',
  confirmedTime: 'Confirmed Time',
  restorable: 'Restorable',
  comment: 'Comment',
  solution: 'Solution',
  note: 'Note',
};

const BUCKET_LABELS = {
  safeChange: 'Safe to change',
  alreadyCorrect: 'Already correct',
  blank: 'Blank',
  ambiguousConflict: 'Ambiguous / conflicting',
  unsupportedDeviceType: 'Unrecognized device type',
  customPreserved: 'Custom entries preserved',
  unsupportedField: 'Unsupported field format',
  needsReview: 'Needs review',
};

const BATTERY_BUCKET_LABELS = {
  alreadyCorrect: 'Already correct',
  safeFormatting: 'Safe formatting change',
  postTestGenerated: 'Post Test value generated (was blank)',
  minAhRecalculation: 'Min Ah recalculation',
  modelNumberCorrection: 'Model Number correction',
  preTestWillBeCleared: 'Pre Test will be cleared',
  missingRequiredValue: 'Missing required value',
  invalidNumericValue: 'Invalid numeric value',
  suspiciousReading: 'Suspicious reading',
  unsupportedBatteryRecord: 'Not a Battery device',
  updateOrSaveFailure: 'Update or save failure',
  outcomePassed: 'Passed',
  outcomeDateExpired: 'Failed — Date Expired',
  outcomeFailedLoadTest: 'Failed — Failed Load Test',
  outcomeDateExpiredAndFailedLoadTest: 'Failed — Date Expired/Failed Load Test',
  outcomeRequiresReview: 'Pass/Fail outcome requires review',
};

const BATTERY_FIELD_LABELS = {
  ratedVoltage: 'Rated Voltage',
  amps: 'Amps',
  preTest: 'Pre Test',
  postTest: 'Post Test',
  minAh: 'Min Ah',
  testedAh: 'Tested Ah',
  modelNumber: 'Model Number',
  passed: 'Passed',
  service: 'Service',
  comment: 'Comment',
  solution: 'Solution',
  note: 'Note',
  outcome: 'Pass/Fail outcome',
};

const BATTERY_COUNT_LABELS = {
  ratedVoltageFormattingChanges: 'Rated Voltage formatting changes',
  ampsFormattingChanges: 'Amps formatting changes',
  preTestCleared: 'Pre Test fields to clear',
  postTestFormattingChanges: 'Post Test formatting changes',
  postTestGenerated: 'Post Test values generated (was blank)',
  minAhCorrections: 'Min Ah corrections',
  testedAhFormattingChanges: 'Tested Ah formatting changes',
  modelNumberCorrections: 'Model Number corrections',
  passedCheckboxChanges: 'Passed checkbox changes',
  serviceChanges: 'Service changes',
  commentChanges: 'Comment changes',
  solutionChanges: 'Solution changes',
  noteChanges: 'Note changes',
};

// Keeps the selected Inspection Profile visibly labeled at all times, not
// just as the <select>'s current value - so it's unmistakable which
// profile's rules Preview/Apply are about to use before either is clicked.
function updateProfileActiveLabel() {
  const label = profileSelect.options[profileSelect.selectedIndex].text;
  profileActive.textContent = `Active profile: ${label}`;
}

profileSelect.addEventListener('change', updateProfileActiveLabel);
updateProfileActiveLabel();

// Battery Cleanup is no longer a separate button - Preview/Apply run both
// Service and Battery Cleanup together (see previewBtn/applyBtn handlers
// below), so Apply is enabled whenever EITHER side has a pending change,
// not just Service.
function hasServicePending() {
  return !!(lastPreview && lastPreview.summary && lastPreview.summary.totalWouldChange > 0);
}
function hasBatteryPending() {
  return !!(lastBatteryPreview && lastBatteryPreview.summary && lastBatteryPreview.summary.totalDevicesAffected > 0);
}

function setBusy(isBusy) {
  busy = isBusy;
  previewBtn.disabled = isBusy || !activeTabId;
  applyBtn.disabled = isBusy || !(hasServicePending() || hasBatteryPending());
  undoBtn.disabled = isBusy || !activeTabId;
  repairStartBtn.disabled = isBusy || !activeTabId;
  repairUndoBtn.disabled = isBusy || !activeTabId;
}

// Turns a background.js `progress` summary (see write-queue.js's
// summarize()) into the compact status lines docs/architecture.md calls
// for: "Saving device N of M" / "Waiting before next BuildingReports save" /
// "Paused because BuildingReports is limiting requests".
function formatProgressText(progress) {
  if (!progress) return '';
  const { completed, total, remaining, paused, gaveUp } = progress;
  if (gaveUp) {
    return `Paused because BuildingReports is limiting requests (${completed}/${total} done) - click Resume when ready.`;
  }
  if (paused) {
    return `Paused because BuildingReports is limiting requests - retrying automatically (${completed}/${total} done)...`;
  }
  if (remaining === 0) {
    return `Done - ${completed}/${total} saved.`;
  }
  return `Saving device ${completed + 1} of ${total}...`;
}

// Polls 'operationStatus' for `kind` every second while a long paced Apply/
// Undo call is in flight (the call itself only resolves once the whole run
// finishes/pauses/cancels - background.js persists progress to
// chrome.storage.local after every single item, so this is how the popup
// shows it live instead of just a static spinner). Returns a stop function.
function startProgressPolling(kind, render) {
  let stopped = false;
  async function tick() {
    if (stopped) return;
    const status = await sendMessage({ type: 'operationStatus', kind });
    if (!stopped && status && status.active) {
      render(formatProgressText(status.progress));
    }
  }
  const interval = setInterval(tick, 1000);
  tick();
  return () => {
    stopped = true;
    clearInterval(interval);
  };
}

let stopServiceProgressPolling = null;
let stopBatteryProgressPolling = null;
let currentServiceOperationKind = null;
let currentBatteryOperationKind = null;

function showProgress(text, kind) {
  progressSection.classList.remove('hidden');
  progressText.textContent = text;
  currentServiceOperationKind = kind || null;
  pauseBtn.classList.toggle('hidden', !kind);
  cancelRemainingBtn.classList.toggle('hidden', !kind);
  if (kind) {
    if (stopServiceProgressPolling) stopServiceProgressPolling();
    stopServiceProgressPolling = startProgressPolling(kind, (t) => {
      progressText.textContent = t;
    });
  }
}

function hideProgress() {
  progressSection.classList.add('hidden');
  if (stopServiceProgressPolling) {
    stopServiceProgressPolling();
    stopServiceProgressPolling = null;
  }
  currentServiceOperationKind = null;
}

function showBatteryProgress(text, kind) {
  batteryProgressSection.classList.remove('hidden');
  batteryProgressText.textContent = text;
  currentBatteryOperationKind = kind || null;
  batteryPauseBtn.classList.toggle('hidden', !kind);
  batteryCancelRemainingBtn.classList.toggle('hidden', !kind);
  if (kind) {
    if (stopBatteryProgressPolling) stopBatteryProgressPolling();
    stopBatteryProgressPolling = startProgressPolling(kind, (t) => {
      batteryProgressText.textContent = t;
    });
  }
}

function hideBatteryProgress() {
  batteryProgressSection.classList.add('hidden');
  if (stopBatteryProgressPolling) {
    stopBatteryProgressPolling();
    stopBatteryProgressPolling = null;
  }
  currentBatteryOperationKind = null;
}

let stopRepairProgressPolling = null;
let currentRepairOperationKind = null;

function showRepairProgress(text, kind) {
  repairProgressSection.classList.remove('hidden');
  repairProgressText.textContent = text;
  currentRepairOperationKind = kind || null;
  repairPauseBtn.classList.toggle('hidden', !kind);
  repairCancelRemainingBtn.classList.toggle('hidden', !kind);
  if (kind) {
    if (stopRepairProgressPolling) stopRepairProgressPolling();
    stopRepairProgressPolling = startProgressPolling(kind, (t) => {
      repairProgressText.textContent = t;
    });
  }
}

function hideRepairProgress() {
  repairProgressSection.classList.add('hidden');
  if (stopRepairProgressPolling) {
    stopRepairProgressPolling();
    stopRepairProgressPolling = null;
  }
  currentRepairOperationKind = null;
}

pauseBtn.addEventListener('click', () => {
  if (currentServiceOperationKind) sendMessage({ type: 'pauseOperation', kind: currentServiceOperationKind });
});
cancelRemainingBtn.addEventListener('click', () => {
  if (currentServiceOperationKind) sendMessage({ type: 'cancelOperation', kind: currentServiceOperationKind });
});
batteryPauseBtn.addEventListener('click', () => {
  if (currentBatteryOperationKind) sendMessage({ type: 'pauseOperation', kind: currentBatteryOperationKind });
});
batteryCancelRemainingBtn.addEventListener('click', () => {
  if (currentBatteryOperationKind) sendMessage({ type: 'cancelOperation', kind: currentBatteryOperationKind });
});
repairPauseBtn.addEventListener('click', () => {
  if (currentRepairOperationKind) sendMessage({ type: 'pauseOperation', kind: currentRepairOperationKind });
});
repairCancelRemainingBtn.addEventListener('click', () => {
  if (currentRepairOperationKind) sendMessage({ type: 'cancelOperation', kind: currentRepairOperationKind });
});

// Checks all six operation kinds for a paused/interrupted run on this
// report (e.g. the popup was closed mid-Apply, or a rate-limit give-up
// happened) and shows the appropriate Resume banner - Service, Battery, and
// Repair/Fixed each have their own bar since they're fully independent
// actions.
const RESUME_GROUPS = [
  { kinds: SERVICE_KINDS, bar: resumeBar, textEl: resumeText },
  { kinds: BATTERY_KINDS, bar: batteryResumeBar, textEl: batteryResumeText },
  { kinds: REPAIR_KINDS, bar: repairResumeBar, textEl: repairResumeText },
];

async function checkForResumableOperations() {
  for (const group of RESUME_GROUPS) {
    for (const kind of group.kinds) {
      const status = await sendMessage({ type: 'operationStatus', kind });
      if (status && status.active) {
        showResumeBanner(group.bar, group.textEl, kind, status.progress);
        break;
      }
    }
  }
}

function showResumeBanner(bar, textEl, kind, progress) {
  bar.dataset.kind = kind;
  textEl.textContent =
    `${OPERATION_KIND_LABELS[kind]} was interrupted - ${progress.completed}/${progress.total} done, ` +
    `${progress.remaining} remaining. Resume to continue with the same paced queue, or Cancel Remaining ` +
    `to keep what's already saved and stop here.`;
  bar.classList.remove('hidden');
}

function showDiagnostics(obj) {
  diagnostics.classList.remove('hidden');
  diagnosticsText.textContent = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
}

async function sendMessage(message) {
  return chrome.runtime.sendMessage({ ...message, tabId: activeTabId });
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    statusText.textContent = 'No active tab.';
    statusText.className = 'error';
    return;
  }
  activeTabId = tab.id;
  statusText.textContent = 'Looking for a BuildingReports Device Editor...';
  const result = await sendMessage({ type: 'detect' });
  if (!result || !result.found) {
    statusText.textContent = 'No BuildingReports Device Editor found on this tab. Open a report’s Device Editor and reopen this popup.';
    statusText.className = 'error';
    setBusy(false);
    previewBtn.disabled = true;
    undoBtn.disabled = true;
    repairStartBtn.disabled = true;
    repairUndoBtn.disabled = true;
    return;
  }
  const modifyNote = result.canModify ? '' : ' (no modify permission detected)';
  statusText.textContent = `${result.buildingName || 'Unknown building'} — Building ID ${result.buildingId} — Inspection ${result.inspectionId} — ${result.deviceCount} devices${modifyNote}`;
  statusText.className = 'ok';
  setBusy(false);
  await checkForResumableOperations();
}

// Shared by both the Service and Battery Resume/Discard banners - `bar`'s
// `data-kind` was set by showResumeBanner when it appeared.
async function runResumedOperation(bar, progressShower, progressHider, summarySection2, onResult) {
  const kind = bar.dataset.kind;
  bar.classList.add('hidden');
  setBusy(true);
  progressShower(`Resuming ${OPERATION_KIND_LABELS[kind]}...`, kind);
  diagnostics.classList.add('hidden');
  try {
    const result = await sendMessage({ type: 'resumeOperation', kind });
    progressHider();
    if (!result || !result.ok) {
      statusText.textContent = `Resume failed: ${(result && result.error) || 'unknown error'}`;
      statusText.className = 'error';
      showDiagnostics(result);
      setBusy(false);
      return;
    }
    onResult(result);
    if (result.failed.length) showDiagnostics(result.failed);
  } catch (err) {
    progressHider();
    showDiagnostics(String(err));
  }
  setBusy(false);
}

resumeBtn.addEventListener('click', () =>
  runResumedOperation(resumeBar, showProgress, hideProgress, summarySection, (result) => {
    summarySection.classList.remove('hidden');
    summaryText.innerHTML = [
      `Applied/Restored: ${result.applied.length}`,
      `Failed: ${result.failed.length}`,
      result.gaveUp ? 'Paused again - BuildingReports is still limiting requests. Resume again later.' : '',
    ]
      .filter(Boolean)
      .map((l) => `<div>${l}</div>`)
      .join('');
  })
);

discardBtn.addEventListener('click', async () => {
  const kind = resumeBar.dataset.kind;
  resumeBar.classList.add('hidden');
  await sendMessage({ type: 'discardOperation', kind });
});

batteryResumeBtn.addEventListener('click', () =>
  runResumedOperation(batteryResumeBar, showBatteryProgress, hideBatteryProgress, batterySummarySection, (result) => {
    batterySummarySection.classList.remove('hidden');
    batterySummaryText.innerHTML = [
      `Applied/Restored: ${result.applied.length}`,
      `Failed: ${result.failed.length}`,
      result.gaveUp ? 'Paused again - BuildingReports is still limiting requests. Resume again later.' : '',
    ]
      .filter(Boolean)
      .map((l) => `<div>${l}</div>`)
      .join('');
  })
);

batteryDiscardBtn.addEventListener('click', async () => {
  const kind = batteryResumeBar.dataset.kind;
  batteryResumeBar.classList.add('hidden');
  await sendMessage({ type: 'discardOperation', kind });
});

repairResumeBtn.addEventListener('click', () =>
  runResumedOperation(repairResumeBar, showRepairProgress, hideRepairProgress, repairResultSection, (result) => {
    repairResultSection.classList.remove('hidden');
    repairResultText.innerHTML = [
      `Applied/Restored: ${result.applied.length}`,
      `Failed: ${result.failed.length}`,
      result.gaveUp ? 'Paused again - BuildingReports is still limiting requests. Resume again later.' : '',
    ]
      .filter(Boolean)
      .map((l) => `<div>${l}</div>`)
      .join('');
  })
);

repairDiscardBtn.addEventListener('click', async () => {
  const kind = repairResumeBar.dataset.kind;
  repairResumeBar.classList.add('hidden');
  await sendMessage({ type: 'discardOperation', kind });
});

function renderSummary(summary) {
  summarySection.classList.remove('hidden');
  const lines = [
    `Profile: ${PROFILE_LABELS[summary.profileKey] || summary.profileKey}`,
    `Total devices: ${summary.totalDevices}`,
    `Total fields that would change: ${summary.totalWouldChange}`,
    `Passed normalized: ${summary.passedNormalized}`,
    `Failed normalized: ${summary.failedNormalized}`,
  ];
  if (summary.totalWouldChange > LARGE_OPERATION_THRESHOLD) {
    lines.push(
      `${summary.totalWouldChange} devices require updates. BuildingReports saves each device ` +
        `separately, so changes will be applied through a paced queue (one save at a time) rather ` +
        `than all at once - this may take a while for a large report.`
    );
  }
  summaryText.innerHTML = lines.map((l) => `<div>${l}</div>`).join('') +
    '<div style="margin-top:6px;font-weight:600;">By category</div>' +
    Object.entries(summary.counts)
      .map(([bucket, count]) => `<div class="bucket-row"><span>${BUCKET_LABELS[bucket] || bucket}</span><span>${count}</span></div>`)
      .join('');

  const reviewBuckets = new Set([
    'ambiguousConflict',
    'unsupportedDeviceType',
    'unsupportedField',
    'needsReview',
  ]);
  const reviewItems = summary.results.filter((r) => reviewBuckets.has(r.bucket));
  reviewSummary.textContent = `Review list (${reviewItems.length})`;
  reviewList.innerHTML = reviewItems.length
    ? reviewItems
        .map((r) => {
          const base = `<div class="change-item"><strong>#${r.scannumber}</strong> (${r.devicetype}) — ${BUCKET_LABELS[r.bucket]}<br/><span>${escapeHtml(r.before)}</span><br/><em>${escapeHtml(r.reason)}</em>`;
          // Only third-party-service-parser.js ever sets suggestedFix (the
          // abbreviated company name still didn't fit BuildingReports' 31-
          // character limit) - offer an inline editable fix instead of just
          // leaving it for review with no path forward. See
          // handleManualFixClick below and background.js's manualServiceFix.
          const manualFix = r.suggestedFix != null
            ? `<div class="manual-fix">` +
              `<input type="text" class="manual-fix-input" data-scannumber="${r.scannumber}" value="${escapeHtml(r.suggestedFix)}" maxlength="31" />` +
              `<button type="button" class="manual-fix-btn" data-scannumber="${r.scannumber}">Apply This Fix</button>` +
              `<span class="manual-fix-status" data-scannumber-status="${r.scannumber}"></span>` +
              `</div>`
            : '';
          return `${base}${manualFix}</div>`;
        })
        .join('')
    : '<div>Nothing needs review.</div>';

  examplesList.innerHTML = summary.examples.length
    ? summary.examples
        .map((e) => {
          const extra = (e.extraFieldChanges || [])
            .map(
              (fc) =>
                `<div>${SERVICE_EXTRA_FIELD_LABELS[fc.field] || fc.field}: <span class="before">${escapeHtml(fc.before)}</span> → <span class="after">${escapeHtml(fc.after)}</span></div>`
            )
            .join('');
          return `<div class="change-item"><strong>#${e.scannumber}</strong><br/><span class="before">${escapeHtml(e.before)}</span><br/><span class="after">${escapeHtml(e.after)}</span>${extra}</div>`;
        })
        .join('')
    : '<div>No examples.</div>';
}

function renderBatterySummary(summary) {
  batterySummarySection.classList.remove('hidden');
  // Compact headline only - the per-field counts, review list, and
  // before/after detail all move into <details> below so this stays
  // readable as more Battery rules are added (see docs/battery-cleanup-rules.md).
  const lines = [
    `Total Batteries: ${summary.totalBatteryDevicesFound}`,
    `Passing Batteries: ${summary.passingBatteries}`,
    `Date Expired: ${summary.dateExpiredCount}`,
    `Failed Load Test: ${summary.failedLoadTestCount}`,
    `Date Expired and Failed Load Test: ${summary.dateExpiredAndFailedLoadTestCount}`,
    `Failed due to paired Battery: ${summary.pairedFailureCount || 0}`,
    `Outcome Requires Review: ${summary.outcomeRequiresReviewCount}`,
    `Already correct: ${summary.alreadyCorrect}`,
    `Total Batteries affected: ${summary.totalDevicesAffected}`,
    `Total fields affected: ${summary.totalFieldsAffected}`,
  ];
  if (summary.totalDevicesAffected > LARGE_OPERATION_THRESHOLD) {
    lines.push(
      `${summary.totalDevicesAffected} devices require updates. BuildingReports saves each device ` +
        `separately, so changes will be applied through a paced queue (one save at a time) rather ` +
        `than all at once - this may take a while for a large report.`
    );
  }
  batterySummaryText.innerHTML = lines.map((l) => `<div>${l}</div>`).join('');

  const outcomeExamples = summary.outcomeExamples || [];
  batteryOutcomeSummary.textContent = `Pass/Fail outcomes (${outcomeExamples.length})`;
  batteryOutcomeList.innerHTML = outcomeExamples.length
    ? outcomeExamples
        .map(
          (e) =>
            `<div class="change-item"><strong>Battery #${e.scannumber}</strong><br/>` +
            `Install Date: ${escapeHtml(e.installDateDisplay || '(unknown)')}<br/>` +
            `Tested Ah: ${escapeHtml(e.testedAhDisplay || '(unknown)')}<br/>` +
            `Min Ah: ${escapeHtml(e.minAhDisplay || '(unknown)')}<br/>` +
            `Outcome: ${escapeHtml(e.outcomeLabel)}` +
            (e.pairedWithScannumber ? ` (paired with Battery #${escapeHtml(e.pairedWithScannumber)})` : '') +
            `</div>`
        )
        .join('')
    : '<div>No Battery devices found.</div>';

  batteryFieldCountsList.innerHTML =
    `<div class="bucket-row"><span>Battery attribute changes</span><span>${summary.batteryAttributeChanges}</span></div>` +
    Object.entries(summary.counts)
      .map(([key, count]) => `<div class="bucket-row"><span>${BATTERY_COUNT_LABELS[key] || key}</span><span>${count}</span></div>`)
      .join('');

  const reviewItems = summary.reviewItems || [];
  batteryReviewSummary.textContent = `Review list (${reviewItems.length})`;
  batteryReviewList.innerHTML = reviewItems.length
    ? reviewItems
        .map((r) => {
          const flags = r.reviewFlags
            .map(
              (f) =>
                `<div>${BATTERY_FIELD_LABELS[f.field] || f.field}: ${BATTERY_BUCKET_LABELS[f.bucket] || f.bucket} — <span>${escapeHtml(f.before)}</span><br/><em>${escapeHtml(f.reason)}</em></div>`
            )
            .join('');
          return `<div class="change-item"><strong>#${r.scannumber}</strong> (${r.devicetype})${flags}</div>`;
        })
        .join('')
    : '<div>Nothing needs review.</div>';

  batteryExamplesList.innerHTML = summary.examples.length
    ? summary.examples
        .map((e) => {
          const fields = e.changes
            .map(
              (c) =>
                `<div>${BATTERY_FIELD_LABELS[c.field] || c.field}: <span class="before">${escapeHtml(c.before)}</span> → <span class="after">${escapeHtml(c.after)}</span></div>`
            )
            .join('');
          return `<div class="change-item"><strong>#${e.scannumber}</strong>${fields}</div>`;
        })
        .join('')
    : '<div>No examples.</div>';
}

function askConfirmWith(bar, textEl, yesEl, noEl, text, yesLabel) {
  return new Promise((resolve) => {
    textEl.textContent = text;
    yesEl.textContent = yesLabel;
    bar.classList.remove('hidden');

    function cleanup(result) {
      bar.classList.add('hidden');
      yesEl.removeEventListener('click', onYes);
      noEl.removeEventListener('click', onNo);
      resolve(result);
    }
    function onYes() {
      cleanup(true);
    }
    function onNo() {
      cleanup(false);
    }
    yesEl.addEventListener('click', onYes);
    noEl.addEventListener('click', onNo);
  });
}

function askConfirm(text, yesLabel) {
  return askConfirmWith(confirmBar, confirmText, confirmYes, confirmNo, text, yesLabel);
}

// Shared by the combined Apply flow's Service and Battery halves - see
// previewBtn/applyBtn handlers below.
function appendApplyResultBlock(targetEl, result) {
  const extra = [
    `Saved: ${result.applied.length}`,
    `Save failures: ${result.failed.length}`,
    result.undoAvailable ? 'Undo is available for this run.' : 'Nothing to undo (no changes were saved).',
  ];
  if (result.gaveUp) {
    extra.push('Paused - BuildingReports is limiting requests. Reopen the popup and click Resume to continue.');
  } else if (result.cancelled) {
    extra.push('Cancelled - remaining changes were not applied. Already-saved changes remain and are covered by Undo.');
  }
  targetEl.innerHTML += '<div style="margin-top:6px;font-weight:600;">Apply result</div>' + extra.map((l) => `<div>${l}</div>`).join('');
  if (result.failed.length) showDiagnostics(result.failed);
}

// A fresh Apply/Undo is refused if a checkpoint of the same kind is already
// sitting paused in storage (background.js's runNewOperation guard - see
// docs/architecture.md). Pure check (no side effects) so the combined
// Apply/Undo flow can test both the Service and Battery half without one
// call's statusText clobbering the other's - see the applyBtn/undoBtn
// handlers below for how the combined error message and
// checkForResumableOperations() refresh are built from this.
function isAlreadyPausedError(result) {
  return !!(result && result.error === 'operation-already-paused');
}

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

// Handles "Apply This Fix" clicks for third-party-service-parser.js's rare
// needs-manual-fix case (abbreviated company name still didn't fit
// BuildingReports' 31-character limit - see renderSummary's manualFix
// template above and background.js's manualServiceFix handler). Delegated
// on the container since review items are re-rendered wholesale on every
// Preview/fix rather than individually.
reviewList.addEventListener('click', async (event) => {
  const btn = event.target.closest('.manual-fix-btn');
  if (!btn) return;
  const sn = btn.dataset.scannumber;
  const input = reviewList.querySelector(`.manual-fix-input[data-scannumber="${sn}"]`);
  const statusEl = reviewList.querySelector(`[data-scannumber-status="${sn}"]`);
  const value = input.value.trim();
  if (!value) {
    statusEl.textContent = 'Enter a value.';
    return;
  }
  if (value.length > 31) {
    statusEl.textContent = 'Too long (max 31 characters).';
    return;
  }
  setBusy(true);
  btn.disabled = true;
  statusEl.textContent = 'Saving...';
  try {
    const result = await sendMessage({ type: 'manualServiceFix', scannumber: sn, newValue: value });
    if (result && result.ok) {
      statusEl.textContent = 'Saved - refreshing...';
      const refreshed = await sendMessage({ type: 'preview', profileKey: profileSelect.value });
      if (refreshed && refreshed.found) {
        lastPreview = refreshed;
        renderSummary(refreshed.summary);
      }
    } else {
      statusEl.textContent = `Failed: ${(result && result.error) || 'unknown error'}`;
      btn.disabled = false;
    }
  } catch (err) {
    statusEl.textContent = `Failed: ${String(err)}`;
    btn.disabled = false;
  }
  setBusy(false);
});

// Preview now runs Service Cleanup and Battery Cleanup back to back on
// every click - Battery Cleanup is no longer a separate button (see
// docs/battery-cleanup-rules.md / docs/cleanup-rules.md: it's universal and
// applies identically regardless of which Inspection Profile is selected).
// Sequential (not parallel) so only one progress line is visible at a time;
// both are read-only, so an error on one side doesn't need to block the
// other.
previewBtn.addEventListener('click', async () => {
  setBusy(true);
  diagnostics.classList.add('hidden');
  try {
    showProgress('Scanning entire report for Service Cleanup (this does not modify anything)...');
    const result = await sendMessage({ type: 'preview', profileKey: profileSelect.value });
    hideProgress();
    if (!result || !result.found) {
      statusText.textContent = 'Report no longer found on this tab.';
      statusText.className = 'error';
      setBusy(false);
      return;
    }
    lastPreview = result;
    renderSummary(result.summary);

    showBatteryProgress('Scanning entire report for Battery devices (this does not modify anything)...');
    const batteryResult = await sendMessage({ type: 'batteryPreview' });
    hideBatteryProgress();
    if (batteryResult && batteryResult.found) {
      lastBatteryPreview = batteryResult;
      renderBatterySummary(batteryResult.summary);
    }
  } catch (err) {
    hideProgress();
    hideBatteryProgress();
    showDiagnostics(String(err));
  }
  setBusy(false);
});

// Apply, likewise, writes Service Cleanup's safe changes and then Battery
// Cleanup's - two separate paced-queue runs under two separate checkpoint
// kinds (serviceApply/batteryApply, each with its own Undo history, exactly
// as before - see CLAUDE.md "The shared paced write queue"), just triggered
// by one click and one confirmation instead of two. Battery still runs even
// if the Service half hit a rate-limit give-up or an already-paused
// checkpoint - they're fully independent write paths, and blocking Battery
// on an unrelated Service pause would be a new, unwanted coupling.
applyBtn.addEventListener('click', async () => {
  const serviceN = hasServicePending() ? lastPreview.summary.totalWouldChange : 0;
  const batteryDevices = hasBatteryPending() ? lastBatteryPreview.summary.totalDevicesAffected : 0;
  const batteryFields = hasBatteryPending() ? lastBatteryPreview.summary.totalFieldsAffected : 0;
  if (serviceN === 0 && batteryDevices === 0) return;

  const profileLabel = profileSelect.options[profileSelect.selectedIndex].text;
  const parts = [];
  if (serviceN > 0) parts.push(`${serviceN} Service field(s) under the "${profileLabel}" profile`);
  if (batteryDevices > 0) parts.push(`${batteryDevices} Battery device(s) (${batteryFields} field(s) total)`);
  const pacedNote =
    serviceN + batteryDevices > LARGE_OPERATION_THRESHOLD
      ? ' BuildingReports saves each device separately, so this will run through a paced queue (one at a time) and may take a while.'
      : '';
  const confirmed = await askConfirm(
    `Apply cleanup to ${parts.join(' and ')}? Only entries classified as safe to change will be touched.${pacedNote}`,
    'Apply'
  );
  if (!confirmed) return;

  setBusy(true);
  diagnostics.classList.add('hidden');
  let anyAlreadyPaused = false;
  const errorMessages = [];
  try {
    if (serviceN > 0) {
      showProgress(`Applying ${serviceN} Service change(s) and verifying saves...`, 'serviceApply');
      const serviceResult = await sendMessage({ type: 'apply', profileKey: profileSelect.value });
      hideProgress();
      if (serviceResult && serviceResult.ok) {
        renderSummary(serviceResult.summary);
        appendApplyResultBlock(summaryText, serviceResult);
      } else if (isAlreadyPausedError(serviceResult)) {
        anyAlreadyPaused = true;
      } else {
        errorMessages.push(`Service Apply failed: ${(serviceResult && serviceResult.error) || 'unknown error'}`);
        showDiagnostics(serviceResult);
      }
    }

    if (batteryDevices > 0) {
      showBatteryProgress(`Applying changes to ${batteryDevices} Battery device(s) and verifying saves...`, 'batteryApply');
      const batteryResult = await sendMessage({ type: 'batteryApply' });
      hideBatteryProgress();
      if (batteryResult && batteryResult.ok) {
        renderBatterySummary(batteryResult.summary);
        appendApplyResultBlock(batterySummaryText, batteryResult);
      } else if (isAlreadyPausedError(batteryResult)) {
        anyAlreadyPaused = true;
      } else {
        errorMessages.push(`Battery Apply failed: ${(batteryResult && batteryResult.error) || 'unknown error'}`);
        showDiagnostics(batteryResult);
      }
    }

    if (anyAlreadyPaused) {
      await checkForResumableOperations();
      errorMessages.unshift('A previous run is still paused - use Resume or Cancel Remaining above before starting a new one.');
    }
    if (errorMessages.length > 0) {
      statusText.textContent = errorMessages.join(' ');
      statusText.className = 'error';
    }
  } catch (err) {
    hideProgress();
    hideBatteryProgress();
    showDiagnostics(String(err));
  }
  setBusy(false);
});

// Undo restores both Service and Battery Cleanup's last accumulated Undo
// history in one click (each through its own checkpoint kind/history, same
// as Apply above). Fetches real entry counts from storage first and shows
// them in the confirmation - CLAUDE.md's "Definition of done" calls out
// checking chrome.storage.local's entry count before clicking Undo (a past
// incident silently merged 104 leftover entries into a 3-item run); this
// makes that check automatic instead of a manual step during live testing.
undoBtn.addEventListener('click', async () => {
  setBusy(true);
  const status = await sendMessage({ type: 'undoStatus' });
  setBusy(false);
  if (!status || !status.found) {
    statusText.textContent = 'Report no longer found on this tab.';
    statusText.className = 'error';
    return;
  }
  const serviceCount = status.serviceEntries || 0;
  const batteryCount = status.batteryEntries || 0;
  if (serviceCount === 0 && batteryCount === 0) {
    statusText.textContent = 'Nothing to undo.';
    statusText.className = 'ok';
    return;
  }
  const parts = [];
  if (serviceCount > 0) parts.push(`${serviceCount} Service field(s)`);
  if (batteryCount > 0) parts.push(`${batteryCount} Battery field(s)`);
  const confirmed = await askConfirm(
    `Undo the last cleanup run on this report? This restores ${parts.join(' and ')} to their prior values.`,
    'Undo'
  );
  if (!confirmed) return;

  setBusy(true);
  diagnostics.classList.add('hidden');
  let anyAlreadyPaused = false;
  const errorMessages = [];
  try {
    if (serviceCount > 0) {
      showProgress('Restoring previous Service values...', 'serviceUndo');
      const serviceResult = await sendMessage({ type: 'undo' });
      hideProgress();
      if (serviceResult && serviceResult.ok) {
        renderUndoResultBlock(summarySection, summaryText, reviewList, examplesList, serviceResult);
      } else if (isAlreadyPausedError(serviceResult)) {
        anyAlreadyPaused = true;
      } else if (serviceResult && serviceResult.error !== 'nothing-to-undo') {
        errorMessages.push(`Service Undo failed: ${(serviceResult && serviceResult.error) || 'unknown error'}`);
      }
    }

    if (batteryCount > 0) {
      showBatteryProgress('Restoring previous Battery values...', 'batteryUndo');
      const batteryResult = await sendMessage({ type: 'batteryUndo' });
      hideBatteryProgress();
      if (batteryResult && batteryResult.ok) {
        renderUndoResultBlock(batterySummarySection, batterySummaryText, batteryReviewList, batteryExamplesList, batteryResult);
      } else if (isAlreadyPausedError(batteryResult)) {
        anyAlreadyPaused = true;
      } else if (batteryResult && batteryResult.error !== 'nothing-to-undo') {
        errorMessages.push(`Battery Undo failed: ${(batteryResult && batteryResult.error) || 'unknown error'}`);
      }
    }

    if (anyAlreadyPaused) {
      await checkForResumableOperations();
      errorMessages.unshift('A previous run is still paused - use Resume or Cancel Remaining above before starting a new one.');
    }
    if (errorMessages.length > 0) {
      statusText.textContent = errorMessages.join(' ');
      statusText.className = 'error';
    }
  } catch (err) {
    hideProgress();
    hideBatteryProgress();
    showDiagnostics(String(err));
  }
  setBusy(false);
});

function renderUndoResultBlock(sectionEl, textEl, reviewListEl, examplesListEl, result) {
  sectionEl.classList.remove('hidden');
  const lines = [
    `Restored: ${result.restored.length}`,
    `Failed: ${result.failed.length}`,
    `Total tracked: ${result.total}`,
  ];
  if (result.gaveUp) {
    lines.push('Paused - BuildingReports is limiting requests. Reopen the popup and click Resume to continue undoing.');
  } else if (result.cancelled) {
    lines.push('Cancelled - remaining entries were left tracked for a later Undo.');
  }
  textEl.innerHTML = lines.map((l) => `<div>${l}</div>`).join('');
  reviewListEl.innerHTML = '';
  examplesListEl.innerHTML = '';
  if (result.failed.length) showDiagnostics(result.failed);
}

// ============================================================
// Repaired / Fixed - a human-driven, device-by-device walkthrough.
// Architecturally unlike Preview/Apply/Undo above: nothing here is
// auto-classified. Only devices currently marked Failed are walked (see
// repair-engine.js's scanFailedDevices, run in background.js), one at a
// time, in report order. Every device gets a "was this repaired?"
// question; a device type with a rule (only Battery for now - see
// repair-battery.js) gets a short form on "yes", built into a write item
// immediately via buildBatteryRepairChange (imported above - pure logic,
// no chrome.* dependency, safe to run right here in the popup). A device
// type with no rule yet is flagged for manual review instead, per
// docs/repair-fixed-rules.md. Nothing is written to BuildingReports until
// "Apply Repairs" is clicked at the end, going through the same paced
// write queue/checkpoint/Undo machinery as every other write path
// (checkpoint kinds 'repairApply'/'repairUndo', own Undo history, kept
// separate from Battery Cleanup's even though both can touch the same
// Battery fields - see background.js).
// ============================================================

// Local "today" as a "YYYY-MM-DD" string, matching this extension's own
// date convention (see adapter.js's toLocalDateOnlyString) - built from
// local wall-clock components, never toISOString() (which is UTC and can
// shift the calendar day near local midnight). Only used as an editable
// default for the Date input - never invented data, just a starting point
// most repairs are logged the same day.
function todayLocalIsoDate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function showRepairDevice() {
  if (repairIndex >= repairQueue.length) {
    finishRepairWalkthrough();
    return;
  }
  const device = repairQueue[repairIndex];
  repairSummarySection.classList.add('hidden');
  repairWizardSection.classList.remove('hidden');
  repairBatteryForm.classList.add('hidden');
  repairYesNoBar.classList.remove('hidden');
  repairFormErrors.textContent = '';
  repairWizardProgress.textContent = `Device ${repairIndex + 1} of ${repairQueue.length}`;
  repairDeviceInfo.innerHTML =
    `<strong>#${escapeHtml(device.scannumber)}</strong> (${escapeHtml(device.devicetype)})<br/>` +
    `Service: ${escapeHtml(device.service || '(blank)')}`;
}

function finishRepairWalkthrough() {
  repairWizardSection.classList.add('hidden');
  repairSummarySection.classList.remove('hidden');
  const remaining = Math.max(repairQueue.length - repairIndex, 0);

  const lines = [
    `Repairs ready to apply: ${repairPendingItems.length}`,
    `Devices needing manual review (no rule yet): ${repairReviewOnlyDevices.length}`,
  ];
  if (remaining > 0) {
    lines.push(`${remaining} device(s) not yet asked about (walkthrough stopped early) - click "Start Repair Walkthrough" again to ask about the rest.`);
  }
  repairSummaryText.innerHTML = lines.map((l) => `<div>${l}</div>`).join('');

  repairReviewSummary.textContent = `Needs manual review (no rule yet) (${repairReviewOnlyDevices.length})`;
  repairReviewList.innerHTML = repairReviewOnlyDevices.length
    ? repairReviewOnlyDevices
        .map(
          (d) =>
            `<div class="change-item"><strong>#${escapeHtml(d.scannumber)}</strong> (${escapeHtml(d.devicetype)})<br/>Service: ${escapeHtml(d.service || '(blank)')}</div>`
        )
        .join('')
    : '<div>None.</div>';

  repairPendingSummary.textContent = `Ready to apply (${repairPendingItems.length})`;
  repairPendingList.innerHTML = repairPendingItems.length
    ? repairPendingItems
        .map((it) => {
          const s = it.summary;
          return (
            `<div class="change-item"><strong>#${escapeHtml(it.scannumber)}</strong> (${escapeHtml(it.devicetype)})<br/>` +
            `Amps: ${escapeHtml(s.amps)} &middot; Min Ah: ${escapeHtml(s.minAh)}` +
            (s.modelNumber ? ` &middot; Model Number: ${escapeHtml(s.modelNumber)}` : '') +
            `<br/>${escapeHtml(s.noteLine)}</div>`
          );
        })
        .join('')
    : '<div>None.</div>';

  repairApplyBtn.disabled = repairPendingItems.length === 0;
}

repairStartBtn.addEventListener('click', async () => {
  if (repairPendingItems.length > 0 || repairReviewOnlyDevices.length > 0) {
    const confirmed = await askConfirm(
      'Starting a new walkthrough discards the repairs collected so far (none of them have been written yet). Continue?',
      'Start Over'
    );
    if (!confirmed) return;
  }

  setBusy(true);
  diagnostics.classList.add('hidden');
  repairResultSection.classList.add('hidden');
  repairSummarySection.classList.add('hidden');
  try {
    const result = await sendMessage({ type: 'repairScan' });
    if (!result || !result.found) {
      statusText.textContent = 'Report no longer found on this tab.';
      statusText.className = 'error';
      setBusy(false);
      return;
    }
    repairQueue = result.failedDevices || [];
    repairIndex = 0;
    repairPendingItems = [];
    repairReviewOnlyDevices = [];
    if (repairQueue.length === 0) {
      repairWizardSection.classList.add('hidden');
      repairSummarySection.classList.remove('hidden');
      repairSummaryText.innerHTML = '<div>No devices are currently marked Failed - nothing to walk through.</div>';
      repairReviewSummary.textContent = 'Needs manual review (no rule yet) (0)';
      repairReviewList.innerHTML = '<div>None.</div>';
      repairPendingSummary.textContent = 'Ready to apply (0)';
      repairPendingList.innerHTML = '<div>None.</div>';
      repairApplyBtn.disabled = true;
    } else {
      showRepairDevice();
    }
  } catch (err) {
    showDiagnostics(String(err));
  }
  setBusy(false);
});

repairYesBtn.addEventListener('click', () => {
  const device = repairQueue[repairIndex];
  if (device.ruleKey === 'battery') {
    repairYesNoBar.classList.add('hidden');
    repairBatteryForm.classList.remove('hidden');
    repairFormErrors.textContent = '';
    repairAmpsInput.value = device.record.amps || '';
    repairDateInput.value = todayLocalIsoDate();
    repairTechInput.value = '';
    repairCompanyInput.value = '';
    repairAmpsInput.focus();
  } else {
    // No rule for this device type yet - flag for manual review and move
    // on, per docs/repair-fixed-rules.md ("no-rule-yet devices").
    repairReviewOnlyDevices.push({ scannumber: device.scannumber, devicetype: device.devicetype, service: device.service });
    repairIndex += 1;
    showRepairDevice();
  }
});

repairNoBtn.addEventListener('click', () => {
  repairIndex += 1;
  showRepairDevice();
});

repairStopBtn.addEventListener('click', () => {
  finishRepairWalkthrough();
});

repairSaveContinueBtn.addEventListener('click', () => {
  const device = repairQueue[repairIndex];
  const input = {
    amps: repairAmpsInput.value,
    installDate: repairDateInput.value,
    tech: repairTechInput.value,
    company: repairCompanyInput.value,
  };
  const result = buildBatteryRepairChange(device.record, input);
  if (!result.ok) {
    repairFormErrors.innerHTML = result.errors.map((e) => `<div>${escapeHtml(e)}</div>`).join('');
    return;
  }
  repairPendingItems.push({
    scannumber: device.scannumber,
    devicetype: device.devicetype,
    writeValue: result.writeValue,
    priorValue: result.priorValue,
    summary: result.summary,
  });
  repairIndex += 1;
  showRepairDevice();
});

// Backs out of this device's form without recording anything - same as
// answering "No" to the original Yes/No question.
repairCancelDeviceBtn.addEventListener('click', () => {
  repairIndex += 1;
  showRepairDevice();
});

repairCancelAllBtn.addEventListener('click', () => {
  repairQueue = [];
  repairIndex = 0;
  repairPendingItems = [];
  repairReviewOnlyDevices = [];
  repairSummarySection.classList.add('hidden');
  statusText.textContent = 'Repair walkthrough discarded - nothing was written.';
  statusText.className = 'ok';
});

repairApplyBtn.addEventListener('click', async () => {
  if (repairPendingItems.length === 0) return;
  const n = repairPendingItems.length;
  const pacedNote =
    n > LARGE_OPERATION_THRESHOLD
      ? ' BuildingReports saves each device separately, so this will run through a paced queue (one at a time) and may take a while.'
      : '';
  const confirmed = await askConfirm(`Apply ${n} repair(s) to BuildingReports?${pacedNote}`, 'Apply');
  if (!confirmed) return;

  setBusy(true);
  diagnostics.classList.add('hidden');
  showRepairProgress(`Applying ${n} repair(s) and verifying saves...`, 'repairApply');
  try {
    const items = repairPendingItems.map(({ scannumber, writeValue, priorValue }) => ({ scannumber, writeValue, priorValue }));
    const result = await sendMessage({ type: 'repairApply', items });
    hideRepairProgress();
    if (!result || !result.ok) {
      if (isAlreadyPausedError(result)) {
        await checkForResumableOperations();
        statusText.textContent = 'A previous run is still paused - use Resume or Cancel Remaining above before starting a new one.';
      } else {
        statusText.textContent = `Repair Apply failed: ${(result && result.error) || 'unknown error'}`;
      }
      statusText.className = 'error';
      showDiagnostics(result);
      setBusy(false);
      return;
    }
    repairResultSection.classList.remove('hidden');
    const lines = [
      `Saved: ${result.applied.length}`,
      `Save failures: ${result.failed.length}`,
      result.undoAvailable ? 'Undo is available for this run.' : 'Nothing to undo (no changes were saved).',
    ];
    if (result.gaveUp) {
      lines.push('Paused - BuildingReports is limiting requests. Reopen the popup and click Resume to continue.');
    } else if (result.cancelled) {
      lines.push('Cancelled - remaining changes were not applied. Already-saved changes remain and are covered by Undo.');
    }
    repairResultText.innerHTML = lines.map((l) => `<div>${l}</div>`).join('');
    if (result.failed.length) showDiagnostics(result.failed);
    repairPendingItems = [];
    repairApplyBtn.disabled = true;
  } catch (err) {
    hideRepairProgress();
    showDiagnostics(String(err));
  }
  setBusy(false);
});

repairUndoBtn.addEventListener('click', async () => {
  setBusy(true);
  const status = await sendMessage({ type: 'undoStatus' });
  setBusy(false);
  if (!status || !status.found) {
    statusText.textContent = 'Report no longer found on this tab.';
    statusText.className = 'error';
    return;
  }
  const repairCount = status.repairEntries || 0;
  if (repairCount === 0) {
    statusText.textContent = 'Nothing to undo.';
    statusText.className = 'ok';
    return;
  }
  const confirmed = await askConfirm(
    `Undo the last Repair run on this report? This restores ${repairCount} Battery field(s) to their prior values.`,
    'Undo'
  );
  if (!confirmed) return;

  setBusy(true);
  diagnostics.classList.add('hidden');
  showRepairProgress('Restoring previous values...', 'repairUndo');
  try {
    const result = await sendMessage({ type: 'repairUndo' });
    hideRepairProgress();
    if (!result || !result.ok) {
      if (isAlreadyPausedError(result)) {
        await checkForResumableOperations();
        statusText.textContent = 'A previous run is still paused - use Resume or Cancel Remaining above before starting a new one.';
        statusText.className = 'error';
      } else if (result && result.error !== 'nothing-to-undo') {
        statusText.textContent = `Repair Undo: ${(result && result.error) || 'unknown error'}`;
        statusText.className = 'error';
      }
      setBusy(false);
      return;
    }
    repairResultSection.classList.remove('hidden');
    const lines = [
      `Restored: ${result.restored.length}`,
      `Failed: ${result.failed.length}`,
      `Total tracked: ${result.total}`,
    ];
    if (result.gaveUp) {
      lines.push('Paused - BuildingReports is limiting requests. Reopen the popup and click Resume to continue undoing.');
    } else if (result.cancelled) {
      lines.push('Cancelled - remaining entries were left tracked for a later Undo.');
    }
    repairResultText.innerHTML = lines.map((l) => `<div>${l}</div>`).join('');
    if (result.failed.length) showDiagnostics(result.failed);
  } catch (err) {
    hideRepairProgress();
    showDiagnostics(String(err));
  }
  setBusy(false);
});

init();
