<script lang="ts">
  import ParticipantList from './ParticipantList.svelte';
  import StreamTiles from './StreamTiles.svelte';
  import { getScreenParticipants } from '../client/ui/screen-view';
  import { getParticipantCount } from '../participants-ui.svelte';
  import { state } from '../client/core/state.svelte';

  const participantCount = $derived(getParticipantCount());
  const streamCount = $derived(
    getScreenParticipants().filter((participant) => participant.id !== state.viewedScreenPeerId).length
  );
  const totalCount = $derived(participantCount + streamCount);
</script>

<div class="stage-strip" id="stageStrip" aria-label="Плитки комнаты">
  <div class="stage-strip-bar" hidden>
    <div class="stage-strip-title">
      <span class="stage-strip-kicker" id="stageStripKicker">В комнате</span>
      <strong id="stageStripSummary">0 участников</strong>
    </div>
    <button class="strip-toggle-button" id="stripToggleButton" type="button" aria-label="Свернуть пользователей" aria-pressed="false" data-icon="chevron-down" hidden></button>
  </div>

  <div
    class="tile-grid"
    id="tileGrid"
    data-count={Math.min(totalCount, 9)}
    data-streams={Math.min(streamCount, 9)}
  >
    <StreamTiles />
    <ParticipantList />
  </div>
</div>