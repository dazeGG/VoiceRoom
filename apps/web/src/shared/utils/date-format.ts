// How dates and relative times are written in the interface. One locale, one wording.

import { getLocale, t } from '@/shared/i18n';
import { localeTag } from '@voice-room/shared/localization';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** '15 октября' */
export function dayMonth(at: number): string {
  return new Intl.DateTimeFormat(localeTag(getLocale()), { day: 'numeric', month: 'long' }).format(at);
}

/** '15 октября 2026 г.' */
export function dayMonthYear(at: number): string {
  return new Intl.DateTimeFormat(localeTag(getLocale()), { day: 'numeric', month: 'long', year: 'numeric' }).format(at);
}

/** '15 окт. 2026 г., 14:30' */
export function dateTime(at: number): string {
  return new Intl.DateTimeFormat(localeTag(getLocale()), { dateStyle: 'medium', timeStyle: 'short' }).format(at);
}

/** Coarse on purpose: "только что", "5 мин назад", "3 ч назад", "2 дн назад", then the date after a week. */
export function timeAgo(at: number, now: number): string {
  const elapsed = Math.max(0, now - at);
  if (elapsed < MINUTE) return t('только что');
  if (getLocale() !== 'ru' && elapsed < 7 * DAY) {
    const relative = new Intl.RelativeTimeFormat(getLocale(), { style: 'short', numeric: 'always' });
    if (elapsed < HOUR) return relative.format(-Math.floor(elapsed / MINUTE), 'minute');
    if (elapsed < DAY) return relative.format(-Math.floor(elapsed / HOUR), 'hour');
    return relative.format(-Math.floor(elapsed / DAY), 'day');
  }
  if (elapsed < HOUR) return t('{p0} мин назад', { p0: Math.floor(elapsed / MINUTE) });
  if (elapsed < DAY) return t('{p0} ч назад', { p0: Math.floor(elapsed / HOUR) });
  if (elapsed < 7 * DAY) return t('{p0} дн назад', { p0: Math.floor(elapsed / DAY) });
  return dayMonth(at);
}

/** '14:05': the 24-hour clock in the browser's time zone, whatever its locale. */
export function clockTime(at: number | Date | string): string {
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
