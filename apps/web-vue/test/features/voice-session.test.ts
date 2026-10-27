import { createPinia, setActivePinia } from 'pinia';
import { afterEach, expect, test, vi } from 'vitest';

vi.mock('@/features/room/client/media/cues', () => ({ playPeerCue: vi.fn() }));
vi.mock('@/entities/room/room-membership.store', () => ({
  useRoomMembershipStore: () => ({ leaveActiveRoomMembership: vi.fn(async () => true) })
}));

const cues = await import('@/features/room/client/media/cues');
const { useVoiceSessionStore } = await import('@/features/room/voice-session.store');

// One store for the file: a hang-up that is still waiting for its cue finds the handler a later test registered.
setActivePinia(createPinia());
const voice = useVoiceSessionStore();

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(cues.playPeerCue).mockClear();
  voice.clearConnectedVoiceRoom();
});

test('leaving the active call plays the leave cue first and hangs up once it had time to sound', async () => {
  vi.useFakeTimers();
  const hangUp = vi.fn();
  const unregister = voice.registerActiveVoiceLeave(hangUp);

  const leaving = voice.leaveActiveVoiceRoomWithCue();
  expect(cues.playPeerCue).toHaveBeenCalledWith('leave');
  expect(hangUp).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(180);
  await leaving;
  expect(hangUp).toHaveBeenCalledTimes(1);
  unregister();
});

test('without an active call, leaving does nothing and plays no cue', async () => {
  await voice.leaveActiveVoiceRoomWithCue();
  expect(cues.playPeerCue).not.toHaveBeenCalled();
});

test('an unregistered call handler is not replaced by a stale unregister', () => {
  const first = vi.fn();
  const second = vi.fn();
  const unregisterFirst = voice.registerActiveVoiceLeave(first);
  const unregisterSecond = voice.registerActiveVoiceLeave(second);
  unregisterFirst();
  void voice.leaveActiveVoiceRoomWithCue();
  expect(cues.playPeerCue).toHaveBeenCalledWith('leave');
  unregisterSecond();
});

test('clearing the call for another room keeps the current call', () => {
  voice.setConnectedVoiceRoom('room-a');
  voice.setVoiceControlsState({ muted: true, deafened: false });
  voice.clearConnectedVoiceRoom('room-b');
  expect(voice).toMatchObject({ roomId: 'room-a', muted: true });
  voice.clearConnectedVoiceRoom('room-a');
  expect(voice).toMatchObject({ roomId: null, muted: false, deafened: false, joinedAt: null });
});

test('leaving the call from the lobby asks how the call went, a hang-up for another reason does not', async () => {
  const { useCallFeedbackStore } = await import('@/features/call-feedback/call-feedback.store');
  const feedback = useCallFeedbackStore();
  localStorage.clear();
  const call = { roomId: 'kitchen', durationS: 600, peers: 1, platform: 'browser' as const, quality: null };
  const unregister = voice.registerActiveVoiceLeave(() => feedback.noteCallFinished(call));

  await voice.leaveActiveVoiceRoomWithCue();
  expect(feedback.call).toEqual(call);

  feedback.dropCallFeedback();
  localStorage.clear();
  // The room client hangs up by itself (a kick, the page closing): nothing is asked.
  feedback.noteCallFinished(call);
  await Promise.resolve();
  expect(feedback.call).toBeNull();
  unregister();
});
