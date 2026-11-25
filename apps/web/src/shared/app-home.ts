import { APP_HOME as LEGACY_APP_HOME } from '@voiceroom/shared/app-home';

export { LEGACY_APP_HOME };
export { START_ROOM_QUERY } from '@voiceroom/shared/app-home';

export const PRODUCTION_APP_HOST = 'app.voiceroom.ru';
const ROOT_APP_HOSTS = new Set([PRODUCTION_APP_HOST, 'app.dev.voiceroom.ru']);

// Dedicated app hosts own their root. Existing single-origin installs
// keep /app so their public home page and existing links stay available.
export function appHomeForHost(hostname: string): '/' | typeof LEGACY_APP_HOME {
  return ROOT_APP_HOSTS.has(hostname.toLowerCase()) ? '/' : LEGACY_APP_HOME;
}

export const APP_HOME = appHomeForHost(globalThis.location?.hostname ?? '');

export const DM_CALL_CHAT_HASH = '#chat';

export function dmPath(peerId: string): string {
  return `${APP_HOME}?dm=${encodeURIComponent(peerId)}`;
}
