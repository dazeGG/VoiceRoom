// Where the app starts and how the public site asks it for a room. The web app
// routes by these, the public site (apps/site) links to them, and the Caddyfile
// sends a signed-in browser and the app's old `/?…` links to APP_HOME.

/** The app's start: the lobby, or the landing and the phone's room start. `/` is the public site. */
export const APP_HOME = '/app';

/** The query of APP_HOME that makes a temporary room at once (the site's «Создать комнату»). */
export const START_ROOM_QUERY = { start: 'room' } as const;

/** The address the public site's «Создать комнату» opens. */
export const START_ROOM_HREF = `${APP_HOME}?${new URLSearchParams(START_ROOM_QUERY).toString()}`;

/** A room's address: `/r/<roomId>`. The app opens it straight into the room. */
export function roomHref(roomId: string): string {
  return `/r/${encodeURIComponent(roomId)}`;
}

/**
 * The room id in what a person typed or pasted: a room link (absolute, or a
 * path resolved against `origin`), `…/r/<id>`, or a bare code with or without `#`.
 * Empty when there is none.
 */
export function extractRoomId(value: string, origin: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '';

  try {
    const url = new URL(raw, origin);
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
