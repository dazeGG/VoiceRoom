<script lang="ts">
  import { onMount } from 'svelte';
  import '$lib/shared/styles/typography.css';
  import '$lib/shared/styles/app.css';
  import './client/styles.css';
  import NotFoundScreen from './components/NotFoundScreen.svelte';
  import RoomOverlays from './components/RoomOverlays.svelte';
  import RoomStage from './components/RoomStage.svelte';
  import RoomTopbar from './components/RoomTopbar.svelte';
  import StartRoomScreen from './components/StartRoomScreen.svelte';

  let roomRoot = $state<HTMLElement>();

  onMount(async () => {
    if (!roomRoot) return;
    const { mountRoomClient } = await import('./client/main');
    mountRoomClient(roomRoot);
  });
</script>

<div class="app-shell" bind:this={roomRoot}>
  <RoomTopbar />
  <StartRoomScreen />
  <RoomStage />
  <NotFoundScreen />
  <RoomOverlays />
</div>
