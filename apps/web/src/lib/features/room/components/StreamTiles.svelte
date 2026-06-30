<script lang="ts">
  import StreamTile from './StreamTile.svelte';
  import {
    getScreenParticipants,
    getScreenStreamForParticipant,
    hasStreamTilePreview,
    isScreenSubscribed,
    isStreamTileCollapsed
  } from '../client/ui/screen-view';
  import { screenUi } from '../screen-ui.svelte';
  import { state } from '../client/core/state.svelte';

  const tiles = $derived.by(() => {
    void screenUi.revision;
    return getScreenParticipants().filter((participant) => participant.id !== state.viewedScreenPeerId);
  });
</script>

<div
  class="stream-tiles"
  id="streamTiles"
  hidden={tiles.length === 0}
  data-count={Math.min(tiles.length, 8)}
>
  {#each tiles as participant (participant.id)}
    <StreamTile
      {participant}
      hasPreview={hasStreamTilePreview(participant)}
      isCollapsed={isStreamTileCollapsed(participant)}
      isSubscribed={isScreenSubscribed(participant.id)}
      stream={getScreenStreamForParticipant(participant)}
    />
  {/each}
</div>