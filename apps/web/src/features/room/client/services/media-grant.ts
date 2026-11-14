// The server's media budget as the room sees it: ask before a screen share or
// a camera starts, and word a refusal for the person.

import { t } from '@/shared/i18n';
import type { MediaGrant, MediaKind } from '@voice-room/shared/contracts/realtime';
import { requestMediaGrant } from '@/entities/room/room-realtime';
import { state } from '../core/room-runtime.store';

export type MediaRefusal = Extract<MediaGrant, { granted: false }>;

/** Resolves null when the server did not answer: go ahead as asked. */
export function askForMedia(kind: MediaKind, profileId?: string): Promise<MediaGrant | null> {
  return requestMediaGrant({
    roomId: state.roomId,
    peerId: state.peerId,
    sessionToken: state.sessionToken,
    kind,
    ...(profileId ? { profileId } : {})
  });
}

export function describeMediaRefusal(refusal: MediaRefusal): string {
  if (refusal.reason === 'room_screens_full') {
    return t('В комнате не больше {p0} демонстраций одновременно. Дождитесь, пока одна закончится', {
      p0: refusal.maxRoomScreens
    });
  }
  const what = refusal.kind === 'camera' ? t('камера недоступна') : t('демонстрация недоступна');
  return t('Сервер сейчас загружен, {p0}. Попробуйте через пару минут', { p0: what });
}
