<script lang="ts">
  // Stands in for RoomPage inside the lobby: it reaches the lobby only through
  // the room shell, as the real room does.
  import { useRoomShell } from '../../../src/lib/features/room/shell';

  let { embeddedRoomId = '', roomId = '' }: { embeddedRoomId?: string; roomId?: string } = $props();

  const shell = useRoomShell();
  const shownRoomId = $derived(embeddedRoomId || roomId);
</script>

<section aria-label={`Комната ${shownRoomId}`}>
  <button type="button" onclick={() => shell.roomLeft(shownRoomId)}>Покинуть комнату</button>
  <button type="button" onclick={() => shell.roomsChanged(shownRoomId)}>Сохранить комнату</button>
</section>
