import { t } from '@/shared/i18n';
import type { RoomPeerSummary } from '@voiceroom/shared/contracts/realtime';
import type { AvatarStackItem } from '@voiceroom/ui-kit/components';
import { getAvatarPresentation } from '@voiceroom/ui/avatar-presentation';

export function roomPeerAvatarItems(peers: RoomPeerSummary[]): AvatarStackItem[] {
  return peers.map((peer) => {
    const avatar = getAvatarPresentation({
      avatarAccent: peer.avatarAccent || undefined,
      avatarColorKey: peer.avatarColorKey,
      avatarUrl: peer.avatarUrl || undefined,
      isLocal: false,
      name: peer.name?.trim() || t('Гость')
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
