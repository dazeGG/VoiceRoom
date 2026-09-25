import { expect, test } from 'vitest';
import {
  formatLastSeen,
  recoveryCodesFileText,
  recoveryCodesSummary,
  sessionDeviceLabel,
  shouldShowRecoveryCodesReminder
} from '../../src/lib/features/home/model/account-security.ts';
import { loginAlertHeadline, loginAlertWhen, queueLoginAlert } from '../../src/lib/features/home/model/login-alerts.ts';
import { WHATS_NEW_SLIDES, shouldShowWhatsNew } from '../../src/lib/features/home/model/whats-new.ts';
import { WHATS_NEW_VERSION } from '@voice-room/shared/account-security';

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 24, 12);

test('a session names its browser and system, or says the browser is unknown', () => {
  expect(sessionDeviceLabel({ client: 'Chrome 146', os: 'Windows 11' })).toBe('Chrome 146 · Windows 11');
  expect(sessionDeviceLabel({ client: '', os: '' })).toBe('Неизвестный браузер');
});

test('last activity is only as precise as the hourly server refresh', () => {
  expect(formatLastSeen(NOW - 10 * 60_000, NOW)).toBe('Активен в течение часа');
  expect(formatLastSeen(NOW - 5 * HOUR, NOW)).toBe('Заходил 5 ч назад');
  expect(formatLastSeen(NOW - 3 * 24 * HOUR, NOW)).toBe('Заходил 3 дн. назад');
  expect(formatLastSeen(NOW - 30 * 24 * HOUR, NOW)).toMatch(/^Заходил \d+ [а-я]+$/);
});

test('the recovery codes summary says how many are left and warns when none are', () => {
  expect(recoveryCodesSummary({ remaining: 0, generatedAt: null })).toBe('Кодов пока нет. Без них забытый пароль не восстановить.');
  expect(recoveryCodesSummary({ remaining: 0, generatedAt: NOW })).toMatch(/^Все коды использованы/);
  expect(recoveryCodesSummary({ remaining: 7, generatedAt: null })).toBe('Осталось 7 из 10');
});

test('the downloaded codes file names the account and lists every code', () => {
  const text = recoveryCodesFileText(['AAAA-1111', 'BBBB-2222'], 'anya', new Date(NOW));
  expect(text).toContain('Аккаунт: anya');
  expect(text.split('\n')).toEqual(expect.arrayContaining(['AAAA-1111', 'BBBB-2222']));
});

test('the reminder to create codes shows only without codes and not while snoozed', () => {
  const noCodes = { recoveryCodes: { remaining: 0 }, recoveryCodesReminder: null } as never;
  expect(shouldShowRecoveryCodesReminder(noCodes, NOW)).toBe(true);
  expect(shouldShowRecoveryCodesReminder({ recoveryCodes: { remaining: 3 }, recoveryCodesReminder: null } as never, NOW)).toBe(false);
  expect(shouldShowRecoveryCodesReminder({ recoveryCodes: { remaining: 0 }, recoveryCodesReminder: { snoozedUntil: NOW + HOUR } } as never, NOW)).toBe(false);
});

test('sign-in alerts say how the account was entered, when and where, oldest first without repeats', () => {
  expect(loginAlertHeadline({ kind: 'recovery' })).toBe('В ваш аккаунт вошли по коду восстановления');
  expect(loginAlertHeadline({ kind: 'login' })).toBe('В ваш аккаунт вошли с нового устройства');
  expect(loginAlertWhen({ createdAt: NOW - 30_000, location: 'Москва' }, NOW)).toBe('Москва · только что');
  expect(loginAlertWhen({ createdAt: NOW - 5 * 60_000, location: '' }, NOW)).toBe('5 мин назад');

  const a = { id: 'a', createdAt: 2 } as never;
  const b = { id: 'b', createdAt: 1 } as never;
  expect(queueLoginAlert(queueLoginAlert([], a), b).map((alert: { id: string }) => alert.id)).toEqual(['b', 'a']);
  expect(queueLoginAlert([a], a)).toHaveLength(1);
});

test('what is new appears once per release and has a few slides', () => {
  expect(shouldShowWhatsNew({ current: WHATS_NEW_VERSION, lastSeen: '2.5.0' })).toBe(true);
  expect(shouldShowWhatsNew({ current: WHATS_NEW_VERSION, lastSeen: WHATS_NEW_VERSION })).toBe(false);
  expect(shouldShowWhatsNew({ current: '9.9.9', lastSeen: '2.5.0' })).toBe(false);
  expect(WHATS_NEW_SLIDES.length).toBeGreaterThanOrEqual(2);
  expect(WHATS_NEW_SLIDES.length).toBeLessThanOrEqual(4);
});
