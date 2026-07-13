<script lang="ts">
  import { ChevronDown, ChevronLeft, ChevronRight, X } from '@lucide/svelte';
  import ParticipantList from './ParticipantList.svelte';
  import ParticipantContextMenu from './ParticipantContextMenu.svelte';
  import StreamTiles from './StreamTiles.svelte';
  import { getScreenParticipants } from '../client/ui/screen-view';
  import { clearParticipantFocus, getFocusedParticipant, getParticipantCount, getSortedParticipants } from '../participants-ui.svelte';
  import { state as roomState } from '../client/core/state.svelte';

  const participantCount = $derived(getParticipantCount());
  const streamCount = $derived(
    getScreenParticipants().filter((participant) => participant.id !== roomState.viewedScreenPeerId).length
  );
  const totalCount = $derived(participantCount + streamCount);
  const focusedParticipant = $derived(getFocusedParticipant());
  const stripParticipants = $derived(getSortedParticipants().filter((participant) => participant.id !== focusedParticipant?.id));
  let carousel = $state<HTMLDivElement | null>(null);

  function moveCarousel(direction: number): void {
    carousel?.scrollBy({ left: direction * 154, behavior: 'smooth' });
  }
</script>

<div class="stage-strip" id="stageStrip" aria-label="Плитки комнаты">
  <div class="stage-strip-bar" hidden>
    <div class="stage-strip-title">
      <span class="stage-strip-kicker" id="stageStripKicker">В комнате</span>
      <strong id="stageStripSummary">0 участников</strong>
    </div>
    <button class="strip-toggle-button" id="stripToggleButton" type="button" aria-label="Свернуть пользователей" aria-pressed="false" hidden><ChevronDown aria-hidden="true" /></button>
  </div>

  {#if focusedParticipant}
    <div class="participant-focus-layout">
      <div class="participant-focus-stage">
        <ParticipantList participants={[focusedParticipant]} variant="grid" />
        <button class="participant-focus-close" type="button" aria-label="Закрыть фокус" onclick={clearParticipantFocus}><X size={16} /></button>
      </div>
      <div class="participant-carousel-shell">
        <button class="participant-carousel-nav" type="button" aria-label="Предыдущие участники" onclick={() => moveCarousel(-1)}><ChevronLeft size={18} /></button>
        <div class="participant-carousel" bind:this={carousel}>
          <div class="tile-grid participant-focus-strip" data-count={Math.min(stripParticipants.length + streamCount, 9)} data-streams={Math.min(streamCount, 9)}>
            <StreamTiles />
            <ParticipantList participants={stripParticipants} variant="strip" />
          </div>
        </div>
        <button class="participant-carousel-nav" type="button" aria-label="Следующие участники" onclick={() => moveCarousel(1)}><ChevronRight size={18} /></button>
      </div>
    </div>
  {:else}
    <div class="tile-grid" id="tileGrid" data-count={Math.min(totalCount, 9)} data-streams={Math.min(streamCount, 9)} aria-live="polite">
      <StreamTiles />
      <ParticipantList />
    </div>
  {/if}
</div>
<ParticipantContextMenu />
