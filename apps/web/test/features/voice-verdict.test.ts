// The server judges the room's voice from everyone's stats polls and tells each
// peer its own verdict; the room keeps it for the connection pill.

import { beforeEach, expect, test } from 'vitest';
import { state } from '@/features/room/client/core/room-runtime.store';
import { createInitialRoomState } from '@/features/room/client/model/room-state';
import { createVoiceEventHandler } from '@/features/room/client/room/voice-events';

const handle = createVoiceEventHandler({ leaveRoom: () => {}, showModeration: () => {}, showNotFound: () => {} });
const verdict = (peerId: string, level: 'good' | 'unstable' | 'bad' | null, cause: 'heard_badly' | null) =>
  handle({ type: 'room.voice.quality', payload: { roomId: 'kitchen', peerId, level, cause } });

beforeEach(() => {
  Object.assign(state, createInitialRoomState(), { roomId: 'kitchen', peerId: 'peer-self-1' });
});

test("the room keeps the server's verdict on its own voice, and nothing known clears it", async () => {
  await verdict('peer-self-1', 'bad', 'heard_badly');
  expect(state.voiceQuality).toEqual({ level: 'bad', cause: 'heard_badly' });

  // Another seat's verdict is not ours.
  await verdict('peer-other-1', 'good', null);
  expect(state.voiceQuality).toEqual({ level: 'bad', cause: 'heard_badly' });

  await verdict('peer-self-1', null, null);
  expect(state.voiceQuality).toBeNull();
});
