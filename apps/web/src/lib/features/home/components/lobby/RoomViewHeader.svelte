<script lang="ts">
  import { ChevronLeft } from '@lucide/svelte';
  import type { OwnedRoom } from '$lib/api/auth';
  import { iconMd } from '$lib/shared/ui/icons';
  import { roomDisplayName } from '../../model/rooms';
  import { friendsState } from '../../model/friends.svelte';
  import { RoomMenu } from '$lib/shared/components/room-menu';

  let { room, presentUserIds = new Set<string>(), onBack, onOpenSettings, onRoomsChanged, onToast } = $props<{
    room: OwnedRoom;
    presentUserIds?: Set<string>;
    onBack: () => void;
    onOpenSettings?: () => void;
    onRoomsChanged?: () => void;
    onToast?: (message: string) => void;
  }>();

  const name = $derived(roomDisplayName(room));
</script>

<div class="lobby-roomview-head">
  <button class="lobby-roomview-back" type="button" title="К списку комнат" aria-label="Назад" onclick={onBack}>
    <ChevronLeft {...iconMd} aria-hidden="true" />
  </button>

  <RoomMenu
    roomId={room.roomId}
    {name}
    avatarUrl={room.avatarUrl}
    avatarSize={34}
    triggerClass="lobby-roomview-trigger"
    titleClass="lobby-roomview-name"
    chevronClass="lobby-roomview-chevron"
    relationship={room.relationship}
    friends={friendsState.friends}
    {presentUserIds}
    {onOpenSettings}
    {onRoomsChanged}
    {onToast}
  />
</div>
