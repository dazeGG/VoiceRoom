import { render, screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
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
  await userEvent.click(screen.getByRole('button', { name: 'Смотреть экран' }));
  expect(view.emitted('watchScreen')).toEqual([[]]);
});
