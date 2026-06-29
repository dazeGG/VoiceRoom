<script lang="ts">
  import { onMount } from 'svelte';
  import '$lib/shared/styles/typography.css';
  import '$lib/shared/styles/app.css';
  import '$lib/shared/styles/dialog.css';
  import './styles/room.css';
  import NotFoundScreen from './components/NotFoundScreen.svelte';
  import RoomEntryErrorScreen from './components/RoomEntryErrorScreen.svelte';
  import RoomOverlays from './components/RoomOverlays.svelte';
  import RoomSettingsDialog from './components/RoomSettingsDialog.svelte';
  import RoomStage from './components/RoomStage.svelte';
  import RoomTopbar from './components/RoomTopbar.svelte';
  import StartRoomScreen from './components/StartRoomScreen.svelte';
  import { setRoomEmbedded } from './client/core/embed';

  let { embeddedRoomId = '', roomId = '', autoJoin = false } = $props<{
    embeddedRoomId?: string;
    roomId?: string;
    autoJoin?: boolean;
  }>();

  let roomRoot = $state<HTMLElement>();
  const embedded = $derived(Boolean(embeddedRoomId));

  onMount(() => {
    let cleanup: (() => void) | undefined;
    setRoomEmbedded(Boolean(embeddedRoomId));

    void import('./client/main').then(({ mountRoomClient }) => {
      if (!roomRoot) return;
      cleanup = mountRoomClient(roomRoot, { roomId: embeddedRoomId || roomId, embeddedRoomId, autoJoin });
    });

    return () => {
      cleanup?.();
      setRoomEmbedded(false);
    };
  });
</script>

<div class="app-shell" class:room-embedded-shell={embedded} bind:this={roomRoot}>
  <RoomTopbar />
  <StartRoomScreen />
  <RoomStage />
  <RoomEntryErrorScreen />
  <NotFoundScreen />
  <RoomOverlays />
  <RoomSettingsDialog />
</div>
