import { screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { cleanup } from '@testing-library/vue';
import { expect, test, vi } from 'vitest';
import LinkPreviewCard from '@/shared/chat/LinkPreviewCard.vue';
import RoomInviteFriendList from '@/shared/components/room-menu/RoomInviteFriendList.vue';
import { friend as friendAnswer, publicUser } from '../fixtures/answers.ts';
import { stubFetch } from '../fixtures/fetch.ts';
import { renderWithApp } from '../helpers/render.ts';

const KEY = `lp_${'a'.repeat(32)}.webp`;

test('a link preview opens the link in a new tab without sharing this page, and shows the stored copy of its image', async () => {
  await renderWithApp(LinkPreviewCard, {
    props: {
      preview: {
        url: 'https://store.example/game',
        siteName: 'Store',
        title: 'Игра',
        description: 'Описание',
        image: { key: KEY, width: 320, height: 180 }
      }
    }
  });
  const link = screen.getByRole('link');
  expect(link.getAttribute('href')).toBe('https://store.example/game');
  expect(link.getAttribute('target')).toBe('_blank');
  expect(link.getAttribute('rel')).toBe('noopener noreferrer nofollow external');
  expect(link.querySelector('img')?.getAttribute('src')).toBe(`/api/link-previews/${KEY}`);
  expect(link.textContent).toContain('Игра');
});

test('an image key that is not a stored preview copy is not shown', async () => {
  await renderWithApp(LinkPreviewCard, {
    props: {
      preview: {
        url: 'https://x.example',
        siteName: 'X',
        title: '',
        description: '',
        image: { key: 'https://evil.example/a.png', width: 1, height: 1 }
      }
    }
  });
  expect(screen.getByRole('link').querySelector('img')).toBeNull();
});

function friend(id: string, name: string, online: boolean) {
  return friendAnswer({
    user: publicUser({ id, login: id, displayName: name, avatarColorKey: 'blue', presenceStatus: 'online' }),
    online
  });
}

test('the invite list puts online friends first, alphabetically, and disables those already in the room', async () => {
  await renderWithApp(RoomInviteFriendList, {
    props: {
      friends: [friend('u-b', 'Борис', false), friend('u-v', 'Вера', true), friend('u-a', 'Анна', true)],
      roomId: 'room-a',
      presentUserIds: new Set(['u-a']),
      onClose: vi.fn()
    }
  });
  const items = screen.getAllByRole('menuitem');
  expect(items.map((item) => item.textContent?.trim().replace(/\s+/g, ' '))).toEqual([
    expect.stringContaining('Анна'),
    expect.stringContaining('Вера'),
    expect.stringContaining('Борис')
  ]);
  expect(items[0]).toHaveProperty('disabled', true);
  expect(items[1]).toHaveProperty('disabled', false);
});

test('inviting rings the friend into the room and closes the menu; a failure is reported', async () => {
  const { calls } = stubFetch({ 'POST /api/rooms/room-a/ring': { body: { ok: true } } });
  const close = vi.fn();
  const onToast = vi.fn();
  await renderWithApp(RoomInviteFriendList, {
    props: { friends: [friend('u-v', 'Вера', true)], roomId: 'room-a', onClose: close, onToast }
  });
  await userEvent.click(screen.getByRole('menuitem'));
  expect(calls[0]).toMatchObject({ method: 'POST', url: '/api/rooms/room-a/ring', body: { userId: 'u-v' } });
  expect(onToast).toHaveBeenCalledWith('Вера приглашён в комнату');
  expect(close).toHaveBeenCalled();

  cleanup();
  stubFetch({ 'POST /api/rooms/room-a/ring': { status: 429, body: { ok: false, error: 'Слишком часто' } } });
  await renderWithApp(RoomInviteFriendList, {
    props: { friends: [friend('u-v', 'Вера', true)], roomId: 'room-a', onClose: vi.fn(), onToast }
  });
  await userEvent.click(screen.getByRole('menuitem'));
  expect(onToast).toHaveBeenLastCalledWith('Слишком часто');
});

test('with no friends the list says how to get some', async () => {
  await renderWithApp(RoomInviteFriendList, { props: { friends: [], roomId: 'room-a', onClose: vi.fn() } });
  expect(screen.getByText('Добавьте друзей, чтобы позвать их')).toBeTruthy();
});
