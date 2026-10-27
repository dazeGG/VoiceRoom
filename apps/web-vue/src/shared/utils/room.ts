export function extractRoomId(value: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '';

  try {
    const url = new URL(raw, window.location.origin);
    const fromPath = url.pathname.match(/^\/r\/([A-Za-z0-9_-]{3,48})\/?$/)?.[1];
    if (fromPath) return fromPath;
  } catch {
    // Plain room codes are handled below.
  }

  const fromRoute = raw.match(/(?:^|\/)r\/([A-Za-z0-9_-]{3,48})\/?$/)?.[1];
  if (fromRoute) return fromRoute;

  const compact = raw.replace(/^#/, '').trim();
  return /^[A-Za-z0-9_-]{3,48}$/.test(compact) ? compact : '';
}
