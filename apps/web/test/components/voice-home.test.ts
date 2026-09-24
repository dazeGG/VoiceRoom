import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import VoiceHome from '../../src/lib/features/home/components/lobby/VoiceHome.svelte';

afterEach(cleanup);

function room(roomId: string, name: string, peers = 0) {
  return { roomId, name, peers, avatarUrl: null, createdAt: 1, emptySince: null, isStatic: true, relationship: 'owner' as const };
}

function renderHome(rooms: ReturnType<typeof room>[] = []) {
  const props = {
    rooms,
    onOpenRoom: vi.fn(),
    onCreateRoom: vi.fn(),
    onJoinCode: vi.fn()
  };
  render(VoiceHome, { props });
  return props;
}

test('joining by code is one field that takes a code or a link and explains auto-save', async () => {
  const props = renderHome();
  const field = screen.getByRole('textbox', { name: 'Код или ссылка на комнату' });
  const hint = document.getElementById(field.getAttribute('aria-describedby') ?? '');
  expect(hint?.textContent).toMatch(/Постоянные комнаты сохраняются автоматически/);

  await userEvent.type(field, 'abc123{Enter}');
  expect(props.onJoinCode).toHaveBeenCalledWith('abc123');
  expect((field as HTMLInputElement).value).toBe('');
});

test('an empty or blank code is not submitted', async () => {
  const props = renderHome();
  const field = screen.getByPlaceholderText('Код или ссылка');
  await userEvent.type(field, '   {Enter}');
  expect(props.onJoinCode).not.toHaveBeenCalled();
});

test('rooms are listed busiest first and open on click', async () => {
  const props = renderHome([room('quiet', 'Тихая', 0), room('busy', 'Шумная', 3)]);
  const cards = screen.getAllByRole('button', { name: /Тихая|Шумная/ });
  expect(cards.map((card) => card.textContent)).toEqual([expect.stringContaining('Шумная'), expect.stringContaining('Тихая')]);
  await userEvent.click(cards[1]);
  expect(props.onOpenRoom).toHaveBeenCalledWith('quiet');
});

test('a room card opens its menu on right click and from the keyboard, and Escape returns focus', async () => {
  renderHome([room('abc123', 'Планёрка')]);
  const card = screen.getByRole('button', { name: /Планёрка/ });

  await fireEvent.contextMenu(card, { clientX: 40, clientY: 40 });
  expect(await screen.findByRole('menu', { name: 'Меню комнаты Планёрка' })).toBeTruthy();
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('menu')).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(card));

  card.focus();
  await userEvent.keyboard('{Shift>}{F10}{/Shift}');
  expect(await screen.findByRole('menu', { name: 'Меню комнаты Планёрка' })).toBeTruthy();
});
