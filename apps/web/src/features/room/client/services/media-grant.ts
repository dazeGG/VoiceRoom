// The server's media budget as the room sees it: ask before a screen share or
// a camera starts, and word a refusal for the person.

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
    return `В комнате не больше ${refusal.maxRoomScreens} демонстраций одновременно. Дождитесь, пока одна закончится`;
  }
  const what = refusal.kind === 'camera' ? 'камера недоступна' : 'демонстрация недоступна';
  return `Сервер сейчас загружен, ${what}. Попробуйте через пару минут`;
}
