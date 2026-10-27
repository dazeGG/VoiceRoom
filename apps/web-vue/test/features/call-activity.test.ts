// Surfaces outside the room feature (the update notice) learn whether a call
// is on from callActivity, which the voice session keeps current.

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, expect, test } from 'vitest';
import { useCallActivityStore } from '@/shared/call-activity.store';
import { useVoiceSessionStore } from '@/features/room/voice-session.store';

beforeEach(() => setActivePinia(createPinia()));

test('joining a call marks the tab as in a call, and leaving it clears that', () => {
  const callActivity = useCallActivityStore();
  const { clearConnectedVoiceRoom, setConnectedVoiceRoom } = useVoiceSessionStore();
  expect(callActivity.active).toBe(false);
  setConnectedVoiceRoom('room-a');
  expect(callActivity.active).toBe(true);
  // A stale clear for another room keeps the current call.
  clearConnectedVoiceRoom('room-b');
  expect(callActivity.active).toBe(true);
  clearConnectedVoiceRoom('room-a');
  expect(callActivity.active).toBe(false);
});
