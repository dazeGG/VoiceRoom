<script lang="ts">
  import RoomChat from './RoomChat.svelte';
  import RoomDock from './RoomDock.svelte';
  import ScreenStage from './ScreenStage.svelte';
  import StageTiles from './StageTiles.svelte';
</script>

<main class="room-layout" id="roomScreen" hidden>
  <section class="stage" aria-label="Голосовая комната">
    <ScreenStage />
    <StageTiles />
    <RoomDock />
  </section>
  <RoomChat />
</main>
