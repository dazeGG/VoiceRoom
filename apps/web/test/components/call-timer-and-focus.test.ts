import { cleanup, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import RoomCallTimer from '../../src/lib/features/room/components/RoomCallTimer.svelte';
import { clearConnectedVoiceRoom, setVoiceSessionTiming } from '../../src/lib/features/room/voice-session.svelte.ts';
import { dialogFocusTrap } from '../../src/lib/shared/ui/focus-trap.ts';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  clearConnectedVoiceRoom();
});

test('the call timer counts from when the room call started on the server', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-24T12:00:00Z'));
  setVoiceSessionTiming({ joinedAt: Date.now() - 5_000, roomActiveSince: Date.now() - 65_000 });
  render(RoomCallTimer);
  expect(screen.getByLabelText('Длительность звонка 1:05')).toBeTruthy();

  await vi.advanceTimersByTimeAsync(3_600_000);
  expect(screen.getByText('1:01:05')).toBeTruthy();
});

test('without a running call there is no timer', () => {
  render(RoomCallTimer);
  expect(document.querySelector('.room-call-timer')).toBeNull();
});

test('a dialog focus trap focuses the marked element, keeps Tab inside and returns focus to the opener', async () => {
  const opener = document.createElement('button');
  opener.textContent = 'Открыть';
  document.body.append(opener);
  opener.focus();

  const dialog = document.createElement('div');
  dialog.innerHTML = '<button>Первая</button><input data-dialog-initial-focus aria-label="Имя" /><button>Последняя</button>';
  document.body.append(dialog);
  const trap = dialogFocusTrap(dialog);
  await Promise.resolve();
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Имя');

  (dialog.querySelectorAll('button')[1] as HTMLElement).focus();
  await userEvent.tab();
  expect(document.activeElement?.textContent).toBe('Первая');
  await userEvent.tab({ shift: true });
  expect(document.activeElement?.textContent).toBe('Последняя');

  trap.destroy();
  await Promise.resolve();
  expect(document.activeElement).toBe(opener);
  dialog.remove();
  opener.remove();
});
