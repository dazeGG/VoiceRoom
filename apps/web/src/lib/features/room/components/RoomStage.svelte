<script lang="ts">
  import { state as roomClientState } from '../client/core/state.svelte';
  import RoomChat from './RoomChat.svelte';
  import RoomDock from './RoomDock.svelte';
  import ScreenStage from './ScreenStage.svelte';
  import StageTiles from './StageTiles.svelte';
</script>

<main
  class="room-layout"
  id="roomScreen"
  hidden={roomClientState.screen !== 'room'}
>
  <section class="stage" aria-label="Голосовая комната">
    <ScreenStage />
    <StageTiles />
    <RoomDock />
  </section>
  <RoomChat />
</main>
