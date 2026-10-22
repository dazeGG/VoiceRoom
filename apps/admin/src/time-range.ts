// The span an admin chart shows: one of the ready-made "last …" choices, or
// the administrator's own from–to. Product charts count Moscow days; server
// charts count moments.

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export type TimeRange = { kind: 'preset'; id: string } | { kind: 'custom'; from: number; to: number };

export interface RangePreset {
  id: string;
  label: string;
  /** The label on the row of choices, where room is short. */
  short: string;
  /** How far back from now; null is "from the very beginning". */
  spanMs: number | null;
}

export const PRODUCT_PRESETS: readonly RangePreset[] = [
  { id: '7d', label: 'Последние 7 дней', short: '7 дней', spanMs: 7 * DAY },
  { id: '14d', label: 'Последние 14 дней', short: '14 дней', spanMs: 14 * DAY },
  { id: '30d', label: 'Последние 30 дней', short: '30 дней', spanMs: 30 * DAY },
  { id: '90d', label: 'Последние 90 дней', short: '90 дней', spanMs: 90 * DAY },
  { id: '180d', label: 'Последние полгода', short: 'Полгода', spanMs: 180 * DAY },
  { id: '365d', label: 'Последний год', short: 'Год', spanMs: 365 * DAY },
  { id: 'all', label: 'Всё время', short: 'Всё время', spanMs: null }
];

export const SYSTEM_PRESETS: readonly RangePreset[] = [
  { id: '1h', label: 'Последний час', short: '1 ч', spanMs: HOUR },
  { id: '3h', label: 'Последние 3 часа', short: '3 ч', spanMs: 3 * HOUR },
  { id: '6h', label: 'Последние 6 часов', short: '6 ч', spanMs: 6 * HOUR },
  { id: '12h', label: 'Последние 12 часов', short: '12 ч', spanMs: 12 * HOUR },
  { id: '24h', label: 'Последние сутки', short: 'Сутки', spanMs: DAY },
  { id: '2d', label: 'Последние 2 дня', short: '2 дня', spanMs: 2 * DAY },
  { id: '7d', label: 'Последние 7 дней', short: '7 дней', spanMs: 7 * DAY },
  { id: '30d', label: 'Последние 30 дней', short: '30 дней', spanMs: 30 * DAY }
];

const moscowDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Moscow',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

/** The Moscow day of a moment, 'YYYY-MM-DD': product days are Moscow days. */
export function moscowDay(at: number): string {
  return moscowDate.format(at);
}

/** The product days a range asks for; the server clamps them to what exists. */
export function productQuery(range: TimeRange, presets: readonly RangePreset[], now: number) {
  if (range.kind === 'custom') return { from: moscowDay(range.from), to: moscowDay(range.to) };
  const preset = presets.find((item) => item.id === range.id);
  if (!preset || preset.spanMs === null) return { from: '2000-01-01', to: moscowDay(now) };
  // "Last 7 days" is today and the six before it.
  return { from: moscowDay(now - preset.spanMs + DAY), to: moscowDay(now) };
}

/** The moments a server range asks for. */
export function systemQuery(range: TimeRange, presets: readonly RangePreset[], now: number) {
  if (range.kind === 'custom') return { from: String(range.from), to: String(range.to) };
  const spanMs = presets.find((item) => item.id === range.id)?.spanMs ?? DAY;
  return { from: String(now - spanMs), to: String(now) };
}

const dateLabel = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
const timeLabel = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit'
});

export function rangeLabel(range: TimeRange, presets: readonly RangePreset[], withTime: boolean): string {
  if (range.kind === 'preset') return presets.find((item) => item.id === range.id)?.label ?? range.id;
  const format = withTime ? timeLabel : dateLabel;
  return `${format.format(range.from)} — ${format.format(range.to)}`;
}

const pad = (value: number) => String(value).padStart(2, '0');

/** A moment as an <input type="date"> or "datetime-local"> value, in local time. */
export function toInputValue(at: number, withTime: boolean): string {
  const date = new Date(at);
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return withTime ? `${day}T${pad(date.getHours())}:${pad(date.getMinutes())}` : day;
}

/** An input's value back to a moment (local time), or null when it is not one. */
export function fromInputValue(value: string, withTime: boolean): number | null {
  if (!value) return null;
  const at = withTime ? new Date(value).getTime() : new Date(`${value}T12:00`).getTime();
  return Number.isFinite(at) ? at : null;
}
