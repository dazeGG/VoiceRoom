// The admin app's sections, their addresses, the menu groups they sit in and
// who may open each. An account's card has its own address under the accounts
// section.

import type { StaffPermission } from '@voice-room/shared/contracts/staff';

export const ADMIN_TABS = [
  'overview',
  'product',
  'feedback',
  'system',
  'accounts',
  'rooms',
  'reports',
  'staff'
] as const;
export type AdminTab = (typeof ADMIN_TABS)[number];

/** The menu's groups; their sections follow the order of ADMIN_TABS. */
export const TAB_GROUPS: readonly { label: string; tabs: readonly AdminTab[] }[] = [
  { label: 'Аналитика', tabs: ['overview', 'product', 'feedback', 'system'] },
  { label: 'Модерация', tabs: ['accounts', 'rooms', 'reports'] },
  { label: 'Команда', tabs: ['staff'] }
];

/** The top bar's title where it says more than the menu: the menu's "Отзывы" are of calls. */
export const TAB_TITLES: Record<AdminTab, string> = {
  overview: 'Обзор',
  product: 'Продукт',
  feedback: 'Отзывы о звонках',
  system: 'Сервер',
  accounts: 'Аккаунты',
  rooms: 'Комнаты',
  reports: 'Жалобы',
  staff: 'Сотрудники'
};

export const TAB_LABELS: Record<AdminTab, string> = {
  overview: 'Обзор',
  product: 'Продукт',
  system: 'Сервер',
  accounts: 'Аккаунты',
  rooms: 'Комнаты',
  reports: 'Жалобы',
  feedback: 'Отзывы',
  staff: 'Сотрудники'
};

export const TAB_PERMISSIONS: Record<AdminTab, StaffPermission> = {
  overview: 'stats.view',
  product: 'stats.view',
  system: 'stats.view',
  accounts: 'accounts.view',
  rooms: 'rooms.view',
  reports: 'reports.review',
  feedback: 'stats.view',
  staff: 'staff.manage'
};

export interface AdminLocation {
  tab: AdminTab;
  accountId: string | null;
}

function isTab(value: string): value is AdminTab {
  return ADMIN_TABS.some((tab) => tab === value);
}

/** "/" is the overview, "/accounts/<id>" a card; an unknown address is the overview too. */
export function locationFromPath(pathname: string): AdminLocation {
  const card = /^\/accounts\/([^/]+)\/?$/.exec(pathname);
  if (card?.[1]) return { tab: 'accounts', accountId: decodeURIComponent(card[1]) };
  const name = /^\/([^/]*)\/?$/.exec(pathname)?.[1] ?? '';
  return { tab: isTab(name) ? name : 'overview', accountId: null };
}

export function pathOf({ tab, accountId }: AdminLocation): string {
  if (tab === 'accounts' && accountId) return `/accounts/${encodeURIComponent(accountId)}`;
  return tab === 'overview' ? '/' : `/${tab}`;
}

/** The sections this role may open, in the panel's order. */
export function allowedTabs(permissions: readonly StaffPermission[]): AdminTab[] {
  return ADMIN_TABS.filter((tab) => permissions.includes(TAB_PERMISSIONS[tab]));
}
