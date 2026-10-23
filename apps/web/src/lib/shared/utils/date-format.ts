// How dates and relative times are written in the interface. One locale, one wording.

const dayMonthFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
const dayMonthYearFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
const dateTimeFormat = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** '15 октября' */
export function dayMonth(at: number): string {
  return dayMonthFormat.format(at);
}

/** '15 октября 2026 г.' */
export function dayMonthYear(at: number): string {
  return dayMonthYearFormat.format(at);
}

/** '15 окт. 2026 г., 14:30' */
export function dateTime(at: number): string {
  return dateTimeFormat.format(at);
}

/** Coarse on purpose: "только что", "5 мин назад", "3 ч назад", "2 дн назад", then the date after a week. */
export function timeAgo(at: number, now: number): string {
  const elapsed = Math.max(0, now - at);
  if (elapsed < MINUTE) return 'только что';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} мин назад`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} ч назад`;
  if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)} дн назад`;
  return dayMonth(at);
}

/** '14:05': the 24-hour clock in the browser's time zone, whatever its locale. */
export function clockTime(at: number | Date | string): string {
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
