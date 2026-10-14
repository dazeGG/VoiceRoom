// Surfaces outside the room feature (the update notice) learn whether a call
// is on from callActivity, which the voice session keeps current.

import { expect, test } from 'vitest';
import { callActivity } from '../../src/lib/shared/call-activity.svelte.ts';
import { clearConnectedVoiceRoom, setConnectedVoiceRoom } from '../../src/lib/features/room/voice-session.svelte.ts';

test('joining a call marks the tab as in a call, and leaving it clears that', () => {
  expect(callActivity.active).toBe(false);
  setConnectedVoiceRoom('room-a');
  expect(callActivity.active).toBe(true);
  // A stale clear for another room keeps the current call.
  clearConnectedVoiceRoom('room-b');
  expect(callActivity.active).toBe(true);
  clearConnectedVoiceRoom('room-a');
  expect(callActivity.active).toBe(false);
});
