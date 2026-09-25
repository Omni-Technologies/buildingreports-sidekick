import { runCleanup } from '../cleanup/engine.js';
import { runBatteryCleanup } from '../cleanup/battery-engine.js';
import { getProfile } from '../config/inspection-profiles/index.js';
import { createCheckpoint, runQueue, prepareResume, summarize, isComplete } from '../cleanup/write-queue.js';
import { classifyThirdPartyServiceRecord } from '../cleanup/third-party-service-parser.js';
import { scanFailedDevices } from '../cleanup/repair-engine.js';
import { buildEmailSummary } from '../cleanup/email-summary.js';

// Third-party serviced devices' 31-character Service limit - see
// docs/cleanup-rules.md's "Third-Party Serviced Devices" section.
const THIRD_PARTY_SERVICE_LENGTH_LIMIT = 31;

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

// Repair/Fixed's own Undo history - kept separate from Battery Cleanup's
// even though both can write the same Battery fields, since they're
// conceptually distinct actions (an automated classify-and-fix pass vs. a
// human-confirmed one-time repair record) with different checkpoint kinds
// (repairApply/repairUndo below) - same "never cross-contaminate" reasoning
// as Service vs. Battery.
function repairUndoStorageKey(inspectionId) {
  return `brSidekick.repairUndo.${inspectionId}`;
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
// item.writeValue is a plain string (just the 'service' field) for every
// ordinary supported device type - the original, unchanged path. It's an
// object (e.g. { service, restoreTime }) for the Communicator/Communication
// Line/Monitoring special-case rules in classify.js/communications-parser.js,
// an Annual Heat Detector's Restorable checkbox sync
// ({ service, restorable }), or a third-party serviced device's expiration
// flags ({ service, comment, solution, note } - see
// third-party-service-parser.js and handleManualServiceFix) - any rule that
// can need an extra field written in the same save alongside Service. See
// docs/cleanup-rules.md. write-queue.js/the checkpoint never look inside
// writeValue/priorValue either way (see docs/architecture.md), so Undo and
// Resume automatically handle both shapes without any changes there.
async function saveServiceItem(tabId, frameId, item) {
  await ensureAdapterInjected(tabId, frameId);
  const isMultiField = item.writeValue !== null && typeof item.writeValue === 'object';
  const results = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    world: 'MAIN',
    func: (sn, value, multiField) =>
      multiField
        ? window.__brSidekickAdapter.applySingleServiceFieldsChange(sn, value)
        : window.__brSidekickAdapter.applySingleServiceChange(sn, value),
    args: [item.scannumber, item.writeValue, isMultiField],
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

// Repair/Fixed can write two different shapes now that a generic
// (non-Battery) rule exists alongside the Battery one - a single
// checkpoint kind ('repairApply'/'repairUndo') can carry a mix of both in
// one run, so routing is per-item rather than per-checkpoint. Battery
// items use the Battery-attribute-aware adapter path (semantic names like
// amps/minAh/installDate need BATTERY_FIELD_MAP/BATTERY_DATE_FIELD_MAP
// translation); every other device type's repair rule so far only ever
// writes plain Service-shaped fields (passed/comment/solution/service/
// note, which already share their real dataIndex name), so it goes
// through the same path Service Cleanup uses. `item.deviceKind` is set by
// popup.js when the item is built (see repairYesBtn's form handlers) and
// carried through the checkpoint/Undo entry unchanged - see
// summarizeCheckpointForResponse and handleRepairUndo below.
async function saveRepairItem(tabId, frameId, item) {
  if (item.deviceKind === 'battery') {
    return saveBatteryItem(tabId, frameId, item);
  }
  return saveServiceItem(tabId, frameId, item);
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
      // deviceKind is only ever set on Repair/Fixed items (see
      // saveRepairItem above) - harmless undefined for every other write
      // path, carried through so a later repairUndo routes each item to
      // the correct adapter path too.
      confirmedEntries.push({
        scannumber: item.scannumber,
        before: item.priorValue,
        after: item.writeValue,
        deviceKind: item.deviceKind,
      });
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

// "Copy Email Lists" - an independent, read-only, always-fresh scan of
// every device currently in the report (not dependent on Service/Battery
// Cleanup having run at all - see docs/cleanup-rules.md's "Email
// discrepancy lists" section). Pure classification lives in
// cleanup/email-summary.js; this just fetches fresh records the same way
// handlePreview does.
async function handleEmailSummary(tabId) {
  const host = await detectReport(tabId);
  if (!host) return { found: false };
  const records = await getAllRecords(tabId, host.frameId);
  if (!records) return { found: false };
  const summary = buildEmailSummary(records);
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
    // Some safeChanges can carry extraFieldChanges alongside the Service
    // text: Communicator/Communication Line/Monitoring's device-attribute
    // field and/or Comment/Solution (communications-parser.js), an Annual
    // Heat Detector's Restorable checkbox (classify.js), or a third-party
    // serviced device's expiration Comment/Solution/Note
    // (third-party-service-parser.js). Every other device type's safeChange
    // never has this property, so writeValue stays a plain string exactly
    // as before for them.
    const items = summary.safeChanges.map((c) => {
      const priorRecord = recordsBySn.get(String(c.scannumber));
      if (c.extraFieldChanges && c.extraFieldChanges.length > 0) {
        const writeValue = { service: c.after };
        const priorValue = { service: priorRecord.service };
        for (const fc of c.extraFieldChanges) {
          writeValue[fc.field] = fc.after;
          priorValue[fc.field] = fc.before;
        }
        return { scannumber: c.scannumber, writeValue, priorValue };
      }
      return { scannumber: c.scannumber, writeValue: c.after, priorValue: priorRecord.service };
    });

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

// Read-only entry-count peek for all three Undo histories (Service +
// Battery + Repair/Fixed), used by the popup's Undo confirmations so a
// technician sees exactly how much will be restored before clicking Undo -
// see docs/architecture.md's Undo section and CLAUDE.md's "Definition of
// done" step 5 on checking chrome.storage.local's entry count first.
async function handleUndoStatus(tabId) {
  const host = await detectReport(tabId);
  if (!host) return { found: false };
  const inspectionId = host.meta.inspectionId;
  const serviceKey = undoStorageKey(inspectionId);
  const batteryKey = batteryUndoStorageKey(inspectionId);
  const repairKey = repairUndoStorageKey(inspectionId);
  const stored = await chrome.storage.local.get([serviceKey, batteryKey, repairKey]);
  const serviceRecord = stored[serviceKey];
  const batteryRecord = stored[batteryKey];
  const repairRecord = stored[repairKey];
  return {
    found: true,
    serviceEntries: (serviceRecord && serviceRecord.entries && serviceRecord.entries.length) || 0,
    batteryEntries: (batteryRecord && batteryRecord.entries && batteryRecord.entries.length) || 0,
    repairEntries: (repairRecord && repairRecord.entries && repairRecord.entries.length) || 0,
  };
}

// Manual fix for a third-party serviced device (Air Pressure Switch/Tamper
// Switch/Waterflow Switch/Kitchen Hood/Fire Pump Phase Reversal/Fire Pump
// Power/Fire Pump Running/Fire Pump Trouble/Pre-Action System/Clean Agent
// System) whose
// abbreviated company name still didn't fit BuildingReports' 31-character
// Service limit - see
// third-party-service-parser.js's `suggestedFix` and docs/cleanup-rules.md.
// A human edits the suggested value in the popup; this writes exactly that
// one record through the same single-record write-queue path every other
// write uses (reusing the 'serviceApply' checkpoint kind rather than a new
// one - it's conceptually still a Service Cleanup apply, and this also
// means the existing "refuses to clobber an already-paused checkpoint"
// guard protects it for free). Never trusts anything the popup computed -
// re-fetches fresh records and re-runs classification on this one record
// purely to pull its current expiration extraFieldChanges (Comment/
// Solution/Note), so a manual Service fix still carries whatever
// independently-correct expiration flags apply.
async function handleManualServiceFix(tabId, scannumber, newValue) {
  if (applyInProgress.has(tabId)) {
    return { ok: false, error: 'already-running' };
  }
  if (typeof newValue !== 'string' || newValue.trim().length === 0) {
    return { ok: false, error: 'invalid-value' };
  }
  if (newValue.length > THIRD_PARTY_SERVICE_LENGTH_LIMIT) {
    return { ok: false, error: 'value-too-long' };
  }
  applyInProgress.add(tabId);
  try {
    const host = await detectReport(tabId);
    if (!host) return { ok: false, error: 'report-not-found' };
    const records = await getAllRecords(tabId, host.frameId);
    if (!records) return { ok: false, error: 'report-not-found' };
    const record = records.find((r) => String(r.scannumber) === String(scannumber));
    if (!record) return { ok: false, error: 'record-not-found' };

    const classification = classifyThirdPartyServiceRecord(record);
    const extraFieldChanges = (classification && classification.extraFieldChanges) || [];

    let writeValue;
    let priorValue;
    if (extraFieldChanges.length > 0) {
      writeValue = { service: newValue };
      priorValue = { service: record.service };
      for (const fc of extraFieldChanges) {
        writeValue[fc.field] = fc.after;
        priorValue[fc.field] = fc.before;
      }
    } else {
      writeValue = newValue;
      priorValue = record.service;
    }

    const items = [{ scannumber, writeValue, priorValue }];
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

    return { ok: true, applied: result.applied, failed: result.failed };
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

// Repair/Fixed - a human-driven, device-by-device action, architecturally
// unlike Service/Battery Cleanup's classify-everything-automatically
// Preview: only devices currently marked Failed are scanned (see
// repair-engine.js's scanFailedDevices), and every field change comes from
// a human answering "was this repaired?" plus (for a device type with a
// rule, e.g. Battery) filling in a short form in the popup - see
// docs/repair-fixed-rules.md. The popup builds each item's writeValue/
// priorValue itself (via repair-battery.js's buildBatteryRepairChange,
// imported directly into popup.js since it's pure logic with no chrome.*
// dependency) and sends the finished list here to write - this handler
// never re-derives field values itself, only validates shape and runs them
// through the same paced write queue/checkpoint/Undo machinery as every
// other write path in this extension.

async function handleRepairScan(tabId) {
  const host = await detectReport(tabId);
  if (!host) return { found: false };
  const records = await getAllRecords(tabId, host.frameId);
  if (!records) return { found: false };
  const failedDevices = scanFailedDevices(records);
  return { found: true, meta: host.meta, failedDevices };
}

async function handleRepairApply(tabId, items) {
  if (applyInProgress.has(tabId)) {
    return { ok: false, error: 'already-running' };
  }
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: 'no-items' };
  }
  for (const item of items) {
    if (!item || item.scannumber == null || !item.writeValue || typeof item.writeValue !== 'object') {
      return { ok: false, error: 'invalid-item' };
    }
  }
  applyInProgress.add(tabId);
  try {
    const host = await detectReport(tabId);
    if (!host) return { ok: false, error: 'report-not-found' };
    const inspectionId = host.meta.inspectionId;

    const { checkpoint, wasExplicitCancel, refusedAlreadyPaused } = await runNewOperation({
      tabId,
      frameId: host.frameId,
      kind: 'repairApply',
      inspectionId,
      items,
      saveItemFn: saveRepairItem,
    });

    if (refusedAlreadyPaused) {
      return { ok: false, error: 'operation-already-paused', progress: summarize(checkpoint) };
    }

    const result = summarizeCheckpointForResponse(checkpoint, wasExplicitCancel);
    if (inspectionId != null) {
      await mergeUndoEntries(repairUndoStorageKey(inspectionId), inspectionId, result.confirmedEntries);
    }

    return {
      ok: true,
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

async function handleRepairUndo(tabId) {
  if (applyInProgress.has(tabId)) {
    return { ok: false, error: 'already-running' };
  }
  applyInProgress.add(tabId);
  try {
    const host = await detectReport(tabId);
    if (!host) return { ok: false, error: 'report-not-found' };
    const inspectionId = host.meta.inspectionId;
    const key = repairUndoStorageKey(inspectionId);
    const stored = await chrome.storage.local.get(key);
    const record = stored[key];
    if (!record || !record.entries || record.entries.length === 0) {
      return { ok: false, error: 'nothing-to-undo' };
    }

    const items = record.entries.map((e) => ({
      scannumber: e.scannumber,
      writeValue: e.before,
      priorValue: e.after,
      deviceKind: e.deviceKind,
    }));

    const { checkpoint, wasExplicitCancel, refusedAlreadyPaused } = await runNewOperation({
      tabId,
      frameId: host.frameId,
      kind: 'repairUndo',
      inspectionId,
      items,
      saveItemFn: saveRepairItem,
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

// Generic resumable-operation support, shared by all six kinds
// ('serviceApply' | 'serviceUndo' | 'batteryApply' | 'batteryUndo' |
// 'repairApply' | 'repairUndo'). Lets the popup show "Operation paused - N
// completed, M remaining - Resume" on reopen instead of assuming the last
// run either fully finished or fully failed.

const SAVE_FNS = {
  serviceApply: saveServiceItem,
  serviceUndo: saveServiceItem,
  batteryApply: saveBatteryItem,
  batteryUndo: saveBatteryItem,
  repairApply: saveRepairItem,
  repairUndo: saveRepairItem,
};
const UNDO_KEY_FNS = {
  serviceApply: undoStorageKey,
  batteryApply: batteryUndoStorageKey,
  repairApply: repairUndoStorageKey,
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
        case 'undoStatus':
          sendResponse(await handleUndoStatus(tabId));
          break;
        case 'manualServiceFix':
          sendResponse(await handleManualServiceFix(tabId, message.scannumber, message.newValue));
          break;
        case 'emailSummary':
          sendResponse(await handleEmailSummary(tabId));
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
        case 'repairScan':
          sendResponse(await handleRepairScan(tabId));
          break;
        case 'repairApply':
          sendResponse(await handleRepairApply(tabId, message.items));
          break;
        case 'repairUndo':
          sendResponse(await handleRepairUndo(tabId));
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
