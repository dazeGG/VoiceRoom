import { render, screen, within } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import PrivacySettings from '@/features/home/components/settings/PrivacySettings.vue';
import { publicUser } from '../fixtures/answers';
import { installFakeWebSocket } from '../fixtures/fake-websocket';
import { stubFetch } from '../fixtures/fetch';

test('privacy settings save choices, edit the selected list, unblock and reflect another session', async () => {
  const sockets = installFakeWebSocket();
  const ada = publicUser({ id: 'ada', login: 'ada', displayName: 'Ада' });
  const bob = publicUser({ id: 'bob', login: 'bob', displayName: 'Боб' });
  const defaults = { messagesFrom: 'everyone', callsFrom: 'friends', allowList: [] } as const;
  const selected = { ...defaults, messagesFrom: 'selected' } as const;
  const { calls } = stubFetch({
    'GET /api/privacy': { body: { ok: true, privacy: defaults } },
    'PUT /api/privacy': { body: { ok: true, privacy: selected } },
    'GET /api/blocks': { body: { ok: true, blocked: [bob.id], users: [bob] } },
    'GET /api/friends/search?q=ada': {
      body: { ok: true, results: [{ user: ada, relationship: 'none', online: false }] }
    },
    'PUT /api/privacy/allow/messages/ada': {
      body: { ok: true, privacy: { ...selected, allowList: [{ kind: 'messages', user: ada, createdAt: 1 }] } }
    },
    'DELETE /api/privacy/allow/messages/ada': { body: { ok: true, privacy: selected } },
    'DELETE /api/blocks/bob': { body: { ok: true } }
  });
  render(PrivacySettings);
  const messages = await screen.findByRole('radiogroup', { name: 'Кто может мне писать' });
  expect(within(messages).getByRole('radio', { name: 'Все', checked: true })).toBeTruthy();
  await userEvent.click(within(messages).getByRole('radio', { name: 'Выбранные' }));
  const form = within(await screen.findByRole('form', { name: 'Кто может мне писать' }));
  await userEvent.type(form.getByRole('textbox', { name: 'Логин' }), '@ada{Enter}');
  await screen.findByText('@ada');
  await userEvent.click(screen.getByRole('button', { name: 'Убрать' }));
  expect(screen.queryByText('@ada')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Разблокировать' }));
  expect(await screen.findByText('Заблокированных пользователей нет.')).toBeTruthy();
  expect(calls).toContainEqual({
    method: 'PUT',
    url: '/api/privacy',
    body: { messagesFrom: 'selected', callsFrom: 'friends' }
  });

  const socket = sockets.latest();
  socket.open();
  socket.receive({ type: 'account.privacy.updated', payload: { privacy: { ...defaults, callsFrom: 'everyone' } } });
  const callsGroup = within(screen.getByRole('radiogroup', { name: 'Кто может мне звонить' }));
  expect(await callsGroup.findByRole('radio', { name: 'Все', checked: true })).toBeTruthy();
});
