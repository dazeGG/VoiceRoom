// The room's recovery wiring: a lost LiveKit connection is replaced once the
// app has a current snapshot with this peer in it; a terminal failure is
// raised and reported, ordinary transitions stay quiet.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { ReplacementOutcome } from '@/features/room/client/recovery/realtime-recovery';
import { state } from '@/features/room/client/core/room-runtime.store';
import { createInitialRoomState } from '@/features/room/client/model/room-state';
import {
  invalidateMicrophoneActions,
  requestAutomaticMicrophoneConnectionReplacement,
  setMicrophoneRecoveryObserver,
  startMicrophoneCall,
  type MicrophoneRecoveryEvent
} from '@/features/room/client/ui/devices';

vi.mock('@/entities/room/room-realtime', () => ({
  requestActiveVoiceResync: vi.fn(() => true),
  setActiveVoiceResyncFailureHandler: vi.fn()
}));
vi.mock('@/shared/log', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  reportClientLogs: vi.fn(async () => true)
}));

const { reportClientLogs } = await import('@/shared/log');
const recovery = await import('@/features/room/client/recovery/room-recovery');

beforeEach(() => vi.mocked(reportClientLogs).mockClear());
afterEach(() => {
  recovery.cancelRoomRecovery();
  recovery.setRoomRecoveryLiveKitAdapter(null);
  invalidateMicrophoneActions();
  setMicrophoneRecoveryObserver(null);
  vi.useRealTimers();
});

async function loseLiveKitWithSnapshot(outcome: ReplacementOutcome) {
  const attemptFreshReplacement = vi.fn(async () => outcome);
  recovery.setRoomRecoveryLiveKitAdapter({ attemptFreshReplacement });
  const phases: string[] = [];
  const unsubscribe = recovery.subscribeRoomRecoveryTransitions((event) => phases.push(String(event.phase)));
  recovery.startRoomRecovery(1, true);
  recovery.notifyLiveKitDisconnected();
  recovery.notifyRoomSnapshotApplied({ appEpoch: 1, active: true, hasLocalPeer: true });
  await vi.waitFor(() => expect(attemptFreshReplacement).toHaveBeenCalled());
  await new Promise((resolve) => setTimeout(resolve, 0));
  unsubscribe();
  return { attemptFreshReplacement, phases };
}

test('a lost LiveKit connection is replaced once a current snapshot has this peer', async () => {
  const { attemptFreshReplacement } = await loseLiveKitWithSnapshot({ ok: true });
  expect(attemptFreshReplacement).toHaveBeenCalledWith(expect.objectContaining({ attempt: 1 }));
  expect(reportClientLogs).not.toHaveBeenCalled();
});

test('a terminal failure is reported with its code', async () => {
  const { phases } = await loseLiveKitWithSnapshot({ retryable: false, code: 'room_banned' });
  expect(phases).toContain('failed');
  expect(reportClientLogs).toHaveBeenCalledWith('room recovery failed: room_banned');
});

test('without a LiveKit adapter recovery fails closed instead of hanging', async () => {
  const phases: string[] = [];
  recovery.subscribeRoomRecoveryTransitions((event) => phases.push(String(event.phase)));
  recovery.startRoomRecovery(1, true);
  recovery.notifyLiveKitDisconnected();
  recovery.notifyRoomSnapshotApplied({ appEpoch: 1, active: true, hasLocalPeer: true });
  await vi.waitFor(() => expect(phases).toContain('failed'));
});

test('an epoch is current only for the running recovery', () => {
  const epoch = recovery.startRoomRecovery(1, true);
  expect(recovery.isCurrentRoomRecoveryEpoch(epoch)).toBe(true);
  recovery.cancelRoomRecovery();
  expect(recovery.isCurrentRoomRecoveryEpoch(epoch)).toBe(false);
});

/** A healthy call whose replacement attempts answer `outcome`. */
function healthyCall(outcome: ReplacementOutcome) {
  const attemptFreshReplacement = vi.fn(async () => outcome);
  recovery.setRoomRecoveryLiveKitAdapter({ attemptFreshReplacement });
  const phases: string[] = [];
  const unsubscribe = recovery.subscribeRoomRecoveryTransitions((event) => phases.push(String(event.phase)));
  recovery.startRoomRecovery(1, true);
  recovery.notifyLiveKitReconciled();
  recovery.notifyRoomSnapshotApplied({ appEpoch: 1, active: true, hasLocalPeer: true });
  phases.length = 0;
  return { attemptFreshReplacement, phases, unsubscribe };
}
const snapshot = () => recovery.notifyRoomSnapshotApplied({ appEpoch: 1, active: true, hasLocalPeer: true });

test('asking to replace a standing connection replaces it and says when it is over', async () => {
  const { attemptFreshReplacement, phases, unsubscribe } = healthyCall({ ok: true });
  const replacing = recovery.requestLiveKitReplacement();
  expect(replacing).not.toBeNull();
  expect(attemptFreshReplacement, 'a current snapshot comes first').not.toHaveBeenCalled();
  snapshot();
  await expect(replacing).resolves.toBe(true);
  expect(attemptFreshReplacement).toHaveBeenCalledOnce();
  expect(phases.at(-1)).toBe('healthy');
  unsubscribe();
});

test('a refused replacement of a standing connection fails nothing, and a real drop afterwards still recovers', async () => {
  const { attemptFreshReplacement, phases, unsubscribe } = healthyCall({
    retryable: false,
    code: 'server_mute_unavailable'
  });
  const replacing = recovery.requestLiveKitReplacement();
  snapshot();
  await expect(replacing).resolves.toBe(false);
  expect(phases).not.toContain('failed');
  expect(phases.at(-1)).toBe('healthy');
  expect(reportClientLogs).not.toHaveBeenCalled();

  attemptFreshReplacement.mockResolvedValue({ ok: true });
  recovery.notifyLiveKitDisconnected();
  snapshot();
  await vi.waitFor(() => expect(attemptFreshReplacement).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(phases.at(-1)).toBe('healthy'));
  unsubscribe();
});

test('a connection really lost during an asked replacement fails like any lost connection', async () => {
  const { phases, unsubscribe } = healthyCall({ retryable: false, code: 'room_banned' });
  const replacing = recovery.requestLiveKitReplacement();
  recovery.notifyLiveKitDisconnected();
  snapshot();
  await expect(replacing).resolves.toBe(false);
  expect(phases.at(-1)).toBe('failed');
  expect(reportClientLogs).toHaveBeenCalledWith('room recovery failed: room_banned');
  unsubscribe();
});

test('no replacement is started over a recovery already running, or with no call', async () => {
  const { attemptFreshReplacement, unsubscribe } = healthyCall({ ok: true });
  recovery.notifyLiveKitReconnecting();
  expect(recovery.requestLiveKitReplacement()).toBeNull();
  expect(attemptFreshReplacement).not.toHaveBeenCalled();
  recovery.cancelRoomRecovery();
  expect(recovery.requestLiveKitReplacement()).toBeNull();
  unsubscribe();
});

test('leaving the call ends the wait for a replacement', async () => {
  const { unsubscribe } = healthyCall({ ok: true });
  const replacing = recovery.requestLiveKitReplacement();
  recovery.cancelRoomRecovery();
  await expect(replacing).resolves.toBe(false);
  unsubscribe();
});

test('a replacement abandoned before the request returns still answers that it did not happen', async () => {
  const { requestActiveVoiceResync } = await import('@/entities/room/room-realtime');
  healthyCall({ ok: true }).unsubscribe();
  vi.mocked(requestActiveVoiceResync).mockReturnValueOnce(false);
  await expect(recovery.requestLiveKitReplacement()).resolves.toBe(false);
});

test('a connection that reconnected by itself is not answered as replaced', async () => {
  const { attemptFreshReplacement, unsubscribe } = healthyCall({ ok: true });
  const replacing = recovery.requestLiveKitReplacement();
  recovery.notifyLiveKitReconnecting();
  recovery.notifyLiveKitReconciled();
  await expect(replacing).resolves.toBe(false);
  expect(attemptFreshReplacement).not.toHaveBeenCalled();
  unsubscribe();
});

test('an automatic timeout invalidates only its optional epoch before a late snapshot', async () => {
  vi.useFakeTimers();
  setActivePinia(createPinia());
  Object.assign(state, createInitialRoomState(), { joined: true, muted: false, outputMuted: false });
  startMicrophoneCall();
  const terminal = vi.fn<(event: MicrophoneRecoveryEvent) => void>();
  setMicrophoneRecoveryObserver(terminal);
  const attemptFreshReplacement = vi.fn(async () => ({ ok: true as const }));
  recovery.setRoomRecoveryLiveKitAdapter({ attemptFreshReplacement });
  recovery.startRoomRecovery(1, true);
  recovery.notifyLiveKitReconciled();
  snapshot();

  const replacing = requestAutomaticMicrophoneConnectionReplacement(
    recovery.requestLiveKitReplacement,
    recovery.abandonOptionalLiveKitReplacement
  );
  expect(replacing).not.toBeNull();
  await vi.advanceTimersByTimeAsync(10_000);
  await expect(replacing).resolves.toBe(false);
  expect(terminal).toHaveBeenCalledOnce();
  expect(terminal.mock.calls[0]?.[0].outcome).toBe('timed_out');
  snapshot(); // A response to the optional request cannot start a fresh SDK attempt.
  await vi.advanceTimersByTimeAsync(0);
  expect(attemptFreshReplacement).not.toHaveBeenCalled();

  recovery.notifyLiveKitDisconnected(); // Mandatory recovery remains available.
  snapshot();
  await vi.advanceTimersByTimeAsync(0);
  expect(attemptFreshReplacement).toHaveBeenCalledOnce();
});

test('a running recovery can be waited for, and there is nothing to wait for without one', async () => {
  expect(recovery.roomRecoverySettled(), 'no call').toBeNull();
  const { unsubscribe } = healthyCall({ ok: true });
  expect(recovery.roomRecoverySettled(), 'a healthy call').toBeNull();
  recovery.notifyLiveKitDisconnected();
  const settled = recovery.roomRecoverySettled();
  expect(settled).not.toBeNull();
  let over = false;
  void settled?.then(() => (over = true));
  await Promise.resolve();
  expect(over, 'still recovering').toBe(false);
  snapshot();
  await vi.waitFor(() => expect(over).toBe(true));
  unsubscribe();
});
