import type { RoomPeerSummary } from '@voice-room/shared/contracts/realtime';
import type { AvatarStackItem } from '$lib/shared/ui';
import { getAvatarPresentation } from '$lib/features/room/client/ui/avatar-presentation';

export function roomPeerAvatarItems(peers: RoomPeerSummary[]): AvatarStackItem[] {
  return peers.map((peer) => {
    const avatar = getAvatarPresentation({
      avatarAccent: peer.avatarAccent || undefined,
      avatarColorKey: peer.avatarColorKey,
      avatarUrl: peer.avatarUrl || undefined,
      isLocal: false,
      name: peer.name?.trim() || 'Гость'
    });
    return {
      background: avatar.background,
      foreground: avatar.foreground,
      id: peer.id,
      initials: avatar.initials,
      label: avatar.label,
      shadow: avatar.shadow,
      src: avatar.src
    };
  });
}
