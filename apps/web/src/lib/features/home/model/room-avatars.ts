import type { RoomPeer } from '$lib/api/rooms';
import type { AvatarStackItem } from '$lib/shared/ui';
import { getAvatarPresentation } from '$lib/features/room/client/ui/avatar-presentation';

export function roomPeerAvatarItems(peers: RoomPeer[]): AvatarStackItem[] {
  return peers.map((peer) => {
    const avatar = getAvatarPresentation({
      avatarColorKey: peer.avatarColorKey,
      isLocal: false,
      name: peer.name?.trim() || 'Гость'
    });
    return {
      background: avatar.background,
      foreground: avatar.foreground,
      id: peer.id,
      initials: avatar.initials,
      label: avatar.label,
      shadow: avatar.shadow
    };
  });
}
