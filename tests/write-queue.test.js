import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCheckpoint,
  runQueue,
  advance,
  isRateLimitResponse,
  backoffDelayMs,
  shouldGiveUp,
  prepareResume,
  summarize,
  ItemStatus,
  MAX_RATE_LIMIT_RETRIES,
} from '../src/cleanup/write-queue.js';

function items(n) {
  return Array.from({ length: n }, (_, i) => ({ scannumber: String(i + 1), before: 'A', after: 'B' }));
}

// A no-op delay so tests run instantly regardless of minDelayMs/backoff.
const instant = async () => {};

test('isRateLimitResponse recognizes the real BuildingReports error text and ignores unrelated errors', () => {
  const real =
    '<response success="false"><responsedetail><error>410 Rate Limit Exceeded</error><errormessage>You have exceeded the maximum number of requests allowed for a short period of time. Please wait and try your request again.</errormessage></responsedetail></response>';
  assert.equal(isRateLimitResponse(real), true);
  assert.equal(isRateLimitResponse('Too Many Requests'), true);
  assert.equal(isRateLimitResponse('<error>200 OK</error>'), false);
  assert.equal(isRateLimitResponse(''), false);
  assert.equal(isRateLimitResponse(null), false);
});

test('backoffDelayMs respects an explicit retryAfterMs over the computed backoff', () => {
  assert.equal(backoffDelayMs(1, 12345), 12345);
});

test('backoffDelayMs grows exponentially with consecutive hits and is capped', () => {
  const d1 = backoffDelayMs(1);
  const d2 = backoffDelayMs(2);
  const d3 = backoffDelayMs(3);
  assert.ok(d2 > d1);
  assert.ok(d3 > d2);
  const dHuge = backoffDelayMs(50);
  assert.ok(dHuge <= 60000);
});

test('shouldGiveUp trips only after MAX_RATE_LIMIT_RETRIES consecutive hits', () => {
  let checkpoint = createCheckpoint({ kind: 'serviceApply', inspectionId: '1', items: items(1) });
  for (let i = 0; i < MAX_RATE_LIMIT_RETRIES; i++) {
    checkpoint = advance(checkpoint, { rateLimited: true, error: 'rate limited' });
    assert.equal(shouldGiveUp(checkpoint), false, `should not give up after ${i + 1} hits`);
  }
  checkpoint = advance(checkpoint, { rateLimited: true, error: 'rate limited' });
  assert.equal(shouldGiveUp(checkpoint), true);
});

test('advance on success moves the cursor forward and resets rate-limit streak', () => {
  let checkpoint = createCheckpoint({ kind: 'serviceApply', inspectionId: '1', items: items(2) });
  checkpoint = advance(checkpoint, { rateLimited: true, error: 'x' });
  assert.equal(checkpoint.cursor, 0);
  assert.equal(checkpoint.consecutiveRateLimitHits, 1);
  checkpoint = advance(checkpoint, { ok: true });
  assert.equal(checkpoint.cursor, 1);
  assert.equal(checkpoint.consecutiveRateLimitHits, 0);
  assert.equal(checkpoint.items[0].status, ItemStatus.SAVED);
});

test('advance on a real (non-rate-limit) failure still moves the cursor forward and marks failed', () => {
  let checkpoint = createCheckpoint({ kind: 'serviceApply', inspectionId: '1', items: items(1) });
  checkpoint = advance(checkpoint, { ok: false, error: 'save-failed' });
  assert.equal(checkpoint.cursor, 1);
  assert.equal(checkpoint.items[0].status, ItemStatus.FAILED);
  assert.equal(checkpoint.items[0].error, 'save-failed');
});

test('advance on rate limit never marks the item failed, and leaves later items untouched/pending', () => {
  let checkpoint = createCheckpoint({ kind: 'serviceApply', inspectionId: '1', items: items(3) });
  checkpoint = advance(checkpoint, { rateLimited: true, error: 'throttled' });
  assert.equal(checkpoint.items[0].status, ItemStatus.PAUSED_RATE_LIMIT);
  assert.notEqual(checkpoint.items[0].status, ItemStatus.FAILED);
  assert.equal(checkpoint.items[1].status, ItemStatus.PENDING);
  assert.equal(checkpoint.items[2].status, ItemStatus.PENDING);
  assert.equal(checkpoint.paused, true);
});

test('runQueue processes items strictly in order with concurrency 1 (never two saves in flight)', async () => {
  const seen = [];
  let inFlight = 0;
  let maxConcurrent = 0;
  const checkpoint = createCheckpoint({ kind: 'serviceApply', inspectionId: '1', items: items(5), minDelayMs: 0 });

  const result = await runQueue(checkpoint, {
    saveFn: async (item) => {
      inFlight += 1;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      seen.push(item.scannumber);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return { ok: true };
    },
    delayFn: instant,
  });

  assert.deepEqual(seen, ['1', '2', '3', '4', '5']);
  assert.equal(maxConcurrent, 1);
  assert.equal(result.cursor, 5);
  assert.equal(summarize(result).remaining, 0);
});

test('runQueue uses the injected delayFn between completed saves (configurable delay)', async () => {
  const delays = [];
  const checkpoint = createCheckpoint({ kind: 'serviceApply', inspectionId: '1', items: items(3), minDelayMs: 123 });

  await runQueue(checkpoint, {
    saveFn: async () => ({ ok: true }),
    delayFn: async (ms) => {
      delays.push(ms);
    },
  });

  // One delay after each of the first two saves, none after the last (queue
  // is complete - no need to wait before nothing).
  assert.deepEqual(delays, [123, 123]);
});

test('runQueue pauses on rate limit without marking pending items failed, then auto-retries and succeeds', async () => {
  const checkpoint = createCheckpoint({ kind: 'serviceApply', inspectionId: '1', items: items(2), minDelayMs: 0 });
  let calls = 0;

  const result = await runQueue(checkpoint, {
    saveFn: async (item) => {
      calls += 1;
      if (item.scannumber === '1' && calls === 1) {
        return { rateLimited: true, error: 'rate limited' };
      }
      return { ok: true };
    },
    delayFn: instant,
  });

  assert.equal(result.cursor, 2);
  assert.equal(result.items[0].status, ItemStatus.SAVED);
  assert.equal(result.items[1].status, ItemStatus.SAVED);
  assert.equal(calls, 3); // item 1 rate-limited once then retried, then item 2
});

test('runQueue gives up after MAX_RATE_LIMIT_RETRIES and stops without marking the item failed', async () => {
  const checkpoint = createCheckpoint({ kind: 'serviceApply', inspectionId: '1', items: items(2), minDelayMs: 0 });
  let attempts = 0;

  const result = await runQueue(checkpoint, {
    saveFn: async () => {
      attempts += 1;
      return { rateLimited: true, error: 'still limited' };
    },
    delayFn: instant,
  });

  assert.equal(result.gaveUp, true);
  assert.equal(result.cursor, 0, 'the stuck item is never advanced past');
  assert.notEqual(result.items[0].status, ItemStatus.FAILED);
  assert.equal(attempts, MAX_RATE_LIMIT_RETRIES + 1);
});

test('resuming from a checkpoint continues from the correct (unfinished) record, not from the start', async () => {
  const checkpoint = createCheckpoint({ kind: 'serviceApply', inspectionId: '1', items: items(4), minDelayMs: 0 });
  const seenFirstRun = [];

  const paused = await runQueue(checkpoint, {
    saveFn: async (item) => {
      seenFirstRun.push(item.scannumber);
      if (item.scannumber === '3') return { rateLimited: true, error: 'x' };
      return { ok: true };
    },
    delayFn: instant,
  });

  // Force a give-up scenario to simulate "operation paused, needs a manual Resume".
  let stuck = paused;
  while (!stuck.gaveUp && stuck.paused === false) {
    // shouldn't normally loop here since runQueue already resolves rate limit
    // fully (auto-retries) in this fake saveFn that always rate-limits '3' -
    // but guard against infinite loop in case of logic drift.
    break;
  }

  // Simulate persisting/reloading the checkpoint (JSON round-trip) as
  // background.js would via chrome.storage.local, then a manual Resume.
  const reloaded = JSON.parse(JSON.stringify(stuck));
  const resumed = prepareResume(reloaded);
  assert.equal(resumed.cursor, 2, 'still positioned at the stuck item (index 2, scannumber 3)');

  const seenSecondRun = [];
  const finalCheckpoint = await runQueue(resumed, {
    saveFn: async (item) => {
      seenSecondRun.push(item.scannumber);
      return { ok: true };
    },
    delayFn: instant,
  });

  assert.equal(finalCheckpoint.cursor, 4);
  assert.deepEqual(seenSecondRun, ['3', '4'], 'never re-saves items 1 and 2, which were already verified');
});

test('cancelling leaves completed items in place and stops before the next one starts', async () => {
  const checkpoint = createCheckpoint({ kind: 'serviceApply', inspectionId: '1', items: items(4), minDelayMs: 0 });
  let completed = 0;

  const result = await runQueue(checkpoint, {
    saveFn: async () => {
      completed += 1;
      return { ok: true };
    },
    delayFn: instant,
    shouldCancel: () => completed >= 2,
  });

  assert.equal(result.cancelled, true);
  assert.equal(result.cursor, 2, 'the two completed saves remain recorded/advanced');
  assert.equal(result.items[0].status, ItemStatus.SAVED);
  assert.equal(result.items[1].status, ItemStatus.SAVED);
  assert.equal(result.items[2].status, ItemStatus.PENDING);
  assert.equal(result.items[3].status, ItemStatus.PENDING);
});

test('summarize reports total/completed/remaining/paused/cancelled/gaveUp and per-status counts', () => {
  let checkpoint = createCheckpoint({ kind: 'batteryApply', inspectionId: '1', items: items(3) });
  checkpoint = advance(checkpoint, { ok: true });
  checkpoint = advance(checkpoint, { ok: false, error: 'boom' });
  const summary = summarize(checkpoint);
  assert.equal(summary.total, 3);
  assert.equal(summary.completed, 2);
  assert.equal(summary.remaining, 1);
  assert.equal(summary.counts[ItemStatus.SAVED], 1);
  assert.equal(summary.counts[ItemStatus.FAILED], 1);
  assert.equal(summary.counts[ItemStatus.PENDING], 1);
});
