// The routes a phone may open. A phone gets the room page and `/`, where the
// route offers to start one, plus the public legal pages, which everyone must
// be able to read; the lobby and the account screens stay desktop-only.

const MOBILE_ROUTES = new Set(['/r/[roomId]', '/', '/terms', '/privacy', '/licenses']);

export function isMobileRoute(routeId: string | null | undefined): boolean {
  return MOBILE_ROUTES.has(routeId ?? '');
}
