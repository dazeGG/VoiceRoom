<script lang="ts">
  import { onMount } from 'svelte';
  import '$lib/shared/styles/typography.css';
  import '$lib/shared/styles/app.css';
  import '$lib/shared/styles/dialog.css';
  import './styles/room.css';
  import GuestLeaveScreen from './components/GuestLeaveScreen.svelte';
  import NotFoundScreen from './components/NotFoundScreen.svelte';
  import RoomEntryErrorScreen from './components/RoomEntryErrorScreen.svelte';
  import RoomModerationScreen from './components/RoomModerationScreen.svelte';
  import RoomCtaSlot from './components/RoomCtaSlot.svelte';
  import RoomOverlays from './components/RoomOverlays.svelte';
  import RoomSettingsDialog from './components/RoomSettingsDialog.svelte';
  import RoomStage from './components/RoomStage.svelte';
  import RoomTopbar from './components/RoomTopbar.svelte';
  import StartRoomScreen from './components/StartRoomScreen.svelte';
  import { applyDesktopBoundaryToDocument } from '$lib/platform/desktop-boundary';
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
    const policy = applyDesktopBoundaryToDocument();
    if (!policy.desktopAllowed) return;

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
  <RoomCtaSlot />
  <StartRoomScreen />
  <RoomStage />
  <RoomEntryErrorScreen />
  <RoomModerationScreen />
  <NotFoundScreen />
  <RoomOverlays />
  <RoomSettingsDialog />
  <GuestLeaveScreen />
</div>

<style>
  /* Anchors the account/app call to action without taking a grid row. */
  .app-shell {
    position: relative;
  }
</style>
