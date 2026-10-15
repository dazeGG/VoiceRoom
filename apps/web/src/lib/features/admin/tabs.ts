// The admin panel's tabs and the addresses the lobby keeps them in.

export const ADMIN_TABS = ['overview', 'product', 'system', 'reports'] as const;
export type AdminTab = (typeof ADMIN_TABS)[number];

const isTab = (value: string): value is AdminTab => (ADMIN_TABS as readonly string[]).includes(value);

/** The tab an address opens: /admin is the dashboard; an unknown tab is too. Null outside /admin. */
export function adminTabFromPath(pathname: string): AdminTab | null {
  const match = /^\/admin(?:\/([^/]*))?\/?$/.exec(pathname);
  if (!match) return null;
  const tab = match[1] ?? '';
  return isTab(tab) ? tab : 'overview';
}

export function adminPath(tab: AdminTab): string {
  return tab === 'overview' ? '/admin' : `/admin/${tab}`;
}
