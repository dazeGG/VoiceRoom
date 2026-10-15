// How the admin panel writes its numbers.

const integer = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

export function formatCount(value: number): string {
  return integer.format(value);
}

export function formatHours(value: number): string {
  return `${oneDecimal.format(value)} ч`;
}

export function formatPercent(value: number | null): string {
  return value === null ? '—' : `${oneDecimal.format(value)}%`;
}

export function formatBytes(value: number | null): string {
  if (value === null) return '—';
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${oneDecimal.format(size)} ${units[unit]}`;
}

export function formatMs(value: number | null): string {
  return value === null ? '—' : `${oneDecimal.format(value)} мс`;
}

/** '2026-10-15' → '15.10'. */
export function formatDay(day: string): string {
  const [, month, date] = day.split('-');
  return month && date ? `${date}.${month}` : day;
}

/** A sample's time: the clock for a day or less, the date with it for longer. */
export function formatSampleTime(at: number, withDate: boolean): string {
  return new Intl.DateTimeFormat('ru-RU', {
    ...(withDate ? { day: '2-digit', month: '2-digit' } : {}),
    hour: '2-digit',
    minute: '2-digit'
  }).format(at);
}

/** How long ago, roughly: "3 дн 4 ч", "5 ч 12 мин", "40 мин". */
export function formatSince(from: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - from) / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `${days} дн ${hours} ч`;
  if (hours > 0) return `${hours} ч ${minutes % 60} мин`;
  return `${minutes} мин`;
}

const shortDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
const dateTime = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit'
});

/** '15 окт. 2026 г.' */
export function formatDate(at: number): string {
  return shortDate.format(at);
}

/** '15 окт., 14:30' */
export function formatDateTime(at: number): string {
  return dateTime.format(at);
}

/** When someone was last seen, by calendar day: "сегодня", "вчера", "5 дн назад", or the date after two months. */
export function formatAgo(at: number, now: number): string {
  const startOfDay = (time: number) => new Date(time).setHours(0, 0, 0, 0);
  const days = Math.round((startOfDay(now) - startOfDay(at)) / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'сегодня';
  if (days === 1) return 'вчера';
  if (days < 60) return `${days} дн назад`;
  return formatDate(at);
}

/** Voice time: "35 мин" under an hour, "2,5 ч" from there. */
export function formatMinutes(minutes: number): string {
  if (minutes <= 0) return '—';
  return minutes < 60 ? `${Math.round(minutes)} мин` : formatHours(minutes / 60);
}
