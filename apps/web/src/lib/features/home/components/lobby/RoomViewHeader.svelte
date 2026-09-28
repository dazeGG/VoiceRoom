<script lang="ts">
  import { ChevronLeft } from '@lucide/svelte';
  import type { OwnedRoom } from '$lib/api/auth';
  import { iconMd } from '$lib/shared/ui/icons';
  import { roomDisplayName } from '../../model/rooms';
  import { useLobby } from '$lib/features/home/model/lobby-context';
  import { RoomMenu } from '$lib/shared/components/room-menu';

  const lobby = useLobby();

  let {
    room,
    presentUserIds = new Set<string>(),
    onBack,
    onOpenSettings,
    onRoomsChanged,
    onToast
  } = $props<{
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
    friends={lobby.friends}
    {presentUserIds}
    {onOpenSettings}
    {onRoomsChanged}
    {onToast}
  />
</div>

<style>
  :global(.lobby-roomview-head) {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  :global(.lobby-roomview-back) {
    flex: none;
    width: 40px;
    height: 40px;
    border-radius: 11px;
    border: 1px solid rgba(255, 255, 255, 0.09);
    background: var(--control);
    color: var(--warm-ink-dim);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 0.15s ease;
  }
  :where(.lobby-roomview-back):hover {
    background: var(--control-hover);
  }
</style>
