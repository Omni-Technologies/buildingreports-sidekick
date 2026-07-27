// Pure, DOM-free logic for pacing a sequence of BuildingReports device
// writes ONE AT A TIME, with resumable checkpointing and rate-limit backoff.
// Shared by Service Cleanup Apply/Undo and Battery Cleanup Apply/Undo - see
// docs/architecture.md's "Throttled write queue" section for why this
// exists (BuildingReports rate-limits concurrent deviceWrite requests - see
// docs/buildingreports-dom-map.md section 5.1) and docs/adding-a-rule.md for
// how a new cleanup action plugs into it.
//
// No chrome.*, no window, no DOM - the actual network call is injected as
// `saveFn` by the caller (background.js, using the adapter), which is what
// keeps this file unit-testable with plain `node --test`.

export const ItemStatus = {
  PENDING: 'pending',
  SAVING: 'saving',
  SAVED: 'saved',
  VERIFIED: 'verified',
  FAILED: 'failed',
  PAUSED_RATE_LIMIT: 'pausedRateLimit',
  RESTORED: 'restored',
};

// Conservative default spacing between the completion of one save and the
// start of the next. Deliberately not tuned for speed - see
// docs/buildingreports-dom-map.md 5.1: a single isolated save completed in
// ~330ms with no issue, but bursts of dozens of concurrent saves were
// rate-limited, so this stays well above the observed single-request
// latency rather than trying to race it.
export const DEFAULT_MIN_DELAY_MS = 750;

// Base delay for the first rate-limit backoff step; doubles/quadruples from
// here (see backoffDelayMs). BuildingReports returned no Retry-After header
// in the one rate-limit response observed, so this is a deliberate,
// conservative guess, not a measured value.
const BASE_BACKOFF_MS = 2000;
export const MAX_BACKOFF_MS = 60000;

// Upper bound on automatic rate-limit retries of the SAME item before
// giving up and requiring a manual Resume - see docs/architecture.md:
// "put an upper bound on automatic retries" / "when automatic recovery
// cannot be proven safe, pause and show a Resume button".
export const MAX_RATE_LIMIT_RETRIES = 5;

const RATE_LIMIT_PATTERN = /rate limit|too many requests|exceeded the maximum number of requests/i;

// Matches BuildingReports' own rate-limit error body text (see
// docs/buildingreports-dom-map.md 5.1) case-insensitively, tolerant of
// slightly different wording since only one exact message has been observed.
export function isRateLimitResponse(bodyText) {
  return typeof bodyText === 'string' && RATE_LIMIT_PATTERN.test(bodyText);
}

// Builds a fresh, resumable, JSON-serializable checkpoint for a planned set
// of writes. `items` is the caller's list of { scannumber, before, after,
// fields, ... } - whatever shape the caller's saveFn needs; write-queue.js
// only ever reads/writes the `status`/`error` fields it owns.
export function createCheckpoint({ kind, inspectionId, items, minDelayMs = DEFAULT_MIN_DELAY_MS }) {
  return {
    kind, // 'serviceApply' | 'serviceUndo' | 'batteryApply' | 'batteryUndo'
    inspectionId,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    cursor: 0,
    minDelayMs,
    consecutiveRateLimitHits: 0,
    paused: false,
    cancelled: false,
    gaveUp: false,
    items: items.map((item) => ({ ...item, status: ItemStatus.PENDING, error: null })),
  };
}

export function currentItem(checkpoint) {
  return checkpoint.items[checkpoint.cursor] || null;
}

export function isComplete(checkpoint) {
  return checkpoint.cursor >= checkpoint.items.length;
}

export function shouldGiveUp(checkpoint) {
  return checkpoint.consecutiveRateLimitHits > MAX_RATE_LIMIT_RETRIES;
}

// Marks the current item 'saving' for progress display while its save is
// in flight - a display-only transition, never persisted as the resumable
// state (advance() below is what actually moves the checkpoint forward).
export function markCurrentSaving(checkpoint) {
  const idx = checkpoint.cursor;
  if (idx >= checkpoint.items.length) return checkpoint;
  const items = checkpoint.items.slice();
  items[idx] = { ...items[idx], status: ItemStatus.SAVING };
  return { ...checkpoint, items };
}

// Applies the outcome of attempting checkpoint's current item and returns a
// NEW checkpoint (never mutates the input). `result` is one of:
//   { ok: true, status? }                        - saved/verified
//   { ok: false, error }                          - a real, non-rate-limit failure
//   { rateLimited: true, error, retryAfterMs? }   - throttled, not yet attempted-and-rejected
export function advance(checkpoint, result) {
  const idx = checkpoint.cursor;
  if (idx >= checkpoint.items.length) return checkpoint;
  const items = checkpoint.items.slice();

  if (result.rateLimited) {
    // Never mark a rate-limited item failed - it was throttled, not
    // rejected on its own merits, so it must stay pending-for-retry, and
    // every item after it in the queue must stay untouched/pending too.
    items[idx] = { ...items[idx], status: ItemStatus.PAUSED_RATE_LIMIT, error: result.error || 'rate limited' };
    return {
      ...checkpoint,
      items,
      paused: true,
      consecutiveRateLimitHits: checkpoint.consecutiveRateLimitHits + 1,
      updatedAt: Date.now(),
    };
  }

  if (result.ok) {
    items[idx] = { ...items[idx], status: result.status || ItemStatus.SAVED, error: null };
  } else {
    items[idx] = { ...items[idx], status: ItemStatus.FAILED, error: result.error || 'unknown error' };
  }
  return {
    ...checkpoint,
    items,
    cursor: checkpoint.cursor + 1,
    paused: false,
    consecutiveRateLimitHits: 0,
    updatedAt: Date.now(),
  };
}

// Backoff delay used only after a rate-limit hit. Respects a server-supplied
// Retry-After if one is ever observed (none were in live testing - see
// docs/buildingreports-dom-map.md 5.1); otherwise a conservative exponential
// ramp capped at MAX_BACKOFF_MS.
export function backoffDelayMs(consecutiveRateLimitHits, retryAfterMs) {
  if (retryAfterMs != null) return retryAfterMs;
  const delay = BASE_BACKOFF_MS * Math.pow(4, Math.max(0, consecutiveRateLimitHits - 1));
  return Math.min(delay, MAX_BACKOFF_MS);
}

// Clears a checkpoint's pause/give-up state for a manual Resume - a
// deliberate single human-triggered retry, counted fresh rather than
// continuing to compound the previous backoff.
export function prepareResume(checkpoint) {
  return {
    ...checkpoint,
    paused: false,
    cancelled: false,
    gaveUp: false,
    consecutiveRateLimitHits: 0,
    updatedAt: Date.now(),
  };
}

export function summarize(checkpoint) {
  const counts = {};
  for (const item of checkpoint.items) counts[item.status] = (counts[item.status] || 0) + 1;
  return {
    kind: checkpoint.kind,
    total: checkpoint.items.length,
    completed: checkpoint.cursor,
    remaining: checkpoint.items.length - checkpoint.cursor,
    paused: checkpoint.paused,
    cancelled: checkpoint.cancelled,
    gaveUp: checkpoint.gaveUp,
    counts,
  };
}

function defaultDelay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Drives a checkpoint to completion, a cancellation point, or a
// give-up-after-retries pause point - one item at a time, concurrency
// exactly 1. Never mutates its input checkpoint (returns the final one).
//
// `saveFn(item)` - required. Must return/resolve a result shape matching
//   advance()'s `result` parameter above. Called at most once per loop
//   iteration; the loop always awaits it before doing anything else.
// `onProgress(checkpoint)` - optional. Called after every transition
//   (saving/saved/failed/paused/cancelled) so the caller can persist
//   checkpoint state incrementally (e.g. to chrome.storage.local) and/or
//   update a UI. Receives a full checkpoint snapshot each time.
// `delayFn(ms)` - optional, defaults to a real setTimeout-based wait. Tests
//   inject a fast/no-op version so pacing doesn't slow down the suite.
// `shouldCancel()` - optional. Checked before starting each item so a
//   "Cancel Remaining" request takes effect between items, never mid-save.
export async function runQueue(
  initialCheckpoint,
  { saveFn, onProgress, delayFn = defaultDelay, shouldCancel = () => false }
) {
  let checkpoint = initialCheckpoint;

  while (!isComplete(checkpoint)) {
    if (shouldCancel()) {
      checkpoint = { ...checkpoint, cancelled: true };
      if (onProgress) onProgress(checkpoint);
      return checkpoint;
    }

    if (onProgress) onProgress(markCurrentSaving(checkpoint));

    let result;
    try {
      // eslint-disable-next-line no-await-in-loop
      result = await saveFn(currentItem(checkpoint));
    } catch (err) {
      result = { ok: false, error: String((err && err.message) || err) };
    }

    checkpoint = advance(checkpoint, result);
    if (onProgress) onProgress(checkpoint);

    if (checkpoint.paused) {
      if (shouldGiveUp(checkpoint)) {
        checkpoint = { ...checkpoint, gaveUp: true };
        if (onProgress) onProgress(checkpoint);
        return checkpoint;
      }
      const wait = backoffDelayMs(checkpoint.consecutiveRateLimitHits, result.retryAfterMs);
      // eslint-disable-next-line no-await-in-loop
      await delayFn(wait);
      // Retry the SAME item (cursor unchanged) - a rate-limit pause is not
      // a per-item failure, so the next loop iteration re-attempts it.
      checkpoint = { ...checkpoint, paused: false };
      continue;
    }

    if (!isComplete(checkpoint)) {
      // eslint-disable-next-line no-await-in-loop
      await delayFn(checkpoint.minDelayMs);
    }
  }

  return checkpoint;
}
