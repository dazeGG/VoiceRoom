import { render, screen, within } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { createPinia } from 'pinia';
import { expect, test, vi } from 'vitest';
import NewChatDialog from '@/features/home/components/lobby/NewChatDialog.vue';
import { LOBBY_KEY } from '@/features/home/model/lobby-context';
import { useLobbyStore } from '@/features/home/model/lobby.store';
import { publicUser } from '../fixtures/answers';
import { stubFetch } from '../fixtures/fetch';
import { stubOverlayDom } from '../helpers/overlay-dom';

test('the new chat search offers friends and disables other accounts', async () => {
  stubOverlayDom();
  const olga = publicUser({ id: 'olga', login: 'olga', displayName: 'Ольга' });
  const oleg = publicUser({ id: 'oleg', login: 'oleg', displayName: 'Олег' });
  stubFetch({
    'GET /api/friends/search?q=ol': {
      body: {
        ok: true,
        results: [
          { user: olga, relationship: 'none', online: false },
          { user: oleg, relationship: 'friend', online: true }
        ]
      }
    }
  });
  const pinia = createPinia();
  const onOpen = vi.fn();
  render(NewChatDialog, {
    props: { onOpen },
    global: { plugins: [pinia], provide: { [LOBBY_KEY]: useLobbyStore(pinia) } }
  });
  const dialog = await screen.findByRole('dialog', { name: 'Новый чат' });
  const search = within(dialog).getByRole('searchbox', { name: 'Логин или имя' });
  await userEvent.type(search, '@ol');
  const blocked = await within(dialog).findByRole('button', { name: /Ольга/ });
  expect(blocked).toHaveProperty('disabled', true);
  expect(within(blocked).getByText('Только друзьям')).toBeTruthy();
  await userEvent.click(blocked);
  expect(onOpen).not.toHaveBeenCalled();
  await userEvent.click(within(dialog).getByRole('button', { name: /Олег/ }));
  expect(onOpen).toHaveBeenCalledWith('oleg');
});
