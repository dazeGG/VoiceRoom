<script lang="ts">
  import { state as roomClientState } from '../client/core/state.svelte';
  import RoomChat from './RoomChat.svelte';
  import RoomDock from './RoomDock.svelte';
  import ScreenStage from './ScreenStage.svelte';
  import StageTiles from './StageTiles.svelte';
  import { participantsUi } from '../participants-ui.svelte';
  import { syncRemoteCameraDemand } from '../client/services/livekit/remote-participants';

  // Each camera layer follows the size of its tile: re-pick them whenever the
  // spotlight, the screen stage or the number of people changes.
  $effect(() => {
    void participantsUi.focusedParticipantId;
    void roomClientState.viewedScreenPeerId;
    void roomClientState.peers.size;
    syncRemoteCameraDemand();
  });
</script>

<main class="room-layout" id="roomScreen" hidden={roomClientState.screen !== 'room'}>
  <section class="stage" aria-label="Голосовая комната">
    <ScreenStage />
    <StageTiles />
    <RoomDock />
  </section>
  <RoomChat />
</main>
