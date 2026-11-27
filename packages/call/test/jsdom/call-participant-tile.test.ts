import { fireEvent, render, screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { ParticipantTile } from '@voiceroom/call/views';

test('a disconnected participant presents a placeholder until active media and actions return', async () => {
  const view = render(ParticipantTile, {
    props: {
      participant: {
        id: 'friend',
        name: 'Аня',
        isLocal: false,
        speaking: true,
        muted: true,
        deafened: true,
        screen: true,
        cameraStream: null,
        statusLabel: 'Говорит'
      },
      avatar: { initials: 'А', src: null, background: 'var(--avatar-blue-bg)', foreground: 'var(--avatar-blue-ink)' },
      state: 'reconnecting',
      viewing: false,
      mirrored: false,
      screenRequesting: false
    }
  });
  const heading = screen.getByRole('heading', { name: 'Аня' });
  expect(screen.getByRole('status').textContent).toBe('Подключаемся…');
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.queryByText('Говорит')).toBeNull();
  expect(screen.queryByTitle('Микрофон выключен')).toBeNull();
  expect(screen.queryByTitle('Звук выключен')).toBeNull();
  expect(view.container.firstElementChild?.classList.contains('participant--speaking')).toBe(false);

  await view.rerender({ state: 'absent' });
  expect(screen.getByRole('status').textContent).toBe('Не в звонке');
  expect(screen.getByRole('heading', { name: 'Аня' })).toBe(heading);

  await view.rerender({ state: 'connected' });
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.getByText('Говорит')).toBeTruthy();
  expect(screen.getByTitle('Микрофон выключен')).toBeTruthy();
  expect(screen.getByTitle('Звук выключен')).toBeTruthy();
  expect(view.container.firstElementChild?.classList.contains('participant--speaking')).toBe(true);
  await view.rerender({ staticTile: true });
  expect(screen.getAllByRole('button')).toHaveLength(1);
  await userEvent.click(screen.getByRole('button', { name: 'Смотреть экран' }));
  expect(view.emitted('watchScreen')).toEqual([[]]);
});

test('a static tile opens an opted-in context menu without activating', async () => {
  const view = render(ParticipantTile, {
    props: {
      participant: {
        id: 'friend',
        name: 'Аня',
        isLocal: false,
        speaking: false,
        muted: false,
        deafened: false,
        screen: false,
        cameraStream: null,
        statusLabel: ''
      },
      avatar: { initials: 'А', src: null, background: 'var(--avatar-blue-bg)', foreground: 'var(--avatar-blue-ink)' },
      viewing: false,
      mirrored: false,
      screenRequesting: false,
      staticTile: true
    }
  });
  const tile = view.container.firstElementChild;
  if (!(tile instanceof HTMLElement)) throw new Error('Participant tile is missing');

  const unhandled = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  await fireEvent(tile, unhandled);
  expect(unhandled.defaultPrevented).toBe(false);
  expect(view.emitted('contextMenu')).toBeUndefined();

  await view.rerender({ contextMenu: true });
  const pointer = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 21, clientY: 33 });
  await fireEvent(tile, pointer);
  expect(pointer.defaultPrevented).toBe(true);

  vi.spyOn(tile, 'getBoundingClientRect').mockReturnValue(new DOMRect(40, 60, 100, 120));
  for (const shortcut of [{ key: 'ContextMenu' }, { key: 'F10', shiftKey: true }]) {
    const keyboard = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...shortcut });
    await fireEvent(tile, keyboard);
    expect(keyboard.defaultPrevented).toBe(true);
  }
  expect(view.emitted('contextMenu')).toEqual([
    [21, 33, tile],
    [90, 120, tile],
    [90, 120, tile]
  ]);
  await userEvent.click(tile);
  await fireEvent.keyDown(tile, { key: 'Enter' });
  expect(view.emitted('activate')).toBeUndefined();
});
