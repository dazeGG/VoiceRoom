// The admin panel's tabs and the addresses the lobby keeps them in; an
// account's card has its own address under the accounts tab.

export const ADMIN_TABS = ['overview', 'product', 'system', 'accounts', 'reports'] as const;
export type AdminTab = (typeof ADMIN_TABS)[number];

/** Where in the panel an address points: a tab, and on the accounts tab maybe one account. */
export interface AdminLocation {
  tab: AdminTab;
  accountId: string | null;
}

const isTab = (value: string): value is AdminTab => (ADMIN_TABS as readonly string[]).includes(value);

/** /admin is the dashboard, and so is an unknown tab; /admin/accounts/<id> is a card. Null outside /admin. */
export function adminLocationFromPath(pathname: string): AdminLocation | null {
  const card = /^\/admin\/accounts\/([^/]+)\/?$/.exec(pathname);
  if (card) return { tab: 'accounts', accountId: decodeURIComponent(card[1]) };
  const match = /^\/admin(?:\/([^/]*))?\/?$/.exec(pathname);
  if (!match) return null;
  const tab = match[1] ?? '';
  return { tab: isTab(tab) ? tab : 'overview', accountId: null };
}

/** The tab an address opens. Null outside /admin. */
export function adminTabFromPath(pathname: string): AdminTab | null {
  return adminLocationFromPath(pathname)?.tab ?? null;
}

export function adminPath(tab: AdminTab, accountId: string | null = null): string {
  if (tab === 'accounts' && accountId) return `/admin/accounts/${encodeURIComponent(accountId)}`;
  return tab === 'overview' ? '/admin' : `/admin/${tab}`;
}
