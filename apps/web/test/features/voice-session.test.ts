import { afterEach, expect, test, vi } from 'vitest';

vi.mock('../../src/lib/features/room/client/media/cues', () => ({ playPeerCue: vi.fn() }));
vi.mock('../../src/lib/features/home/model/room-membership.svelte', () => ({
  leaveActiveRoomMembership: vi.fn(async () => true)
}));

const cues = await import('../../src/lib/features/room/client/media/cues');
const voice = await import('../../src/lib/features/room/voice-session.svelte.ts');

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
  expect(voice.voiceSession).toMatchObject({ roomId: 'room-a', muted: true });
  voice.clearConnectedVoiceRoom('room-a');
  expect(voice.voiceSession).toMatchObject({ roomId: null, muted: false, deafened: false, joinedAt: null });
});
