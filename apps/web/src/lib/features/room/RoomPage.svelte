<script lang="ts">
  import { onMount } from 'svelte';
  import '$lib/shared/styles/typography.css';
  import '$lib/shared/styles/app.css';
  import '$lib/shared/styles/dialog.css';
  import './styles/room.css';
  import NotFoundScreen from './components/NotFoundScreen.svelte';
  import RoomOverlays from './components/RoomOverlays.svelte';
  import RoomSettingsDialog from './components/RoomSettingsDialog.svelte';
  import RoomStage from './components/RoomStage.svelte';
  import RoomTopbar from './components/RoomTopbar.svelte';
  import StartRoomScreen from './components/StartRoomScreen.svelte';

  let roomRoot = $state<HTMLElement>();

  onMount(() => {
    let cleanup: (() => void) | undefined;

    void import('./client/main').then(({ mountRoomClient }) => {
      if (!roomRoot) return;
      cleanup = mountRoomClient(roomRoot);
    });

    return () => cleanup?.();
  });
</script>

<div class="app-shell" bind:this={roomRoot}>
  <RoomTopbar />
  <StartRoomScreen />
  <RoomStage />
  <NotFoundScreen />
  <RoomOverlays />
  <RoomSettingsDialog />
</div>
