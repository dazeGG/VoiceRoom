// Where the app starts (packages/shared/src/app-home.ts): `/` is the public site;
// Caddy sends a signed-in browser and an old `/?…` link from there to here, and
// the router does the same for a navigation inside the app.
export { APP_HOME, START_ROOM_QUERY } from '@voice-room/shared/app-home';
