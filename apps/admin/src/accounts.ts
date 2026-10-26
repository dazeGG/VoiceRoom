// How the accounts section words things: the list's filters and columns, the
// block terms, and each entry of the administrators' log.

import {
  AccountsFilter,
  BlockDuration,
  type AccountsSort,
  type AdminActionEntry
} from '@voice-room/shared/contracts/admin';
import { STAFF_ROLE_LABELS } from '@voice-room/shared/contracts/staff';
import { formatDateTime } from './format.ts';

const FILTER_LABELS: Record<AccountsFilter, string> = {
  all: 'Все',
  online: 'В сети',
  new: 'Новые за неделю',
  active: 'Активные за неделю',
  gone: 'Пропавшие (2+ недели)',
  blocked: 'Заблокированные',
  deleting: 'Удаляются',
  badged: 'С отметкой'
};

/** The list's filters in the contract's order. */
export const ACCOUNT_FILTERS = AccountsFilter.anyOf.map(({ const: value }) => ({ value, label: FILTER_LABELS[value] }));

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

const DURATION_LABELS: Record<BlockDuration, string> = {
  day: 'Сутки',
  week: 'Неделя',
  month: 'Месяц',
  forever: 'Навсегда'
};

/** The block terms in the contract's order, the shortest first. */
export const BLOCK_DURATIONS = BlockDuration.anyOf.map(({ const: value }) => ({
  value,
  label: DURATION_LABELS[value]
}));

export function blockTerm(until: number | null): string {
  return until === null ? 'навсегда' : `до ${formatDateTime(until)}`;
}

function describeBadge(badge: AdminActionEntry['badge']): string {
  switch (badge) {
    case 'official':
      return 'Отмечен как официальный';
    case 'verified':
      return 'Отмечен как подтверждённый';
    case null:
      return 'Отметка снята';
  }
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
      return describeBadge(entry.badge);
    case 'staff_role':
      return entry.role ? `Выдана роль: ${STAFF_ROLE_LABELS[entry.role]}` : 'Роль снята';
  }
}
