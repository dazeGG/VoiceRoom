// The focus-trap case of the Svelte test is not ported: focus-trap.ts is not ported, the Vue Dialog
// uses Reka's focus scope and its focus return is covered by dialog.test.ts.

import { createPinia, setActivePinia } from 'pinia';
import { render, screen } from '@testing-library/vue';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import RoomCallTimer from '@/features/room/components/RoomCallTimer.vue';
import { bindDesktopSystem } from '@/platform/desktop-system';
import { useVoiceSessionStore } from '@voiceroom/call/engine/core/voice-session.store';

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

test('the call timer stops ticking under a game and catches up when visible', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-24T12:00:00Z'));
  useVoiceSessionStore().setVoiceSessionTiming({ joinedAt: Date.now() - 5_000, roomActiveSince: Date.now() - 5_000 });
  let pushState: (payload: unknown) => void = () => {};
  vi.stubGlobal('voiceRoomDesktopSystem', {
    onState(handler: typeof pushState) {
      pushState = handler;
    }
  });
  const unbind = bindDesktopSystem({ onWake: () => {} });
  const view = render(RoomCallTimer);
  try {
    expect(screen.getByText('0:05')).toBeTruthy();
    const ticking = vi.getTimerCount();
    pushState({ windowVisible: true, windowCovered: true });
    expect(vi.getTimerCount()).toBe(ticking - 1);
    await vi.advanceTimersByTimeAsync(7_000);
    expect(screen.getByText('0:05')).toBeTruthy();
    pushState({ windowVisible: true, windowCovered: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByText('0:12')).toBeTruthy();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(screen.getByText('0:13')).toBeTruthy();
  } finally {
    view.unmount();
    unbind();
    vi.unstubAllGlobals();
  }
});
