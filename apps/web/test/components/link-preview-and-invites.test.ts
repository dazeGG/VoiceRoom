import { screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { cleanup } from '@testing-library/vue';
import { expect, test, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { Button, DropdownMenu, MenuSub } from '@voiceroom/ui-kit/components';
import LinkPreviewCard from '@/shared/chat/LinkPreviewCard.vue';
import RoomInviteFriendList from '@/shared/components/room-menu/RoomInviteFriendList.vue';
import { friend as friendAnswer, publicUser } from '../fixtures/answers.ts';
import { stubFetch } from '../fixtures/fetch.ts';
import { stubOverlayDom } from '../helpers/overlay-dom';
import { renderWithApp } from '../helpers/render.ts';

stubOverlayDom();

async function renderInviteList(props: InstanceType<typeof RoomInviteFriendList>['$props']) {
  await renderWithApp(
    defineComponent(
      () => () =>
        h(
          DropdownMenu,
          { ariaLabel: 'Комната' },
          {
            trigger: () => h(Button, {}, () => 'Комната'),
            content: () =>
              h(MenuSub, { label: 'Пригласить', ariaLabel: 'Позвать друга' }, () => h(RoomInviteFriendList, props))
          }
        )
    )
  );
  await userEvent.click(screen.getByRole('button', { name: 'Комната' }));
  const trigger = await screen.findByRole('menuitem', { name: 'Пригласить' });
  trigger.focus();
  await userEvent.keyboard('{ArrowRight}');
}

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
  await renderInviteList({
    friends: [friend('u-b', 'Борис', false), friend('u-v', 'Вера', true), friend('u-a', 'Анна', true)],
    roomId: 'room-a',
    presentUserIds: new Set(['u-a']),
    onClose: vi.fn()
  });
  expect(await screen.findByRole('combobox', { name: 'Найти друга', expanded: true })).toBeTruthy();
  const items = await screen.findAllByRole('option');
  expect(items.map((item) => item.textContent?.trim().replace(/\s+/g, ' '))).toEqual([
    expect.stringContaining('Анна'),
    expect.stringContaining('Вера'),
    expect.stringContaining('Борис')
  ]);
  expect(items[0]?.getAttribute('aria-disabled')).toBe('true');
  expect(items[1]?.getAttribute('aria-disabled')).not.toBe('true');
});

test('inviting rings the friend into the room and closes the menu; a failure is reported', async () => {
  const { calls } = stubFetch({ 'POST /api/rooms/room-a/ring': { body: { ok: true } } });
  const close = vi.fn();
  const onToast = vi.fn();
  await renderInviteList({ friends: [friend('u-v', 'Вера', true)], roomId: 'room-a', onClose: close, onToast });
  await userEvent.click(await screen.findByRole('option', { name: /Вера/ }));
  expect(calls[0]).toMatchObject({ method: 'POST', url: '/api/rooms/room-a/ring', body: { userId: 'u-v' } });
  expect(onToast).toHaveBeenCalledWith('Вера приглашён в комнату');
  expect(close).toHaveBeenCalled();

  cleanup();
  stubFetch({ 'POST /api/rooms/room-a/ring': { status: 429, body: { ok: false, error: 'Слишком часто' } } });
  await renderInviteList({ friends: [friend('u-v', 'Вера', true)], roomId: 'room-a', onClose: vi.fn(), onToast });
  await userEvent.click(await screen.findByRole('option', { name: /Вера/ }));
  expect(onToast).toHaveBeenLastCalledWith('Слишком часто');
});

test('keyboard search filters the visible friends and Escape returns focus to the submenu trigger', async () => {
  const user = userEvent.setup();
  await renderInviteList({
    friends: [friend('u-v', 'Вера', true), friend('u-b', 'Борис', false)],
    roomId: 'room-a',
    onClose: vi.fn()
  });
  const input = await screen.findByRole('combobox', { name: 'Найти друга' });
  expect(await screen.findAllByRole('option')).toHaveLength(2);
  expect(document.activeElement).toBe(input);

  await user.type(input, 'u-v');
  expect(screen.getAllByRole('option')).toEqual([screen.getByRole('option', { name: /Вера/ })]);
  await user.clear(input);
  expect(screen.getAllByRole('option')).toHaveLength(2);
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Пригласить' }));
});

test('with no friends the list says how to get some', async () => {
  await renderInviteList({ friends: [], roomId: 'room-a', onClose: vi.fn() });
  expect(screen.getByText('Добавьте друзей, чтобы позвать их')).toBeTruthy();
});
