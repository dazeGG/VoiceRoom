import { t } from '@/shared/i18n';
import { dayMonth, dayMonthYear } from './date-format';

function startOfDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function isSameDay(a: number, b: number): boolean {
  return startOfDay(a) === startOfDay(b);
}

export function formatChatDayLabel(ms: number, nowMs = Date.now()): string {
  const today = startOfDay(nowMs);
  const day = startOfDay(ms);
  const dayMs = 24 * 60 * 60 * 1000;
  if (day === today) return t('Сегодня');
  if (day === today - dayMs) return t('Вчера');

  const date = new Date(ms);
  const now = new Date(nowMs);
  const isCalendarAnniversary =
    date.getFullYear() !== now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();

  return isCalendarAnniversary ? dayMonthYear(ms) : dayMonth(ms);
}
