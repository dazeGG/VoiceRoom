<script lang="ts">
  import { ChevronLeft } from '@lucide/svelte';
  import type { OwnedRoom } from '$lib/api/auth';
  import { iconMd } from '$lib/shared/ui/icons';
  import { roomDisplayName } from '../../model/rooms';
  import { RoomMenu } from '../room-menu';

  let { room, onBack, onToast } = $props<{
    room: OwnedRoom;
    onBack: () => void;
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
    {onToast}
  />
</div>
