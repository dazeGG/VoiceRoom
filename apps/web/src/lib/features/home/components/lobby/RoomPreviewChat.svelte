<script lang="ts">
  // The lobby preview renders the same chat the room rail does: the only
  // difference is that this viewer has not joined voice, so they post as their
  // account instead of through a room peer session.
  import type { AuthUser } from '$lib/api/auth';
  import RoomChatPanel from '$lib/features/room/components/RoomChatPanel.svelte';
  import { friendName } from '../../model/lobby-format';

  let { roomId, user, onClose, onSelectParticipants, onToast } = $props<{
    roomId: string;
    user: AuthUser;
    onClose?: () => void;
    onSelectParticipants?: () => void;
    onToast?: (message: string) => void;
  }>();

  function resolveDisplayName(): string {
    return friendName(user);
  }
</script>

<RoomChatPanel
  {roomId}
  peerId={`auth-${user.id}`}
  {resolveDisplayName}
  rootClass="lobby-preview-chat"
  ariaLabel="Чат комнаты"
  onSelectParticipants={() => onSelectParticipants?.()}
  onCollapse={() => onClose?.()}
  onToast={(message) => onToast?.(message)}
/>
