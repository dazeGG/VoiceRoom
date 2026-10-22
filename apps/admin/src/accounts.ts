// How the accounts section words things: the list's filters and columns, the
// block terms, and each entry of the administrators' log.

import type { AccountsFilter, AccountsSort, AdminActionEntry, BlockDuration } from '@voice-room/shared/contracts/admin';
import { STAFF_ROLE_LABELS } from '@voice-room/shared/contracts/staff';
import { formatDateTime } from './format.ts';

export const ACCOUNT_FILTERS: { value: AccountsFilter; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'online', label: 'В сети' },
  { value: 'new', label: 'Новые за неделю' },
  { value: 'active', label: 'Активные за неделю' },
  { value: 'gone', label: 'Пропавшие (2+ недели)' },
  { value: 'blocked', label: 'Заблокированные' },
  { value: 'deleting', label: 'Удаляются' },
  { value: 'badged', label: 'С отметкой' }
];

/** The list's columns that sort, and the order each starts in when picked. */
export const SORT_COLUMNS: { sort: AccountsSort; label: string; first: 'asc' | 'desc' }[] = [
  { sort: 'name', label: 'Аккаунт', first: 'asc' },
  { sort: 'created', label: 'Регистрация', first: 'desc' },
  { sort: 'lastSeen', label: 'Визит', first: 'desc' },
  { sort: 'activeDays', label: 'Дней', first: 'desc' },
  { sort: 'voice', label: 'Войс', first: 'desc' },
  { sort: 'messages', label: 'Сообщений', first: 'desc' },
  { sort: 'reports', label: 'Жалоб', first: 'desc' }
];

export const BLOCK_DURATIONS: { value: BlockDuration; label: string }[] = [
  { value: 'day', label: 'Сутки' },
  { value: 'week', label: 'Неделя' },
  { value: 'month', label: 'Месяц' },
  { value: 'forever', label: 'Навсегда' }
];

export function blockTerm(until: number | null): string {
  return until === null ? 'навсегда' : `до ${formatDateTime(until)}`;
}

/** One log entry as a line: what was done, with its term, mark or role. */
export function describeAction(entry: AdminActionEntry): string {
  switch (entry.action) {
    case 'block':
      return `Блокировка ${blockTerm(entry.until)}`;
    case 'unblock':
      return 'Блокировка снята';
    case 'logout':
      return 'Все сеансы завершены';
    case 'delete':
      return 'Аккаунт отправлен на удаление';
    case 'cancel_deletion':
      return 'Удаление отменено';
    case 'badge':
      return entry.badge === 'official'
        ? 'Отмечен как официальный'
        : entry.badge === 'verified'
          ? 'Отмечен как подтверждённый'
          : 'Отметка снята';
    case 'staff_role':
      return entry.role ? `Выдана роль: ${STAFF_ROLE_LABELS[entry.role]}` : 'Роль снята';
  }
}
