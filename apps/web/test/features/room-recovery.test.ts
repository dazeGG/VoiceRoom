// The room's recovery wiring: a lost LiveKit connection is replaced once the
// app has a current snapshot with this peer in it; a terminal failure is
// raised and reported, ordinary transitions stay quiet.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ReplacementOutcome } from '@/features/room/client/recovery/realtime-recovery';

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
