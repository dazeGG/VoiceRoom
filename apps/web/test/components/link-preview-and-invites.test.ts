import { cleanup, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import LinkPreviewCard from '../../src/lib/shared/chat/LinkPreviewCard.svelte';
import RoomInviteFriendList from '../../src/lib/shared/components/room-menu/RoomInviteFriendList.svelte';
import { stubFetch } from '../fixtures/fetch.ts';

afterEach(cleanup);

const KEY = `lp_${'a'.repeat(32)}.webp`;

test('a link preview opens the link in a new tab without sharing this page, and shows the stored copy of its image', () => {
  render(LinkPreviewCard, { props: { preview: { url: 'https://store.example/game', siteName: 'Store', title: 'Игра', description: 'Описание', image: { key: KEY, width: 320, height: 180 } } as never } });
  const link = screen.getByRole('link');
  expect(link.getAttribute('href')).toBe('https://store.example/game');
  expect(link.getAttribute('target')).toBe('_blank');
  expect(link.getAttribute('rel')).toBe('noopener noreferrer nofollow');
  expect(link.querySelector('img')?.getAttribute('src')).toBe(`/api/link-previews/${KEY}`);
  expect(link.textContent).toContain('Игра');
});

test('an image key that is not a stored preview copy is not shown', () => {
  render(LinkPreviewCard, { props: { preview: { url: 'https://x.example', siteName: 'X', title: '', description: '', image: { key: 'https://evil.example/a.png', width: 1, height: 1 } } as never } });
  expect(screen.getByRole('link').querySelector('img')).toBeNull();
});

function friend(id: string, name: string, online: boolean) {
  return { user: { id, login: id, displayName: name, avatarUrl: null, avatarAccent: null, avatarColorKey: 'blue', presenceStatus: 'online', doNotDisturb: false }, online };
}

test('the invite list puts online friends first, alphabetically, and disables those already in the room', () => {
  render(RoomInviteFriendList, {
    props: {
      friends: [friend('u-b', 'Борис', false), friend('u-v', 'Вера', true), friend('u-a', 'Анна', true)] as never,
      roomId: 'room-a',
      presentUserIds: new Set(['u-a']),
      close: vi.fn()
    }
  });
  const items = screen.getAllByRole('menuitem');
  expect(items.map((item) => item.textContent?.trim().replace(/\s+/g, ' '))).toEqual([expect.stringContaining('Анна'), expect.stringContaining('Вера'), expect.stringContaining('Борис')]);
  expect(items[0]).toHaveProperty('disabled', true);
  expect(items[1]).toHaveProperty('disabled', false);
});

test('inviting rings the friend into the room and closes the menu; a failure is reported', async () => {
  const { calls } = stubFetch({ 'POST /api/rooms/room-a/ring': { body: { ok: true } } });
  const close = vi.fn();
  const onToast = vi.fn();
  render(RoomInviteFriendList, { props: { friends: [friend('u-v', 'Вера', true)] as never, roomId: 'room-a', close, onToast } });
  await userEvent.click(screen.getByRole('menuitem'));
  expect(calls[0]).toMatchObject({ method: 'POST', url: '/api/rooms/room-a/ring', body: { userId: 'u-v' } });
  expect(onToast).toHaveBeenCalledWith('Вера приглашён в комнату');
  expect(close).toHaveBeenCalled();

  cleanup();
  stubFetch({ 'POST /api/rooms/room-a/ring': { status: 429, body: { ok: false, error: 'Слишком часто' } } });
  render(RoomInviteFriendList, { props: { friends: [friend('u-v', 'Вера', true)] as never, roomId: 'room-a', close: vi.fn(), onToast } });
  await userEvent.click(screen.getByRole('menuitem'));
  expect(onToast).toHaveBeenLastCalledWith('Слишком часто');
});

test('with no friends the list says how to get some', () => {
  render(RoomInviteFriendList, { props: { friends: [], roomId: 'room-a', close: vi.fn() } });
  expect(screen.getByText('Добавьте друзей, чтобы позвать их')).toBeTruthy();
});
