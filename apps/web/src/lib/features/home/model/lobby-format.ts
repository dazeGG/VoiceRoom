// Small presentational helpers shared by the lobby views.

import type { PublicUser } from '$lib/api/friends';
import { getAvatarColor } from '$lib/visual/tokens';

export function friendName(user: Pick<PublicUser, 'displayName' | 'login'>): string {
  return user.displayName?.trim() || user.login;
}

export function initial(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : '?';
}

export function avatarBackground(colorKey: string | null | undefined): string {
  return getAvatarColor(colorKey).background;
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

export function formatTime(ms: number): string {
  const date = new Date(ms);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// "Сегодня" / "Вчера" / "12 марта" for DM day separators.
const MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
];

function startOfDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function formatDayLabel(ms: number): string {
  const today = startOfDay(Date.now());
  const day = startOfDay(ms);
  const dayMs = 24 * 60 * 60 * 1000;
  if (day === today) return 'Сегодня';
  if (day === today - dayMs) return 'Вчера';
  const date = new Date(ms);
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

export function isSameDay(a: number, b: number): boolean {
  return startOfDay(a) === startOfDay(b);
}
