// Who runs the service: the accounts the operator named in
// PLATFORM_ADMIN_USER_IDS. They review reports and open the admin panel.

export function isPlatformAdmin(adminUserIds: readonly string[], userId: string | null | undefined): boolean {
  return Boolean(userId && adminUserIds.includes(userId));
}
