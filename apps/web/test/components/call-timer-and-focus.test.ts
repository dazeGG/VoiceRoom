// The focus-trap case of the Svelte test is not ported: focus-trap.ts is not ported, the Vue Dialog
// uses Reka's focus scope and its focus return is covered by dialog.test.ts.

import { createPinia, setActivePinia } from 'pinia';
import { render, screen } from '@testing-library/vue';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import RoomCallTimer from '@/features/room/components/RoomCallTimer.vue';
import { useVoiceSessionStore } from '@/features/room/voice-session.store';

beforeEach(() => {
  setActivePinia(createPinia());
});

afterEach(() => {
  vi.useRealTimers();
});

test('the call timer counts from when the room call started on the server', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-24T12:00:00Z'));
  useVoiceSessionStore().setVoiceSessionTiming({ joinedAt: Date.now() - 5_000, roomActiveSince: Date.now() - 65_000 });
  render(RoomCallTimer);
  expect(screen.getByLabelText('Длительность звонка 1:05')).toBeTruthy();

  await vi.advanceTimersByTimeAsync(3_600_000);
  expect(screen.getByText('1:01:05')).toBeTruthy();
});

test('without a running call there is no timer', () => {
  render(RoomCallTimer);
  expect(document.querySelector('.room-call-timer')).toBeNull();
});
