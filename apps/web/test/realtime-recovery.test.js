import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  RealtimeRecoveryController,
  classifyRecoveryFailure,
  sanitizeRecoveryCode
} from '../src/lib/features/room/client/recovery/realtime-recovery.js';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function fakeClock() {
  let now = 0;
  let id = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(callback, delay) {
      const timerId = ++id;
      timers.set(timerId, { at: now + delay, callback });
      return timerId;
    },
    clearTimeout(timerId) {
      timers.delete(timerId);
    },
    advance(ms) {
      now += ms;
      let ready;
      do {
        ready = [...timers.entries()].filter(([, timer]) => timer.at <= now).sort((a, b) => a[1].at - b[1].at);
        for (const [timerId, timer] of ready) {
          timers.delete(timerId);
          timer.callback();
        }
      } while (ready.length > 0);
    },
    pending: () => timers.size
  };
}

function createController(overrides = {}) {
  const clock = overrides.clock ?? fakeClock();
  const snapshots = [];
  const attempts = [];
  const transitions = [];
  const controller = new RealtimeRecoveryController({
    attemptReplacement: async (context) => {
      attempts.push(context);
      return { ok: true };
    },
    requestAppSnapshot: (context) => snapshots.push(context),
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
  let receiver = null;
  const controller = new RealtimeRecoveryController({
    attemptReplacement: async () => ({ ok: true }),
    requestAppSnapshot: () => true,
    setTimeout(callback) {
      receiver = this;
      return { callback };
    },
    clearTimeout() {}
  });
  controller.activate({ appEpoch: 1, appConnected: true });
  controller.livekitDisconnected();
  controller.appSnapshotRequestFailed({ code: 'transport_error' });
  assert.equal(receiver, undefined);
});

test('a later transport regression invalidates an in-place reconcile completion', async () => {
  const { LiveKitReconcileGeneration } = await import('../src/lib/features/room/client/recovery/livekit-reconcile-generation.js');
  const generation = new LiveKitReconcileGeneration();
  const reconnected = generation.capture();
  generation.invalidate();
  assert.equal(generation.isCurrent(reconnected), false);
  const laterReconnect = generation.capture();
  assert.equal(generation.isCurrent(laterReconnect), true);
});

test('web recovery wiring pins replacement identity and correlates bounded resync retries', () => {
  const realtime = fs.readFileSync(new URL('../src/lib/api/realtime.ts', import.meta.url), 'utf8');
  const roomRealtime = fs.readFileSync(new URL('../src/lib/features/home/model/room-realtime.ts', import.meta.url), 'utf8');
  const livekit = fs.readFileSync(new URL('../src/lib/features/room/client/services/livekit-service.ts', import.meta.url), 'utf8');

  assert.match(realtime, /this\.reconnectTimer !== null[\s\S]{0,160}clearTimeout\(this\.reconnectTimer\)/);
  assert.match(realtime, /generation !== this\.openGeneration/);
  assert.match(roomRealtime, /voice-resync-\$\{appEpoch\}/);
  assert.match(roomRealtime, /pending\.attempts < 3/);
  assert.match(roomRealtime, /code: 'transport_error'/);
  assert.match(roomRealtime, /event\.id === pending\.requestId/);
  assert.match(roomRealtime, /event\.payload\.id === pending\.requestId/);
  assert.match(livekit, /state\.sessionToken === sessionToken/);
  assert.match(livekit, /state\.localScreenStream === screenStream/);
  assert.match(livekit, /screenTrackIds/);
  assert.match(livekit, /oldRoom\) reconcileGenerationFor\(oldRoom\)\.invalidate\(\)/);
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
  const snapshots = [];
  const controller = new RealtimeRecoveryController({
    attemptReplacement: async () => ({ ok: true }),
    requestAppSnapshot: (context) => snapshots.push(context),
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout
  });
  controller.activate({ appEpoch: 0, appConnected: false });
  controller.appWsRestored(1);
  assert.equal(snapshots.length, 0);
  controller.appWsLost(1);
  controller.appWsRestored(2);
  assert.deepEqual(snapshots, []);
  assert.equal(controller.appSnapshotApplied({ appEpoch: 1, active: true, hasLocalPeer: true }), false);
});

test('API failure classification is stable and fails unknown HTTP errors closed', () => {
  assert.deepEqual(classifyRecoveryFailure({ status: 503, code: 'livekit_gate_unavailable' }), {
    retryable: true, result: 'retryable', status: 503, code: 'livekit_gate_unavailable'
  });
  assert.equal(classifyRecoveryFailure({ status: 503, code: 'invalid_session' }).retryable, false);
  assert.equal(classifyRecoveryFailure({ status: 418, code: 'surprise' }).retryable, false);
  assert.equal(classifyRecoveryFailure(new TypeError('fetch failed')).retryable, true);
  assert.equal(sanitizeRecoveryCode('token=secret'), 'unknown_error');
});

test('room recovery wiring uses app epochs and applied active snapshot authority', () => {
  const realtime = fs.readFileSync(new URL('../src/lib/api/realtime.ts', import.meta.url), 'utf8');
  const roomRealtime = fs.readFileSync(new URL('../src/lib/features/home/model/room-realtime.ts', import.meta.url), 'utf8');
  const room = fs.readFileSync(new URL('../src/lib/features/room/client/room/room.ts', import.meta.url), 'utf8');

  assert.match(realtime, /this\.connectionEpoch \+= 1/);
  assert.match(realtime, /restore\(this\.connectionEpoch\)/);
  assert.match(roomRealtime, /connectionEpoch <= lastRestoreEpoch/);
  assert.match(roomRealtime, /requestActiveVoiceResync\(recoveryEpoch: number, appEpoch: number\)/);
  assert.match(room, /notifyRoomSnapshotApplied\([\s\S]*active: snapshot\.mode === 'active'[\s\S]*hasLocalPeer: Boolean\(localPeer\)/);
  assert.match(room, /connectLiveKitRoom\([\s\S]*notifyLiveKitReconciled\(\)/);
  assert.doesNotMatch(room, /event\.type === 'pong'[\s\S]{0,200}notifyRoomSnapshotApplied/);
});
