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

const batteryPreviewBtn = document.getElementById('batteryPreviewBtn');
const batteryApplyBtn = document.getElementById('batteryApplyBtn');
const batteryUndoBtn = document.getElementById('batteryUndoBtn');
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
const batteryConfirmBar = document.getElementById('batteryConfirmBar');
const batteryConfirmText = document.getElementById('batteryConfirmText');
const batteryConfirmYes = document.getElementById('batteryConfirmYes');
const batteryConfirmNo = document.getElementById('batteryConfirmNo');
const batteryResumeBar = document.getElementById('batteryResumeBar');
const batteryResumeText = document.getElementById('batteryResumeText');
const batteryResumeBtn = document.getElementById('batteryResumeBtn');
const batteryDiscardBtn = document.getElementById('batteryDiscardBtn');
const batteryPauseBtn = document.getElementById('batteryPauseBtn');
const batteryCancelRemainingBtn = document.getElementById('batteryCancelRemainingBtn');

let activeTabId = null;
let lastPreview = null; // { meta, summary }
let lastBatteryPreview = null; // { meta, summary }
let busy = false;

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
};

const SERVICE_KINDS = ['serviceApply', 'serviceUndo'];
const BATTERY_KINDS = ['batteryApply', 'batteryUndo'];

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

function setBusy(isBusy) {
  busy = isBusy;
  previewBtn.disabled = isBusy || !activeTabId;
  applyBtn.disabled = isBusy || !lastPreview || !lastPreview.summary || lastPreview.summary.totalWouldChange === 0;
  undoBtn.disabled = isBusy || !activeTabId;
  batteryPreviewBtn.disabled = isBusy || !activeTabId;
  batteryApplyBtn.disabled =
    isBusy || !lastBatteryPreview || !lastBatteryPreview.summary || lastBatteryPreview.summary.totalDevicesAffected === 0;
  batteryUndoBtn.disabled = isBusy || !activeTabId;
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

// Checks all four operation kinds for a paused/interrupted run on this
// report (e.g. the popup was closed mid-Apply, or a rate-limit give-up
// happened) and shows the appropriate Resume banner - Service and Battery
// each have their own bar since they're fully independent actions.
async function checkForResumableOperations() {
  for (const kind of SERVICE_KINDS) {
    const status = await sendMessage({ type: 'operationStatus', kind });
    if (status && status.active) {
      showResumeBanner(resumeBar, resumeText, kind, status.progress);
      break;
    }
  }
  for (const kind of BATTERY_KINDS) {
    const status = await sendMessage({ type: 'operationStatus', kind });
    if (status && status.active) {
      showResumeBanner(batteryResumeBar, batteryResumeText, kind, status.progress);
      break;
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

// A fresh Apply/Undo is refused if a checkpoint of the same kind is already
// sitting paused in storage (background.js's runNewOperation guard - see
// docs/architecture.md), so the user doesn't accidentally lose an
// interrupted run by starting a new one. Surface that clearly and refresh
// the Resume banners rather than just showing a generic error.
async function handleOperationAlreadyPaused(result) {
  if (!result || result.error !== 'operation-already-paused') return false;
  statusText.textContent = 'A previous run is still paused - use Resume or Cancel Remaining above before starting a new one.';
  statusText.className = 'error';
  await checkForResumableOperations();
  return true;
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
    batteryPreviewBtn.disabled = true;
    batteryUndoBtn.disabled = true;
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

function askBatteryConfirm(text, yesLabel) {
  return askConfirmWith(batteryConfirmBar, batteryConfirmText, batteryConfirmYes, batteryConfirmNo, text, yesLabel);
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

previewBtn.addEventListener('click', async () => {
  setBusy(true);
  showProgress('Scanning entire report (this does not modify anything)...');
  diagnostics.classList.add('hidden');
  try {
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
  } catch (err) {
    hideProgress();
    showDiagnostics(String(err));
  }
  setBusy(false);
});

applyBtn.addEventListener('click', async () => {
  if (!lastPreview || !lastPreview.summary) return;
  const n = lastPreview.summary.totalWouldChange;
  const profileLabel = profileSelect.options[profileSelect.selectedIndex].text;
  const pacedNote = n > LARGE_OPERATION_THRESHOLD ? ' BuildingReports saves each device separately, so this will run through a paced queue (one at a time) and may take a while.' : '';
  const confirmed = await askConfirm(
    `Apply "${profileLabel}" cleanup to ${n} Service field(s)? Only entries classified as safe to change will be touched.${pacedNote}`,
    'Apply'
  );
  if (!confirmed) return;

  setBusy(true);
  showProgress(`Applying ${n} change(s) and verifying saves...`, 'serviceApply');
  diagnostics.classList.add('hidden');
  try {
    const result = await sendMessage({ type: 'apply', profileKey: profileSelect.value });
    hideProgress();
    if (!result || !result.ok) {
      if (!(await handleOperationAlreadyPaused(result))) {
        statusText.textContent = `Apply failed: ${(result && result.error) || 'unknown error'}`;
        statusText.className = 'error';
        showDiagnostics(result);
      }
      setBusy(false);
      return;
    }
    renderSummary(result.summary);
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
    summaryText.innerHTML += '<div style="margin-top:6px;font-weight:600;">Apply result</div>' + extra.map((l) => `<div>${l}</div>`).join('');
    if (result.failed.length) {
      showDiagnostics(result.failed);
    }
  } catch (err) {
    hideProgress();
    showDiagnostics(String(err));
  }
  setBusy(false);
});

undoBtn.addEventListener('click', async () => {
  const confirmed = await askConfirm('Undo the last cleanup run on this report?', 'Undo');
  if (!confirmed) return;
  setBusy(true);
  showProgress('Restoring previous values...', 'serviceUndo');
  diagnostics.classList.add('hidden');
  try {
    const result = await sendMessage({ type: 'undo' });
    hideProgress();
    if (!result || !result.ok) {
      if (!(await handleOperationAlreadyPaused(result))) {
        statusText.textContent = `Undo: ${(result && result.error) || 'unknown error'}`;
        statusText.className = result && result.error === 'nothing-to-undo' ? 'ok' : 'error';
      }
      setBusy(false);
      return;
    }
    summarySection.classList.remove('hidden');
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
    summaryText.innerHTML = lines.map((l) => `<div>${l}</div>`).join('');
    reviewList.innerHTML = '';
    examplesList.innerHTML = '';
    if (result.failed.length) showDiagnostics(result.failed);
  } catch (err) {
    hideProgress();
    showDiagnostics(String(err));
  }
  setBusy(false);
});

batteryPreviewBtn.addEventListener('click', async () => {
  setBusy(true);
  showBatteryProgress('Scanning entire report for Battery devices (this does not modify anything)...');
  diagnostics.classList.add('hidden');
  try {
    const result = await sendMessage({ type: 'batteryPreview' });
    hideBatteryProgress();
    if (!result || !result.found) {
      statusText.textContent = 'Report no longer found on this tab.';
      statusText.className = 'error';
      setBusy(false);
      return;
    }
    lastBatteryPreview = result;
    renderBatterySummary(result.summary);
  } catch (err) {
    hideBatteryProgress();
    showDiagnostics(String(err));
  }
  setBusy(false);
});

batteryApplyBtn.addEventListener('click', async () => {
  if (!lastBatteryPreview || !lastBatteryPreview.summary) return;
  const devices = lastBatteryPreview.summary.totalDevicesAffected;
  const fields = lastBatteryPreview.summary.totalFieldsAffected;
  const pacedNote = devices > LARGE_OPERATION_THRESHOLD ? ' BuildingReports saves each device separately, so this will run through a paced queue (one at a time) and may take a while.' : '';
  const confirmed = await askBatteryConfirm(
    `Apply Battery Cleanup to ${devices} device(s), ${fields} field(s) total? Only entries classified as safe to change will be touched.${pacedNote}`,
    'Apply'
  );
  if (!confirmed) return;

  setBusy(true);
  showBatteryProgress(`Applying changes to ${devices} Battery device(s) and verifying saves...`, 'batteryApply');
  diagnostics.classList.add('hidden');
  try {
    const result = await sendMessage({ type: 'batteryApply' });
    hideBatteryProgress();
    if (!result || !result.ok) {
      if (!(await handleOperationAlreadyPaused(result))) {
        statusText.textContent = `Battery Apply failed: ${(result && result.error) || 'unknown error'}`;
        statusText.className = 'error';
        showDiagnostics(result);
      }
      setBusy(false);
      return;
    }
    renderBatterySummary(result.summary);
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
    batterySummaryText.innerHTML += '<div style="margin-top:6px;font-weight:600;">Apply result</div>' + extra.map((l) => `<div>${l}</div>`).join('');
    if (result.failed.length) {
      showDiagnostics(result.failed);
    }
  } catch (err) {
    hideBatteryProgress();
    showDiagnostics(String(err));
  }
  setBusy(false);
});

batteryUndoBtn.addEventListener('click', async () => {
  const confirmed = await askBatteryConfirm('Undo the last Battery Cleanup run on this report?', 'Undo');
  if (!confirmed) return;
  setBusy(true);
  showBatteryProgress('Restoring previous Battery values...', 'batteryUndo');
  diagnostics.classList.add('hidden');
  try {
    const result = await sendMessage({ type: 'batteryUndo' });
    hideBatteryProgress();
    if (!result || !result.ok) {
      if (!(await handleOperationAlreadyPaused(result))) {
        statusText.textContent = `Battery Undo: ${(result && result.error) || 'unknown error'}`;
        statusText.className = result && result.error === 'nothing-to-undo' ? 'ok' : 'error';
      }
      setBusy(false);
      return;
    }
    batterySummarySection.classList.remove('hidden');
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
    batterySummaryText.innerHTML = lines.map((l) => `<div>${l}</div>`).join('');
    batteryReviewList.innerHTML = '';
    batteryExamplesList.innerHTML = '';
    if (result.failed.length) showDiagnostics(result.failed);
  } catch (err) {
    hideBatteryProgress();
    showDiagnostics(String(err));
  }
  setBusy(false);
});

init();
