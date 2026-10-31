import { screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import MobileStartScreen from '@/features/home/components/MobileStartScreen.vue';
import { stubFetch } from '../fixtures/fetch';
import { stubWindow } from '../helpers/fresh-module';
import { renderWithApp } from '../helpers/render';

test('a phone starts a temporary guest room and opens it', async () => {
  const { calls } = stubFetch({
    '/api/pow-challenge': { body: { ok: true, required: false } },
    'POST /api/rooms': {
      status: 201,
      body: {
        ok: true,
        roomId: 'tmp123',
        name: '',
        avatarUrl: null,
        createdAt: 1,
        isStatic: false,
        maxRooms: 10,
        maxRoomPeers: 25,
        owned: false
      }
    }
  });
  const location = { href: 'https://voiceroom.ru/' };
  stubWindow({ location });
  await renderWithApp(MobileStartScreen);
  await userEvent.click(screen.getByRole('button', { name: /Создать комнату/ }));
  await vi.waitFor(() => expect(location.href).toBe('/r/tmp123'));
  expect(calls.at(-1)?.body).toMatchObject({ isStatic: false });
});

test('a failed create is reported and the button works again', async () => {
  stubFetch({
    '/api/pow-challenge': { body: { ok: true, required: false } },
    'POST /api/rooms': { status: 503, body: { ok: false, error: 'Room capacity is temporarily full' } }
  });
  const onToast = vi.fn();
  await renderWithApp(MobileStartScreen, { props: { onToast } });
  const button = screen.getByRole('button', { name: /Создать комнату/ });
  await userEvent.click(button);
  await vi.waitFor(() => expect(onToast).toHaveBeenCalledWith('Room capacity is temporarily full'));
  expect(button).toHaveProperty('disabled', false);
});
