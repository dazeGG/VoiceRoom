import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  RealtimeRecoveryController,
  classifyRecoveryFailure,
  sanitizeRecoveryCode,
  type RealtimeRecoveryOptions,
  type ReplacementOutcome
} from '@/features/room/client/recovery/realtime-recovery';

function deferred() {
  let resolve = (_outcome: ReplacementOutcome) => {};
  const promise = new Promise<ReplacementOutcome>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fakeClock() {
  let now = 0;
  let id = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  return {
    now: () => now,
    setTimeout: (callback: () => void, delay: number) => {
      const timerId = ++id;
      timers.set(timerId, { at: now + delay, callback });
      return timerId;
    },
    clearTimeout: (timerId: unknown) => {
      if (typeof timerId === 'number') timers.delete(timerId);
    },
    advance(ms: number) {
      now += ms;
      const due = () => [...timers.entries()].filter(([, timer]) => timer.at <= now).sort((a, b) => a[1].at - b[1].at);
      for (let ready = due(); ready.length > 0; ready = due()) {
        for (const [timerId, timer] of ready) {
          timers.delete(timerId);
          timer.callback();
        }
      }
    },
    pending: () => timers.size
  };
}

function createController(overrides: Partial<RealtimeRecoveryOptions> & { clock?: ReturnType<typeof fakeClock> } = {}) {
  const clock = overrides.clock ?? fakeClock();
  const snapshots: unknown[] = [];
  const attempts: unknown[] = [];
  const transitions: unknown[] = [];
  const controller = new RealtimeRecoveryController({
    attemptReplacement: async (context) => {
      attempts.push(context);
      return { ok: true };
    },
    requestAppSnapshot: (context) => {
      snapshots.push(context);
    },
    onTransition: (event) => transitions.push(event),
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    random: () => 1,
    ...overrides
  });
  controller.activate({ appEpoch: 4, appConnected: true });
  return { controller, clock, snapshots, attempts, transitions };
}

test('activation is not healthy before either bootstrap authority is ready', () => {
  const { controller } = createController();
  assert.equal(controller.getSnapshot().phase, 'waiting-app-snapshot');
  assert.equal(controller.getSnapshot().snapshotReady, false);
  assert.equal(controller.getSnapshot().livekitReady, false);
});

test('current active snapshot alone waits for explicit LiveKit reconciliation', () => {
  const { controller } = createController();
  controller.appSnapshotApplied({ appEpoch: 4, active: true, hasLocalPeer: true });
  assert.equal(controller.getSnapshot().phase, 'waiting-livekit');
  assert.equal(controller.getSnapshot().livekitReady, false);
});

test('LiveKit reconciliation alone waits for current active snapshot', () => {
  const { controller } = createController();
  controller.livekitReconciled();
  assert.equal(controller.getSnapshot().phase, 'waiting-app-snapshot');
  assert.equal(controller.getSnapshot().snapshotReady, false);
});

test('bootstrap becomes healthy after both authorities in either order', () => {
  const snapshotFirst = createController().controller;
  snapshotFirst.appSnapshotApplied({ appEpoch: 4, active: true, hasLocalPeer: true });
  snapshotFirst.livekitReconciled();
  assert.equal(snapshotFirst.getSnapshot().phase, 'healthy');

  const liveKitFirst = createController().controller;
  liveKitFirst.livekitReconciled();
  liveKitFirst.appSnapshotApplied({ appEpoch: 4, active: true, hasLocalPeer: true });
  assert.equal(liveKitFirst.getSnapshot().phase, 'healthy');
});

test('fresh replacement is gated by a current active snapshot containing the local peer', async () => {
  const { controller, snapshots, attempts } = createController();

  controller.livekitDisconnected();
  controller.livekitDisconnected();
  assert.equal(snapshots.length, 1);
  assert.equal(attempts.length, 0);
  assert.equal(controller.appSnapshotApplied({ appEpoch: 3, active: true, hasLocalPeer: true }), false);
  assert.equal(controller.appSnapshotApplied({ appEpoch: 4, active: false, hasLocalPeer: true }), false);
  assert.equal(controller.appSnapshotApplied({ appEpoch: 4, active: true, hasLocalPeer: false }), false);
  assert.equal(attempts.length, 0);

  assert.equal(controller.appSnapshotApplied({ appEpoch: 4, active: true, hasLocalPeer: true }), true);
  assert.equal(attempts.length, 1);
  controller.appSnapshotApplied({ appEpoch: 4, active: true, hasLocalPeer: true });
  assert.equal(attempts.length, 1);
  await Promise.resolve();
  assert.equal(controller.getSnapshot().phase, 'healthy');
});

test('retry budget is single-flight, bounded, and autonomously probes after cooldown', async () => {
  const clock = fakeClock();
  let calls = 0;
  const { controller, snapshots } = createController({
    clock,
    maxAttempts: 2,
    retryDelaysMs: [500],
    cooldownMs: 1_000,
    attemptReplacement: async () => {
      calls += 1;
      return { retryable: true, status: 503, code: 'livekit_gate_unavailable' };
    }
  });

  controller.livekitDisconnected();
  controller.appSnapshotApplied({ appEpoch: 4, active: true, hasLocalPeer: true });
  await Promise.resolve();
  assert.equal(calls, 1);
  clock.advance(500);
  await Promise.resolve();
  assert.equal(calls, 2);
  await Promise.resolve();
  assert.equal(controller.getSnapshot().phase, 'failed');

  controller.livekitDisconnected();
  controller.appWsLost(4);
  controller.appWsRestored(4);
  controller.appSnapshotApplied({ appEpoch: 4, active: true, hasLocalPeer: true });
  assert.equal(calls, 2);
  assert.equal(controller.getSnapshot().phase, 'failed');
  clock.advance(1_000);
  assert.equal(controller.getSnapshot().phase, 'waiting-app-snapshot');
  assert.equal(snapshots.length, 2);
  controller.appSnapshotApplied({ appEpoch: 4, active: true, hasLocalPeer: true });
  assert.equal(calls, 3);
});

test('snapshot timeout enters cooldown and probes again without a network edge', () => {
  const clock = fakeClock();
  const { controller, snapshots } = createController({ clock, cooldownMs: 1_000 });

  controller.livekitDisconnected();
  assert.equal(snapshots.length, 1);
  controller.appSnapshotRequestFailed({ code: 'transport_error' });
  assert.equal(controller.getSnapshot().phase, 'failed');

  clock.advance(1_000);
  assert.equal(controller.getSnapshot().phase, 'waiting-app-snapshot');
  assert.equal(snapshots.length, 2);
});

test('recovery timers invoke injected schedulers without rebinding their receiver', () => {
  const receivers: unknown[] = [];
  const controller = new RealtimeRecoveryController({
    attemptReplacement: async () => ({ ok: true }),
    requestAppSnapshot: () => true,
    setTimeout(callback) {
      receivers.push(this);
      return { callback };
    },
    clearTimeout() {}
  });
  controller.activate({ appEpoch: 1, appConnected: true });
  controller.livekitDisconnected();
  controller.appSnapshotRequestFailed({ code: 'transport_error' });
  assert.notEqual(receivers.length, 0);
  assert.equal(receivers.at(-1), undefined);
});

test('a later transport regression invalidates an in-place reconcile completion', async () => {
  const { LiveKitReconcileGeneration } = await import('@/features/room/client/recovery/livekit-reconcile-generation');
  const generation = new LiveKitReconcileGeneration();
  const reconnected = generation.capture();
  generation.invalidate();
  assert.equal(generation.isCurrent(reconnected), false);
  const laterReconnect = generation.capture();
  assert.equal(generation.isCurrent(laterReconnect), true);
});

test('stale replacement completion cannot revive a cancelled or newer recovery epoch', async () => {
  const attempt = deferred();
  const { controller } = createController({ attemptReplacement: () => attempt.promise });
  controller.livekitDisconnected();
  controller.appSnapshotApplied({ appEpoch: 4, active: true, hasLocalPeer: true });
  assert.equal(controller.getSnapshot().inFlight, true);
  controller.cancel();
  attempt.resolve({ ok: true });
  await Promise.resolve();
  assert.equal(controller.getSnapshot().phase, 'cancelled');
});

test('app transport loss invalidates an in-flight replacement epoch', async () => {
  const first = deferred();
  let calls = 0;
  const { controller } = createController({
    attemptReplacement: () => {
      calls += 1;
      return calls === 1 ? first.promise : Promise.resolve({ ok: true });
    }
  });
  controller.livekitDisconnected();
  controller.appSnapshotApplied({ appEpoch: 4, active: true, hasLocalPeer: true });
  const staleEpoch = controller.getSnapshot().epoch;
  controller.appWsLost(4);
  assert.equal(controller.isCurrent(staleEpoch), false);
  first.resolve({ ok: true });
  await Promise.resolve();
  assert.equal(controller.getSnapshot().phase, 'waiting-app-snapshot');

  controller.appWsRestored(5);
  controller.appSnapshotApplied({ appEpoch: 5, active: true, hasLocalPeer: true });
  assert.equal(calls, 2);
});

test('authoritative snapshot received during cooldown is retained for a later meaningful rearm', async () => {
  const clock = fakeClock();
  let calls = 0;
  const { controller } = createController({
    clock,
    maxAttempts: 1,
    cooldownMs: 1_000,
    attemptReplacement: async () => {
      calls += 1;
      return { retryable: true, status: 503, code: 'membership_unavailable' };
    }
  });
  controller.livekitDisconnected();
  controller.appSnapshotApplied({ appEpoch: 4, active: true, hasLocalPeer: true });
  await Promise.resolve();
  assert.equal(controller.getSnapshot().phase, 'failed');

  controller.appWsRestored(5);
  controller.appSnapshotApplied({ appEpoch: 5, active: true, hasLocalPeer: true });
  clock.advance(1_000);
  assert.equal(calls, 2);
  assert.equal(controller.getSnapshot().phase, 'waiting-livekit');
});

test('initial app connection does not replay a queued join, later connection epochs request one snapshot', () => {
  const clock = fakeClock();
  const snapshots: unknown[] = [];
  const controller = new RealtimeRecoveryController({
    attemptReplacement: async () => ({ ok: true }),
    requestAppSnapshot: (context) => {
      snapshots.push(context);
    },
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout
  });
  controller.activate({ appEpoch: 0, appConnected: false });
  controller.appWsRestored(1);
  assert.equal(snapshots.length, 0);
  controller.appWsLost(1);
  controller.appWsRestored(2);
  assert.equal(snapshots.length, 0);
  assert.equal(controller.appSnapshotApplied({ appEpoch: 1, active: true, hasLocalPeer: true }), false);
});

test('API failure classification is stable and fails unknown HTTP errors closed', () => {
  assert.deepEqual(classifyRecoveryFailure({ status: 503, code: 'livekit_gate_unavailable' }), {
    retryable: true,
    result: 'retryable',
    status: 503,
    code: 'livekit_gate_unavailable'
  });
  assert.equal(classifyRecoveryFailure({ status: 503, code: 'invalid_session' }).retryable, false);
  // A LiveKit token asked for before the realtime re-join lands is retried.
  assert.deepEqual(classifyRecoveryFailure({ status: 409, code: 'not_in_room' }), {
    retryable: true,
    result: 'retryable',
    status: 409,
    code: 'not_in_room'
  });
  assert.equal(classifyRecoveryFailure({ status: 418, code: 'surprise' }).retryable, false);
  assert.equal(classifyRecoveryFailure(new TypeError('fetch failed')).retryable, true);
  assert.equal(sanitizeRecoveryCode('token=secret'), 'unknown_error');
});

test('a request that got no answer during recovery is retried and logged as unavailable', () => {
  assert.deepEqual(classifyRecoveryFailure({ status: 0, code: 'unavailable' }), {
    retryable: true,
    result: 'retryable',
    status: 0,
    code: 'unavailable'
  });
  assert.equal(sanitizeRecoveryCode('unavailable'), 'unavailable');
});

test('an asked replacement that keeps failing keeps the standing connection and leaves no timer behind', async () => {
  const made: unknown[] = [];
  const { controller, clock } = createController({
    attemptReplacement: async (context) => {
      made.push(context);
      return { retryable: true, code: 'internal', status: 503 };
    },
    maxAttempts: 2,
    retryDelaysMs: [100]
  });
  controller.appSnapshotApplied({ appEpoch: 4, active: true, hasLocalPeer: true });
  controller.livekitReconciled();
  assert.equal(controller.requestLiveKitReplacement(), true);
  controller.appSnapshotApplied({ appEpoch: 4, active: true, hasLocalPeer: true });
  await new Promise((resolve) => setTimeout(resolve, 0));
  clock.advance(100);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(made.length, 2);
  const after = controller.getSnapshot();
  assert.equal(after.phase, 'healthy');
  assert.equal(after.livekitReady, true);
  assert.equal(after.snapshotReady, true);
  assert.equal(clock.pending(), 0, 'no cooldown would try again on a microphone that has recovered');
});

test('an asked replacement whose snapshot is refused keeps the standing connection', () => {
  const { controller } = createController();
  controller.appSnapshotApplied({ appEpoch: 4, active: true, hasLocalPeer: true });
  controller.livekitReconciled();
  controller.requestLiveKitReplacement();
  controller.appSnapshotRequestFailed({ code: 'invalid_session' });
  assert.equal(controller.getSnapshot().phase, 'healthy');
  assert.equal(controller.getSnapshot().livekitReady, true);
});

test('a resync still retrying when the app connection went away fails nothing: the call waits for its socket', () => {
  const { controller } = createController();
  controller.appSnapshotApplied({ appEpoch: 4, active: true, hasLocalPeer: true });
  controller.livekitReconciled();
  controller.requestLiveKitReplacement();
  controller.appWsLost(4);
  controller.appSnapshotRequestFailed({ code: 'transport_error' });
  assert.equal(controller.getSnapshot().phase, 'waiting-app-snapshot');
  controller.appWsRestored(5);
  controller.appSnapshotApplied({ appEpoch: 5, active: true, hasLocalPeer: true });
  assert.equal(controller.getSnapshot().phase, 'healthy');
});

function healthy(overrides: Parameters<typeof createController>[0] = {}) {
  const made = createController(overrides);
  made.controller.appSnapshotApplied({ appEpoch: 4, active: true, hasLocalPeer: true });
  made.controller.livekitReconciled();
  return made;
}

test('a resync failing after its replacement was abandoned does not fail a healthy call', () => {
  const { controller, clock } = healthy();
  controller.requestLiveKitReplacement();
  controller.appSnapshotRequestFailed({ code: 'invalid_session' });
  assert.equal(controller.getSnapshot().phase, 'healthy');
  controller.appSnapshotRequestFailed({ code: 'transport_error' });
  assert.equal(controller.getSnapshot().phase, 'healthy');
  assert.equal(clock.pending(), 0);
});

test('the app connection going away ends an asked replacement: none fires when it is back', async () => {
  const { controller, attempts } = healthy();
  controller.requestLiveKitReplacement();
  controller.appWsLost(4);
  controller.appWsRestored(5);
  controller.appSnapshotApplied({ appEpoch: 5, active: true, hasLocalPeer: true });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(attempts.length, 0);
  assert.equal(controller.getSnapshot().phase, 'healthy');
});

test('an attempt still running when its replacement is abandoned may not take over', async () => {
  const pending = deferred();
  const { controller } = healthy({ attemptReplacement: () => pending.promise });
  controller.requestLiveKitReplacement();
  controller.appSnapshotApplied({ appEpoch: 4, active: true, hasLocalPeer: true });
  const attemptEpoch = controller.getSnapshot().epoch;
  assert.equal(controller.isCurrent(attemptEpoch), true);
  controller.appSnapshotRequestFailed({ code: 'invalid_session' });
  assert.equal(controller.isCurrent(attemptEpoch), false);
  pending.resolve({ ok: true });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(controller.getSnapshot().phase, 'healthy');
});

test('a snapshot without this peer ends an asked replacement instead of leaving it waiting', () => {
  const { controller, attempts } = healthy();
  controller.requestLiveKitReplacement();
  assert.equal(controller.appSnapshotApplied({ appEpoch: 4, active: true, hasLocalPeer: false }), false);
  assert.equal(controller.getSnapshot().phase, 'healthy');
  assert.equal(attempts.length, 0);
});

test('a real drop right after an asked replacement was reconciled gets its own snapshot request', async () => {
  const keys = new Set<number>();
  const { controller, attempts } = healthy({
    requestAppSnapshot: ({ epoch }) => {
      // As the room's realtime does: one request per recovery epoch.
      if (keys.has(epoch)) return false;
      keys.add(epoch);
      return true;
    }
  });
  controller.requestLiveKitReplacement();
  controller.livekitReconciled();
  controller.livekitDisconnected();
  assert.notEqual(controller.getSnapshot().phase, 'failed');
  controller.appSnapshotApplied({ appEpoch: 4, active: true, hasLocalPeer: true });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(attempts.length, 1);
  assert.equal(controller.getSnapshot().phase, 'healthy');
});

test('offline and back with both connections standing is healthy again, and may be replaced', () => {
  const { controller } = healthy();
  controller.networkOffline();
  assert.equal(controller.requestLiveKitReplacement(), false);
  controller.networkOnline();
  assert.equal(controller.getSnapshot().phase, 'healthy');
  assert.equal(controller.requestLiveKitReplacement(), true);
});

test('a connection that reconnects by itself ends an asked replacement, and its attempt may not take over', async () => {
  const pending = deferred();
  const { controller } = healthy({ attemptReplacement: () => pending.promise });
  controller.requestLiveKitReplacement();
  controller.appSnapshotApplied({ appEpoch: 4, active: true, hasLocalPeer: true });
  const attemptEpoch = controller.getSnapshot().epoch;
  controller.livekitReconnecting();
  controller.livekitReconciled();
  assert.equal(controller.getSnapshot().phase, 'healthy');
  assert.equal(controller.isCurrent(attemptEpoch), false);
  pending.resolve({ ok: true });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(controller.getSnapshot().phase, 'healthy');
});

test('a preview of the same room says nothing of the call: the asked replacement goes on', async () => {
  const { controller, attempts } = healthy();
  controller.requestLiveKitReplacement();
  assert.equal(controller.appSnapshotApplied({ appEpoch: 4, active: false, hasLocalPeer: false }), false);
  assert.equal(controller.getSnapshot().phase, 'waiting-app-snapshot');
  controller.appSnapshotApplied({ appEpoch: 4, active: true, hasLocalPeer: true });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(attempts.length, 1);
  assert.equal(controller.getSnapshot().phase, 'healthy');
});

test('abandoning with the app connection down leaves a later real drop all its attempts', () => {
  const pending = deferred();
  const { controller } = healthy({ attemptReplacement: () => pending.promise });
  controller.requestLiveKitReplacement();
  controller.appSnapshotApplied({ appEpoch: 4, active: true, hasLocalPeer: true });
  assert.equal(controller.getSnapshot().attempts, 1);
  controller.appWsLost(4);
  assert.equal(controller.getSnapshot().attempts, 0);
});

test('a real drop after an asked replacement went through, before its snapshot, gets a snapshot request of its own', async () => {
  const pending = deferred();
  const asked = new Set<number>();
  const { controller } = healthy({
    attemptReplacement: () => pending.promise,
    requestAppSnapshot: ({ epoch }) => {
      // As the room's realtime does: one request per recovery epoch.
      if (asked.has(epoch)) return false;
      asked.add(epoch);
      return true;
    }
  });
  controller.requestLiveKitReplacement();
  controller.appSnapshotApplied({ appEpoch: 4, active: true, hasLocalPeer: true });
  controller.appWsRestored(5);
  pending.resolve({ ok: true });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(controller.getSnapshot().phase, 'waiting-app-snapshot');
  controller.livekitDisconnected();
  assert.equal(controller.getSnapshot().phase, 'waiting-app-snapshot');
  assert.equal(asked.size, 2);
});
