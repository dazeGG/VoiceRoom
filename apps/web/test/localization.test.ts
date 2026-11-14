import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import { beforeEach, expect, test, vi } from 'vitest';
import { fireEvent } from '@testing-library/vue';
import { english, french } from '../src/shared/i18n/catalog';
import { LOCALE_STORAGE_KEY, t, useLocaleStore } from '../src/shared/i18n';
import { formatNumber } from '../src/shared/i18n';
import { currentErrorMessage, useLocalizedText } from '../src/shared/i18n/localized-text';
import { ApiError } from '../src/api/client';
import { NOISE_MODES } from '../src/features/room/client/core/config';
import { dayMonth, timeAgo } from '../src/shared/utils/date-format';
import { formatTypingLabel } from '../src/shared/chat/typing';
import { displayNameOf } from '../src/shared/utils/display-name';
import { CALL_FEEDBACK_TAG_LABELS } from '../src/shared/i18n/feedback-labels';
import { buildNotificationPayload, type NotificationDmMessageEvent } from '../src/shared/notifications/router';
import LanguageControl from '../src/shared/i18n/LanguageControl.vue';
import { renderWithApp } from './helpers/render';

beforeEach(() => {
  setActivePinia(createPinia());
  localStorage.clear();
  delete window.voiceRoomLocale;
  vi.restoreAllMocks();
});

test('first use selects a supported browser preference and saved choice wins', async () => {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['de-DE', 'fr-CA']);
  const locale = useLocaleStore();
  await locale.init();
  expect(locale.current).toBe('fr');
  expect(document.documentElement.lang).toBe('fr');
  expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('fr');
  await locale.select('en');
  expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
  await locale.init();
  expect(locale.current).toBe('en');
  locale.stop();
});

test('unsupported preferences use Russian and translations follow selection', async () => {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['de-DE']);
  const locale = useLocaleStore();
  await locale.init();
  expect(locale.current).toBe('ru');
  expect(t('Назад')).toBe('Назад');
  await locale.select('en');
  expect(t('Назад')).toBe('Back');
  await locale.select('fr');
  expect(t('Назад')).toBe('Retour');
  locale.stop();
});

test('same-profile storage updates apply the saved client language', async () => {
  const locale = useLocaleStore();
  await locale.init();
  localStorage.setItem(LOCALE_STORAGE_KEY, 'fr');
  window.dispatchEvent(new StorageEvent('storage', { key: LOCALE_STORAGE_KEY, newValue: 'fr' }));
  expect(locale.current).toBe('fr');
  locale.stop();
});

test('a denied browser store keeps a working choice and reports failed persistence', async () => {
  const locale = useLocaleStore();
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('denied');
  });
  await locale.select('fr');
  expect(locale.current).toBe('fr');
  expect(locale.saveFailed).toBe(true);
});

test('desktop authority is separate from browser storage and newer pushes beat initial read', async () => {
  localStorage.setItem(LOCALE_STORAGE_KEY, 'ru');
  const listeners: Array<(value: unknown) => void> = [];
  let finish: (value: unknown) => void = () => {};
  window.voiceRoomLocale = {
    get: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    set: async (value) => value,
    subscribe: (listener) => {
      listeners.push(listener);
      return () => {};
    }
  };
  const locale = useLocaleStore();
  const initialized = locale.init();
  listeners[0]?.('fr');
  finish('en');
  await initialized;
  expect(locale.current).toBe('fr');
  await locale.select('en');
  expect(locale.current).toBe('en');
  expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('ru');
  locale.stop();
});

test('language control is usable without an account and labels react to its selection', async () => {
  const view = await renderWithApp(LanguageControl);
  await fireEvent.update(view.getByRole('combobox'), 'en');
  await nextTick();
  expect(view.getByRole('combobox', { name: 'Language' })).toBeTruthy();
  await fireEvent.update(view.getByRole('combobox'), 'fr');
  await nextTick();
  expect(view.getByRole('combobox', { name: 'Langue' })).toBeTruthy();
});

test('a stale desktop save response cannot overwrite a newer selection', async () => {
  const completions: Array<(value: unknown) => void> = [];
  window.voiceRoomLocale = {
    get: async () => 'ru',
    set: () =>
      new Promise((resolve) => {
        completions.push(resolve);
      }),
    subscribe: () => () => {}
  };
  const locale = useLocaleStore();
  const older = locale.select('fr');
  const newer = locale.select('en');
  completions[1]?.('en');
  await newer;
  completions[0]?.('fr');
  await older;
  expect(locale.current).toBe('en');
});

test('English and French dictionaries have identical complete message keys', () => {
  expect(Object.keys(french).sort()).toEqual(Object.keys(english).sort());
  for (const value of Object.values(english)) expect(value.trim()).not.toBe('');
  for (const value of Object.values(french)) expect(value.trim()).not.toBe('');
  const translations = new Map(Object.entries(french));
  for (const [key, entry] of Object.entries(english)) {
    const expected = (key.match(/\{p\d+\}/g) ?? []).sort();
    expect((entry.match(/\{p\d+\}/g) ?? []).sort()).toEqual(expected);
    expect((translations.get(key)?.match(/\{p\d+\}/g) ?? []).sort()).toEqual(expected);
  }
});

test('interpolated user content is never interpreted as another template field', async () => {
  await useLocaleStore().select('en');
  expect(t('{p0}. Причина: {p1}', { p0: 'Alice {p1} <b>', p1: 'example' })).toBe('Alice {p1} <b>. Reason: example');
});

test('active app error copy follows locale by code while unknown server text stays unchanged', async () => {
  const locale = useLocaleStore();
  const error = useLocalizedText();
  const failure = new ApiError('original Russian failure', 401, { code: 'authentication_required' });
  error.value = () => currentErrorMessage(failure);
  expect(error.value).toBe('Требуется вход');
  await locale.select('en');
  expect(error.value).toBe('Sign in required');
  await locale.select('fr');
  expect(error.value).toBe(french['Требуется вход']);
  error.value = () => currentErrorMessage(new Error('Unchanged server-provided reason'));
  await locale.select('ru');
  expect(error.value).toBe('Unchanged server-provided reason');
});

test('setup metadata, dates, counts and typing wording recompute after selection', async () => {
  const locale = useLocaleStore();
  const at = Date.UTC(2026, 9, 15, 12);
  await locale.select('en');
  expect(NOISE_MODES.off.label).toBe(english['Выкл']);
  expect(CALL_FEEDBACK_TAG_LABELS.sound).toBe('Clear audio');
  expect(dayMonth(at)).toBe('October 15');
  expect(timeAgo(at - 86_400_000, at)).toBe('1 day ago');
  expect(formatTypingLabel([{ name: 'Alice', activity: 'typing' }])).toBe('Alice is typing…');
  await locale.select('fr');
  expect(NOISE_MODES.off.label).toBe(french['Выкл']);
  expect(CALL_FEEDBACK_TAG_LABELS.sound).toBe('Son clair');
  expect(dayMonth(at)).toBe('15 octobre');
  expect(formatNumber(1234.5)).toBe(new Intl.NumberFormat('fr').format(1234.5));
  expect(formatTypingLabel([{ name: 'Alice', activity: 'typing' }])).toBe('Alice écrit…');
});

test('only a semantic deleted-account identity is translated, never a user display name', async () => {
  const locale = useLocaleStore();
  await locale.select('fr');
  expect(displayNameOf({ login: 'deleted-a1', displayName: 'Удалённый аккаунт' })).toBe('Compte supprimé');
  expect(displayNameOf({ login: 'alice', displayName: 'Удалённый аккаунт' })).toBe('Удалённый аккаунт');
});

test('foreground invitation copy uses metadata while ordinary user bodies remain unchanged', async () => {
  const event: NotificationDmMessageEvent = {
    type: 'notification.dm.message',
    payload: {
      dedupeKey: 'dm:invite',
      peer: { id: 'alice', displayName: 'Алиса', login: 'alice' },
      message: {
        id: 'invite',
        createdAt: 1,
        body: 'legacy Russian system invitation',
        invite: { roomId: 'room', roomName: 'Кухня {p1} 🎧', status: 'pending', expiresAt: null }
      }
    }
  };
  await useLocaleStore().select('en');
  expect(buildNotificationPayload(event)?.body).toBe('Invitation to room “Кухня {p1} 🎧”');
  await useLocaleStore().select('fr');
  const privatePayload = buildNotificationPayload(event, { privateNotifications: true });
  expect(privatePayload?.body).toBe(french['Откройте VoiceRoom, чтобы посмотреть уведомление.']);
  expect(privatePayload?.body).not.toContain('Кухня');
  const { invite: _invite, ...ordinary } = event.payload.message;
  const userBody = 'Приглашение в комнату «Кухня»';
  expect(
    buildNotificationPayload({ ...event, payload: { ...event.payload, message: { ...ordinary, body: userBody } } })
      ?.body
  ).toBe(userBody);
});
