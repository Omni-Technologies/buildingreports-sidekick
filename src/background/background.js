import { runCleanup } from '../cleanup/engine.js';
import { runBatteryCleanup } from '../cleanup/battery-engine.js';
import { getProfile } from '../config/inspection-profiles/index.js';
import { createCheckpoint, runQueue, prepareResume, summarize, isComplete } from '../cleanup/write-queue.js';

const ADAPTER_FILE = 'src/site-adapters/buildingreports/adapter.js';

// Guards against overlapping Apply/Undo *starts* on the same tab - shared by
// Service Cleanup and Battery Cleanup, same as before the write coordinator.
// It only covers the synchronous "kick off a new operation" moment; a
// long-running paced operation itself is tracked by its checkpoint in
// chrome.storage.local (see checkpointStorageKey), which is what survives
// the popup closing.
const applyInProgress = new Set();

// In-memory stop flags, keyed by `${tabId}:${kind}`. Only meaningful while
// an operation's runQueue loop is actually alive in this service worker
// instance - checked by shouldCancel between items (never mid-save), and
// cleared once an operation's loop exits. Two distinct flags because Pause
// and Cancel Remaining differ in what happens to the checkpoint afterward:
// - pauseRequested: keep the checkpoint in storage so a later
//   'resumeOperation' picks up exactly where it stopped.
// - cancelRequested: the user is done with this run - completed items keep
//   their Undo entries (already merged as they completed), but the
//   checkpoint itself is discarded rather than left resumable.
const pauseRequested = new Set();
const cancelRequested = new Set();

function undoStorageKey(inspectionId) {
  return `brSidekick.undo.${inspectionId}`;
}

// Kept separate from undoStorageKey's Service Cleanup entries so the two
// actions' Undo never cross-contaminate each other.
function batteryUndoStorageKey(inspectionId) {
  return `brSidekick.batteryUndo.${inspectionId}`;
}

// One resumable checkpoint slot per (kind, inspection) - kind is one of
// 'serviceApply' | 'serviceUndo' | 'batteryApply' | 'batteryUndo'. Separate
// slots mean a paused Service Apply and a paused Battery Undo on the same
// report never collide.
function checkpointStorageKey(kind, inspectionId) {
  return `brSidekick.checkpoint.${kind}.${inspectionId}`;
}

async function findHostFrame(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    world: 'MAIN',
    func: () => (window.__brSidekickAdapter ? window.__brSidekickAdapter.detect() : null),
  });
  const hit = results.find((r) => r.result);
  if (!hit) return null;
  return { frameId: hit.frameId, meta: hit.result };
}

async function ensureAdapterInjected(tabId, frameId) {
  await chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    world: 'MAIN',
    files: [ADAPTER_FILE],
  });
}

async function detectReport(tabId) {
  // First pass: the adapter may not be injected into any frame yet.
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    world: 'MAIN',
    files: [ADAPTER_FILE],
  });
  return findHostFrame(tabId);
}

async function getAllRecords(tabId, frameId) {
  await ensureAdapterInjected(tabId, frameId);
  const results = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    world: 'MAIN',
    func: () => window.__brSidekickAdapter.getAllRecords(),
  });
  return results[0] && results[0].result;
}

// Single-record saves ONLY - see docs/architecture.md "Throttled write
// queue" and docs/buildingreports-dom-map.md 5.1 for why: BuildingReports
// rate-limits bursts of concurrent deviceWrite requests, so every write in
// this extension now goes through write-queue.js's runQueue at concurrency 1
// instead of ever setting more than one record dirty before clicking Save.
async function saveServiceItem(tabId, frameId, item) {
  await ensureAdapterInjected(tabId, frameId);
  const results = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    world: 'MAIN',
    func: (sn, newValue) => window.__brSidekickAdapter.applySingleServiceChange(sn, newValue),
    args: [item.scannumber, item.writeValue],
  });
  return results[0] && results[0].result;
}

async function saveBatteryItem(tabId, frameId, item) {
  await ensureAdapterInjected(tabId, frameId);
  const results = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    world: 'MAIN',
    func: (sn, fields) => window.__brSidekickAdapter.applySingleBatteryChange(sn, fields),
    args: [item.scannumber, item.writeValue],
  });
  return results[0] && results[0].result;
}

function clearStopFlags(key) {
  const wasCancel = cancelRequested.has(key);
  pauseRequested.delete(key);
  cancelRequested.delete(key);
  return wasCancel;
}

// After a run stops (complete, paused-by-Pause-button, or cancelled), decide
// whether to keep its checkpoint resumable or discard it. A checkpoint that
// gave up after exhausting rate-limit retries (see write-queue.js
// shouldGiveUp) is deliberately left in storage too - that's exactly the
// "pause and show a Resume button" case, not a discard.
async function finalizeCheckpointStorage(storageKey, finalCheckpoint, wasExplicitCancel) {
  const shouldDiscard = isComplete(finalCheckpoint) || (finalCheckpoint.cancelled && wasExplicitCancel);
  if (shouldDiscard) {
    await chrome.storage.local.remove(storageKey);
  }
}

// Runs a brand-new paced operation to completion/pause/cancel, persisting
// checkpoint progress to chrome.storage.local after every single item so
// closing the popup never loses progress - a later 'resumeOperation'
// message (or a fresh 'operationStatus' check on popup open) can pick the
// same checkpoint back up.
//
// Refuses to start if a checkpoint of the SAME kind is already sitting
// paused in storage - starting a fresh run would silently overwrite (lose)
// whatever that paused run hadn't finished yet. The caller must Resume or
// discard it first (see 'resumeOperation'/'discardOperation').
async function runNewOperation({ tabId, frameId, kind, inspectionId, items, saveItemFn }) {
  const storageKey = checkpointStorageKey(kind, inspectionId);
  const existingStored = await chrome.storage.local.get(storageKey);
  if (existingStored[storageKey]) {
    return {
      checkpoint: existingStored[storageKey],
      wasExplicitCancel: false,
      refusedAlreadyPaused: true,
    };
  }

  const stopKey = `${tabId}:${kind}`;
  const checkpoint = createCheckpoint({ kind, inspectionId, items });
  await chrome.storage.local.set({ [storageKey]: checkpoint });

  clearStopFlags(stopKey);
  const finalCheckpoint = await runQueue(checkpoint, {
    saveFn: (item) => saveItemFn(tabId, frameId, item),
    onProgress: (cp) => chrome.storage.local.set({ [storageKey]: cp }),
    shouldCancel: () => pauseRequested.has(stopKey) || cancelRequested.has(stopKey),
  });
  const wasExplicitCancel = clearStopFlags(stopKey);

  await finalizeCheckpointStorage(storageKey, finalCheckpoint, wasExplicitCancel);
  return { checkpoint: finalCheckpoint, wasExplicitCancel };
}

async function resumeOperation({ tabId, frameId, kind, inspectionId, saveItemFn }) {
  const storageKey = checkpointStorageKey(kind, inspectionId);
  const stored = await chrome.storage.local.get(storageKey);
  const existing = stored[storageKey];
  if (!existing) return { ok: false, error: 'nothing-to-resume' };

  const stopKey = `${tabId}:${kind}`;
  clearStopFlags(stopKey);
  const resumed = prepareResume(existing);
  const finalCheckpoint = await runQueue(resumed, {
    saveFn: (item) => saveItemFn(tabId, frameId, item),
    onProgress: (cp) => chrome.storage.local.set({ [storageKey]: cp }),
    shouldCancel: () => pauseRequested.has(stopKey) || cancelRequested.has(stopKey),
  });
  const wasExplicitCancel = clearStopFlags(stopKey);

  await finalizeCheckpointStorage(storageKey, finalCheckpoint, wasExplicitCancel);
  return { ok: true, checkpoint: finalCheckpoint, wasExplicitCancel };
}

// Builds the { applied, failed, undoAvailable, progress } shape the popup
// expects, and writes an Undo entry for every item this run actually
// confirmed saved - whether the run finished completely, was cancelled, or
// paused partway through waiting for a Resume. Never includes an item Apply
// never got to (pending/pausedRateLimit/saving).
function summarizeCheckpointForResponse(checkpoint, wasExplicitCancel = false) {
  const applied = [];
  const failed = [];
  const confirmedEntries = [];
  for (const item of checkpoint.items) {
    if (item.status === 'saved' || item.status === 'verified' || item.status === 'restored') {
      applied.push(item.scannumber);
      confirmedEntries.push({ scannumber: item.scannumber, before: item.priorValue, after: item.writeValue });
    } else if (item.status === 'failed') {
      failed.push({ scannumber: item.scannumber, error: item.error });
    }
  }
  // checkpoint.cancelled is set by write-queue.js whenever shouldCancel()
  // fired, which happens for BOTH the Pause and Cancel Remaining buttons -
  // wasExplicitCancel (captured from the cancelRequested flag specifically,
  // before it was cleared) is what actually distinguishes them for the UI.
  const cancelled = checkpoint.cancelled && wasExplicitCancel;
  const pausedByUser = checkpoint.cancelled && !wasExplicitCancel;
  return {
    applied,
    failed,
    confirmedEntries,
    progress: summarize(checkpoint),
    paused: checkpoint.paused,
    gaveUp: checkpoint.gaveUp,
    cancelled,
    pausedByUser,
    complete: isComplete(checkpoint),
  };
}

async function mergeUndoEntries(key, inspectionId, newEntries) {
  if (newEntries.length === 0) return;
  const stored = await chrome.storage.local.get(key);
  const existing = stored[key];
  // A resumed/partial run's confirmed entries are additive to whatever this
  // same Apply run already saved to storage before pausing/cancelling -
  // never overwritten by an earlier partial write.
  const priorEntries = existing && existing.inspectionId === inspectionId ? existing.entries : [];
  const bySn = new Map(priorEntries.map((e) => [String(e.scannumber), e]));
  for (const e of newEntries) bySn.set(String(e.scannumber), e);
  await chrome.storage.local.set({
    [key]: { inspectionId, timestamp: Date.now(), entries: [...bySn.values()] },
  });
}

async function handleDetect(tabId) {
  const host = await detectReport(tabId);
  if (!host) {
    return { found: false };
  }
  return { found: true, ...host.meta, frameId: host.frameId };
}

async function handlePreview(tabId, profileKey) {
  const host = await detectReport(tabId);
  if (!host) return { found: false };
  const profile = getProfile(profileKey);
  const records = await getAllRecords(tabId, host.frameId);
  if (!records) return { found: false };
  const summary = runCleanup(records, profile);
  return { found: true, meta: host.meta, summary };
}

async function handleApply(tabId, profileKey) {
  if (applyInProgress.has(tabId)) {
    return { ok: false, error: 'already-running' };
  }
  applyInProgress.add(tabId);
  try {
    const host = await detectReport(tabId);
    if (!host) return { ok: false, error: 'report-not-found' };
    const profile = getProfile(profileKey);
    const records = await getAllRecords(tabId, host.frameId);
    if (!records) return { ok: false, error: 'report-not-found' };
    const summary = runCleanup(records, profile);

    const recordsBySn = new Map(records.map((r) => [String(r.scannumber), r]));
    const items = summary.safeChanges.map((c) => ({
      scannumber: c.scannumber,
      writeValue: c.after,
      priorValue: recordsBySn.get(String(c.scannumber)).service,
    }));

    if (items.length === 0) {
      return { ok: true, summary, applied: [], failed: [], undoAvailable: false, progress: null };
    }

    const inspectionId = host.meta.inspectionId;
    const { checkpoint, wasExplicitCancel, refusedAlreadyPaused } = await runNewOperation({
      tabId,
      frameId: host.frameId,
      kind: 'serviceApply',
      inspectionId,
      items,
      saveItemFn: saveServiceItem,
    });

    if (refusedAlreadyPaused) {
      return { ok: false, error: 'operation-already-paused', progress: summarize(checkpoint) };
    }

    const result = summarizeCheckpointForResponse(checkpoint, wasExplicitCancel);
    if (inspectionId != null) {
      await mergeUndoEntries(undoStorageKey(inspectionId), inspectionId, result.confirmedEntries);
    }

    return {
      ok: true,
      summary,
      applied: result.applied,
      failed: result.failed,
      undoAvailable: result.applied.length > 0,
      progress: result.progress,
      paused: result.paused,
      gaveUp: result.gaveUp,
      cancelled: result.cancelled,
      pausedByUser: result.pausedByUser,
    };
  } finally {
    applyInProgress.delete(tabId);
  }
}

async function handleUndo(tabId) {
  if (applyInProgress.has(tabId)) {
    return { ok: false, error: 'already-running' };
  }
  applyInProgress.add(tabId);
  try {
    const host = await detectReport(tabId);
    if (!host) return { ok: false, error: 'report-not-found' };
    const inspectionId = host.meta.inspectionId;
    const key = undoStorageKey(inspectionId);
    const stored = await chrome.storage.local.get(key);
    const record = stored[key];
    if (!record || !record.entries || record.entries.length === 0) {
      return { ok: false, error: 'nothing-to-undo' };
    }

    const items = record.entries.map((e) => ({
      scannumber: e.scannumber,
      writeValue: e.before,
      priorValue: e.after,
    }));

    const { checkpoint, wasExplicitCancel, refusedAlreadyPaused } = await runNewOperation({
      tabId,
      frameId: host.frameId,
      kind: 'serviceUndo',
      inspectionId,
      items,
      saveItemFn: saveServiceItem,
    });

    if (refusedAlreadyPaused) {
      return { ok: false, error: 'operation-already-paused', progress: summarize(checkpoint) };
    }

    const result = summarizeCheckpointForResponse(checkpoint, wasExplicitCancel);

    // Only drop the entries that were actually confirmed restored - a
    // paused/partial Undo keeps its still-pending entries in storage so a
    // later Resume (or a plain retry of Undo) doesn't lose them.
    const restoredSet = new Set(result.applied.map(String));
    const remainingEntries = record.entries.filter((e) => !restoredSet.has(String(e.scannumber)));
    if (remainingEntries.length > 0) {
      await chrome.storage.local.set({
        [key]: { inspectionId, timestamp: record.timestamp, entries: remainingEntries },
      });
    } else {
      await chrome.storage.local.remove(key);
    }

    return {
      ok: true,
      restored: result.applied,
      failed: result.failed,
      total: record.entries.length,
      progress: result.progress,
      paused: result.paused,
      gaveUp: result.gaveUp,
      cancelled: result.cancelled,
      pausedByUser: result.pausedByUser,
    };
  } finally {
    applyInProgress.delete(tabId);
  }
}

// Battery Cleanup is universal (no inspection profile) and independent of
// Clean Up Service Entries: separate handlers, separate Undo storage key,
// separate checkpoint kinds - but shares the exact same paced write
// coordinator and detectReport/getAllRecords/applyInProgress plumbing.

async function handleBatteryPreview(tabId) {
  const host = await detectReport(tabId);
  if (!host) return { found: false };
  const records = await getAllRecords(tabId, host.frameId);
  if (!records) return { found: false };
  const summary = runBatteryCleanup(records);
  return { found: true, meta: host.meta, summary };
}

async function handleBatteryApply(tabId) {
  if (applyInProgress.has(tabId)) {
    return { ok: false, error: 'already-running' };
  }
  applyInProgress.add(tabId);
  try {
    const host = await detectReport(tabId);
    if (!host) return { ok: false, error: 'report-not-found' };
    const records = await getAllRecords(tabId, host.frameId);
    if (!records) return { ok: false, error: 'report-not-found' };
    const summary = runBatteryCleanup(records);

    const items = summary.changes.map((c) => ({
      scannumber: c.scannumber,
      writeValue: c.fields,
      priorValue: c.before,
    }));

    if (items.length === 0) {
      return { ok: true, summary, applied: [], failed: [], undoAvailable: false, progress: null };
    }

    const inspectionId = host.meta.inspectionId;
    const { checkpoint, wasExplicitCancel, refusedAlreadyPaused } = await runNewOperation({
      tabId,
      frameId: host.frameId,
      kind: 'batteryApply',
      inspectionId,
      items,
      saveItemFn: saveBatteryItem,
    });

    if (refusedAlreadyPaused) {
      return { ok: false, error: 'operation-already-paused', progress: summarize(checkpoint) };
    }

    const result = summarizeCheckpointForResponse(checkpoint, wasExplicitCancel);
    if (inspectionId != null) {
      await mergeUndoEntries(batteryUndoStorageKey(inspectionId), inspectionId, result.confirmedEntries);
    }

    return {
      ok: true,
      summary,
      applied: result.applied,
      failed: result.failed,
      undoAvailable: result.applied.length > 0,
      progress: result.progress,
      paused: result.paused,
      gaveUp: result.gaveUp,
      cancelled: result.cancelled,
      pausedByUser: result.pausedByUser,
    };
  } finally {
    applyInProgress.delete(tabId);
  }
}

async function handleBatteryUndo(tabId) {
  if (applyInProgress.has(tabId)) {
    return { ok: false, error: 'already-running' };
  }
  applyInProgress.add(tabId);
  try {
    const host = await detectReport(tabId);
    if (!host) return { ok: false, error: 'report-not-found' };
    const inspectionId = host.meta.inspectionId;
    const key = batteryUndoStorageKey(inspectionId);
    const stored = await chrome.storage.local.get(key);
    const record = stored[key];
    if (!record || !record.entries || record.entries.length === 0) {
      return { ok: false, error: 'nothing-to-undo' };
    }

    const items = record.entries.map((e) => ({
      scannumber: e.scannumber,
      writeValue: e.before,
      priorValue: e.after,
    }));

    const { checkpoint, wasExplicitCancel, refusedAlreadyPaused } = await runNewOperation({
      tabId,
      frameId: host.frameId,
      kind: 'batteryUndo',
      inspectionId,
      items,
      saveItemFn: saveBatteryItem,
    });

    if (refusedAlreadyPaused) {
      return { ok: false, error: 'operation-already-paused', progress: summarize(checkpoint) };
    }

    const result = summarizeCheckpointForResponse(checkpoint, wasExplicitCancel);

    const restoredSet = new Set(result.applied.map(String));
    const remainingEntries = record.entries.filter((e) => !restoredSet.has(String(e.scannumber)));
    if (remainingEntries.length > 0) {
      await chrome.storage.local.set({
        [key]: { inspectionId, timestamp: record.timestamp, entries: remainingEntries },
      });
    } else {
      await chrome.storage.local.remove(key);
    }

    return {
      ok: true,
      restored: result.applied,
      failed: result.failed,
      total: record.entries.length,
      progress: result.progress,
      paused: result.paused,
      gaveUp: result.gaveUp,
      cancelled: result.cancelled,
      pausedByUser: result.pausedByUser,
    };
  } finally {
    applyInProgress.delete(tabId);
  }
}

// Generic resumable-operation support, shared by all four kinds
// ('serviceApply' | 'serviceUndo' | 'batteryApply' | 'batteryUndo'). Lets the
// popup show "Operation paused - N completed, M remaining - Resume" on
// reopen instead of assuming the last run either fully finished or fully
// failed.

const SAVE_FNS = {
  serviceApply: saveServiceItem,
  serviceUndo: saveServiceItem,
  batteryApply: saveBatteryItem,
  batteryUndo: saveBatteryItem,
};
const UNDO_KEY_FNS = {
  serviceApply: undoStorageKey,
  batteryApply: batteryUndoStorageKey,
};

async function handleOperationStatus(tabId, kind) {
  const host = await detectReport(tabId);
  if (!host) return { found: false };
  const inspectionId = host.meta.inspectionId;
  const key = checkpointStorageKey(kind, inspectionId);
  const stored = await chrome.storage.local.get(key);
  const checkpoint = stored[key];
  if (!checkpoint) return { found: true, active: false };
  return { found: true, active: true, progress: summarize(checkpoint) };
}

async function handleResumeOperation(tabId, kind) {
  if (applyInProgress.has(tabId)) {
    return { ok: false, error: 'already-running' };
  }
  applyInProgress.add(tabId);
  try {
    const host = await detectReport(tabId);
    if (!host) return { ok: false, error: 'report-not-found' };
    const inspectionId = host.meta.inspectionId;
    const saveItemFn = SAVE_FNS[kind];
    if (!saveItemFn) return { ok: false, error: 'unknown-operation-kind' };

    const outcome = await resumeOperation({ tabId, frameId: host.frameId, kind, inspectionId, saveItemFn });
    if (!outcome.ok) return outcome;

    const result = summarizeCheckpointForResponse(outcome.checkpoint, outcome.wasExplicitCancel);
    const undoKeyFn = UNDO_KEY_FNS[kind];
    if (undoKeyFn && inspectionId != null) {
      await mergeUndoEntries(undoKeyFn(inspectionId), inspectionId, result.confirmedEntries);
    }

    return {
      ok: true,
      applied: result.applied,
      failed: result.failed,
      progress: result.progress,
      paused: result.paused,
      gaveUp: result.gaveUp,
      cancelled: result.cancelled,
      pausedByUser: result.pausedByUser,
    };
  } finally {
    applyInProgress.delete(tabId);
  }
}

function handleCancelOperation(tabId, kind) {
  cancelRequested.add(`${tabId}:${kind}`);
  return { ok: true };
}

// Distinct from Cancel: stops before the next item starts (same as Cancel),
// but the checkpoint stays in storage afterward so 'resumeOperation'
// continues it later instead of discarding the remaining work.
function handlePauseOperation(tabId, kind) {
  pauseRequested.add(`${tabId}:${kind}`);
  return { ok: true };
}

// For a checkpoint that is ALREADY stopped (paused/gaveUp, no runQueue loop
// currently alive to react to a cancel flag) - e.g. the popup was reopened
// after a give-up and the user chooses "Cancel Remaining" instead of
// Resume. Simply discards the stored checkpoint; whatever it already
// confirmed saved was merged into the Undo entry the moment it happened, so
// nothing about completed work is lost.
async function handleDiscardOperation(tabId, kind) {
  const host = await detectReport(tabId);
  if (!host) return { ok: false, error: 'report-not-found' };
  const inspectionId = host.meta.inspectionId;
  await chrome.storage.local.remove(checkpointStorageKey(kind, inspectionId));
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      const tabId = message.tabId || (sender.tab && sender.tab.id);
      if (!tabId) {
        sendResponse({ ok: false, error: 'no-tab' });
        return;
      }
      switch (message.type) {
        case 'detect':
          sendResponse(await handleDetect(tabId));
          break;
        case 'preview':
          sendResponse(await handlePreview(tabId, message.profileKey));
          break;
        case 'apply':
          sendResponse(await handleApply(tabId, message.profileKey));
          break;
        case 'undo':
          sendResponse(await handleUndo(tabId));
          break;
        case 'batteryPreview':
          sendResponse(await handleBatteryPreview(tabId));
          break;
        case 'batteryApply':
          sendResponse(await handleBatteryApply(tabId));
          break;
        case 'batteryUndo':
          sendResponse(await handleBatteryUndo(tabId));
          break;
        case 'operationStatus':
          sendResponse(await handleOperationStatus(tabId, message.kind));
          break;
        case 'resumeOperation':
          sendResponse(await handleResumeOperation(tabId, message.kind));
          break;
        case 'cancelOperation':
          sendResponse(handleCancelOperation(tabId, message.kind));
          break;
        case 'pauseOperation':
          sendResponse(handlePauseOperation(tabId, message.kind));
          break;
        case 'discardOperation':
          sendResponse(await handleDiscardOperation(tabId, message.kind));
          break;
        default:
          sendResponse({ ok: false, error: 'unknown-message-type' });
      }
    } catch (err) {
      sendResponse({ ok: false, error: String((err && err.message) || err) });
    }
  })();
  return true; // keep the message channel open for the async response
});
