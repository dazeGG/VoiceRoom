export function avatarUrl(avatarKey: string | null | undefined): string | null {
  return avatarKey ? `/api/avatars/${encodeURIComponent(avatarKey)}` : null;
}
