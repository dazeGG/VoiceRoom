import { expect, test } from 'vitest';
import { formatLastSeen } from '../src/lib/features/home/model/account-security.ts';
import { loginAlertWhen } from '../src/lib/features/home/model/login-alerts.ts';
import { dateTime, dayMonth, dayMonthYear, timeAgo } from '../src/lib/shared/utils/date-format.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 8, 24, 12);

test('timeAgo counts minutes, hours and days, then falls back to the date', () => {
  expect(timeAgo(NOW - 20_000, NOW)).toBe('только что');
  expect(timeAgo(NOW - 5 * MINUTE, NOW)).toBe('5 мин назад');
  expect(timeAgo(NOW - 5 * HOUR, NOW)).toBe('5 ч назад');
  expect(timeAgo(NOW - 3 * DAY, NOW)).toBe('3 дн назад');
  expect(timeAgo(NOW - 30 * DAY, NOW)).toBe(dayMonth(NOW - 30 * DAY));
});

test('a time slightly in the future reads as just now', () => {
  expect(timeAgo(NOW + 5 * MINUTE, NOW)).toBe('только что');
});

test('dates are written in Russian', () => {
  const at = Date.UTC(2026, 9, 15, 12);
  expect(dayMonth(at)).toBe('15 октября');
  expect(dayMonthYear(at)).toBe('15 октября 2026 г.');
  expect(dateTime(at)).toMatch(/^15 окт\. 2026 г\., /);
});

test('the day suffix reads "дн" everywhere', () => {
  expect(formatLastSeen(NOW - 3 * DAY, NOW)).toBe('Заходил 3 дн назад');
});

test('a login alert under an hour old is told with the shared wording', () => {
  expect(loginAlertWhen({ createdAt: NOW - 5 * MINUTE, location: 'Москва' }, NOW)).toBe('Москва · 5 мин назад');
});
