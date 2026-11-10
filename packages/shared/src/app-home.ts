// Where the app starts and how the public site asks it for a room. The web app
// routes by these, the public site (apps/site) links to them, and the Caddyfile
// sends a signed-in browser and the app's old `/?…` links to APP_HOME.

/** The app's start: the lobby, or the landing and the phone's room start. `/` is the public site. */
export const APP_HOME = '/app';

/** The query of APP_HOME that makes a temporary room at once (the site's «Создать комнату»). */
export const START_ROOM_QUERY = { start: 'room' } as const;

/** The address the public site's «Создать комнату» opens. */
export const START_ROOM_HREF = `${APP_HOME}?${new URLSearchParams(START_ROOM_QUERY).toString()}`;
