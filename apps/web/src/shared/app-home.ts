import { APP_HOME as LEGACY_APP_HOME } from '@voice-room/shared/app-home';

export { LEGACY_APP_HOME };
export { START_ROOM_QUERY } from '@voice-room/shared/app-home';

export const PRODUCTION_APP_HOST = 'app.voiceroom.ru';

// The dedicated production host owns its root. Existing single-origin installs
// keep /app so their public home page and existing links stay available.
export function appHomeForHost(hostname: string): '/' | typeof LEGACY_APP_HOME {
  return hostname.toLowerCase() === PRODUCTION_APP_HOST ? '/' : LEGACY_APP_HOME;
}

export const APP_HOME = appHomeForHost(globalThis.location?.hostname ?? '');
