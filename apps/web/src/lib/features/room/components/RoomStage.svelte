<script lang="ts">
  import { state as roomClientState } from '../client/core/state.svelte';
  import RoomChat from './RoomChat.svelte';
  import RoomDock from './RoomDock.svelte';
  import ScreenStage from './ScreenStage.svelte';
  import StageTiles from './StageTiles.svelte';
  import { participantsUi } from '../participants-ui.svelte';
  import { getMobileSpotlightPeerId, isMobileCallActive } from '../mobile-call-ui.svelte';
  import { syncRemoteCameraDemand } from '../client/services/livekit/remote-participants';

  // A phone draws the call itself (MobileCallStage) until someone's screen is opened.
  const mobileCall = $derived(isMobileCallActive());
  const mobileSpotlight = $derived(getMobileSpotlightPeerId());

  // Each camera layer follows the size of its tile: re-pick them whenever the
  // spotlight, the screen stage or the number of people changes.
  $effect(() => {
    void participantsUi.focusedParticipantId;
    void mobileCall;
    void mobileSpotlight;
    void roomClientState.viewedScreenPeerId;
    void roomClientState.peers.size;
    syncRemoteCameraDemand();
  });
</script>

<main class="room-layout" id="roomScreen" hidden={roomClientState.screen !== 'room'}>
  <section class="stage" aria-label="Голосовая комната">
    <ScreenStage />
    {#if !mobileCall}
      <StageTiles />
      <RoomDock />
    {/if}
  </section>
  <RoomChat />
</main>
