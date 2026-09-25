import { cleanup, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { stubFetch } from '../fixtures/fetch.ts';
import { stubWindow } from '../helpers/fresh-module.ts';
import MobileStartScreen from '../../src/lib/features/home/components/MobileStartScreen.svelte';

afterEach(cleanup);

test('a phone starts a temporary guest room and opens it', async () => {
  const { calls } = stubFetch({
    '/api/pow-challenge': { body: { required: false } },
    'POST /api/rooms': { status: 201, body: { ok: true, roomId: 'tmp123' } }
  });
  const location = { href: 'https://voiceroom.ru/' };
  stubWindow({ location });
  render(MobileStartScreen);
  await userEvent.click(screen.getByRole('button', { name: /Создать комнату/ }));
  await vi.waitFor(() => expect(location.href).toBe('/r/tmp123'));
  expect(calls.at(-1)?.body).toMatchObject({ isStatic: false });
});

test('a failed create is reported and the button works again', async () => {
  stubFetch({
    '/api/pow-challenge': { body: { required: false } },
    'POST /api/rooms': { status: 503, body: { ok: false, error: 'Room capacity is temporarily full' } }
  });
  const onToast = vi.fn();
  render(MobileStartScreen, { props: { onToast } });
  const button = screen.getByRole('button', { name: /Создать комнату/ });
  await userEvent.click(button);
  await vi.waitFor(() => expect(onToast).toHaveBeenCalledWith('Room capacity is temporarily full'));
  expect(button).toHaveProperty('disabled', false);
});
