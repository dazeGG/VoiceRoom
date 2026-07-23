<script lang="ts">
  import { getCapabilityFeature } from '$lib/platform/capability-state.svelte';
  import RoomMemberList from '$lib/features/home/components/lobby/RoomMemberList.svelte';
  import { state as roomClientState } from '../client/core/state.svelte';
  import { roomUi } from '../room-ui.svelte';
  import RoomChat from './RoomChat.svelte';
  import RoomDock from './RoomDock.svelte';
  import ScreenStage from './ScreenStage.svelte';
  import StageTiles from './StageTiles.svelte';

  let { roomId = '' }: { roomId?: string } = $props();
  let membershipEnabled = $state(false);

  $effect(() => {
    let active = true;
    void getCapabilityFeature('membership').then((enabled) => {
      if (active) membershipEnabled = enabled;
    });
    return () => {
      active = false;
    };
  });
</script>

<main
  class="room-layout"
  id="roomScreen"
  data-members-open={membershipEnabled && !roomUi.chatOpen}
  hidden={roomClientState.screen !== 'room'}
>
  <section class="stage" aria-label="Голосовая комната">
    <ScreenStage />
    <StageTiles />
    <RoomDock />
  </section>
  {#if membershipEnabled && !roomUi.chatOpen && roomId}
    <aside class="room-members-rail" aria-label="Список участников комнаты">
      <RoomMemberList {roomId} />
    </aside>
  {/if}
  <RoomChat />
</main>
