// The public legal pages name the operator and the contact address, carry the
// attribution the emoji and geolocation licences require, open on a phone, and
// the sign-up form points to them.

import { cleanup, render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import AuthDialog from '../../src/lib/features/auth/AuthDialog.svelte';
import { session } from '../../src/lib/features/auth/session.svelte';
import Licenses from '../../src/lib/features/legal/Licenses.svelte';
import PrivacyPolicy from '../../src/lib/features/legal/PrivacyPolicy.svelte';
import TermsOfService from '../../src/lib/features/legal/TermsOfService.svelte';
import { isMobileRoute } from '../../src/lib/platform/mobile-routes.ts';
import { instanceOf } from '../helpers/assert.ts';

vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}) }));

beforeEach(() => {
  for (const [name, open] of [
    ['showModal', true],
    ['close', false]
  ] as const) {
    if (name in HTMLDialogElement.prototype) continue;
    Object.defineProperty(HTMLDialogElement.prototype, name, {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.open = open;
      }
    });
  }
  session.loaded = true;
});
afterEach(cleanup);

test('the privacy policy names the operator, the contact and the retention periods', () => {
  const { container } = render(PrivacyPolicy);
  const text = container.textContent ?? '';
  expect(text).toContain('Ефремов Владимир Владимирович');
  expect(text).toContain('152-ФЗ');
  expect(text).toContain('не записываем и не храним');
  expect(text).toMatch(/восстановить в течение 7 дней/);
  expect(text).toMatch(/История входов — 90 дней/);
  expect(text).toMatch(/не дольше 30 дней/);
  // What the administration sees of the calls, and how long a stay keeps its room.
  expect(text).toContain('администрация сервиса видит, кто сейчас в звонках комнат');
  expect(text).toContain('Содержимое звонков мы не слушаем и не записываем');
  expect(text).toMatch(/История участия в звонках связана с комнатой 90 дней/);
  expect(screen.getAllByRole('link', { name: 'support@voiceroom.ru' })[0]?.getAttribute('href')).toBe(
    'mailto:support@voiceroom.ru'
  );
});

test('the terms set the minimum age and say how to report', () => {
  const { container } = render(TermsOfService);
  const text = container.textContent ?? '';
  expect(text).toContain('с 14 лет');
  expect(text).toContain('«Пожаловаться»');
  expect(text).toContain('ст. 1253.1');
  expect(screen.getAllByRole('link', { name: 'Политике обработки персональных данных' })[0]?.getAttribute('href')).toBe(
    '/privacy'
  );
});

test('the licences page carries the Twemoji and DB-IP attribution', () => {
  render(Licenses);
  const twemoji = instanceOf(screen.getByRole('link', { name: 'Twemoji' }).closest('li'), HTMLElement, 'Twemoji');
  expect(twemoji.textContent).toContain('© Twitter, Inc.');
  expect(within(twemoji).getByRole('link', { name: 'CC BY 4.0' }).getAttribute('href')).toBe(
    'https://creativecommons.org/licenses/by/4.0/'
  );
  const dbip = instanceOf(screen.getByRole('link', { name: 'DB-IP City Lite' }).closest('li'), HTMLElement, 'DB-IP');
  expect(dbip.textContent).toMatch(/IP Geolocation by\s+DB-IP/);
});

test('a phone may open the legal pages but still not the account screens', () => {
  for (const route of ['/terms', '/privacy', '/licenses', '/', '/r/[roomId]']) expect(isMobileRoute(route)).toBe(true);
  for (const route of ['/login', '/register', '/admin/reports', null]) expect(isMobileRoute(route)).toBe(false);
});

test('the sign-up form links the terms and the policy, and the sign-in form does not', async () => {
  const props = { onClose: vi.fn(), onModeChange: vi.fn(), onAuthenticated: vi.fn() };
  const signUp = render(AuthDialog, { props: { ...props, mode: 'register' } });
  expect(screen.getByText(/вам исполнилось 14 лет/)).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Пользовательское соглашение', hidden: true }).getAttribute('href')).toBe(
    '/terms'
  );
  expect(
    screen.getByRole('link', { name: 'Политикой обработки персональных данных', hidden: true }).getAttribute('href')
  ).toBe('/privacy');
  // The dialog focuses its first field a microtask after mounting.
  await new Promise((resolve) => setTimeout(resolve, 0));
  signUp.unmount();

  render(AuthDialog, { props: { ...props, mode: 'login' } });
  expect(screen.queryByText(/вам исполнилось 14 лет/)).toBeNull();
});
