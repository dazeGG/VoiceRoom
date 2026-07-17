<script lang="ts">
  import { ChevronDown, ChevronLeft, ChevronRight } from '@lucide/svelte';
  import type { Participant } from '../client/core/types';
  import ParticipantList from './ParticipantList.svelte';
  import ParticipantContextMenu from './ParticipantContextMenu.svelte';
  import StreamTiles from './StreamTiles.svelte';
  import { getScreenParticipants } from '../client/ui/screen-view';
  import { getFocusedParticipant, getParticipantCount, getSortedParticipants } from '../participants-ui.svelte';
  import { screenUi } from '../screen-ui.svelte';
  import { state as roomState } from '../client/core/state.svelte';

  const participantCount = $derived(getParticipantCount());
  const streamCount = $derived.by(() => {
    void screenUi.revision;
    return getScreenParticipants().filter((participant) => participant.id !== roomState.viewedScreenPeerId).length;
  });
  const totalCount = $derived(participantCount + streamCount);
  const focusedParticipant = $derived(getFocusedParticipant());
  const screenFocused = $derived(screenUi.stageVisible);
  const stripParticipants = $derived(getSortedParticipants().filter((participant) => participant.id !== focusedParticipant?.id));
  let carousel = $state<HTMLDivElement | null>(null);
  let canScrollLeft = $state(false);
  let canScrollRight = $state(false);

  function moveCarousel(direction: number): void {
    carousel?.scrollBy({ left: direction * Math.max(carousel.clientWidth - 60, 154), behavior: 'smooth' });
  }

  function updateCarouselNav(): void {
    if (!carousel) {
      canScrollLeft = false;
      canScrollRight = false;
      return;
    }
    const maxScroll = carousel.scrollWidth - carousel.clientWidth;
    canScrollLeft = carousel.scrollLeft > 4;
    canScrollRight = carousel.scrollLeft < maxScroll - 4;
  }

  // Keep the arrows in sync with overflow: tiles join/leave, previews resize,
  // and the stage itself resizes — none of which fire a scroll event.
  $effect(() => {
    const el = carousel;
    if (!el) {
      updateCarouselNav();
      return;
    }
    const observer = new ResizeObserver(updateCarouselNav);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    updateCarouselNav();
    return () => observer.disconnect();
  });
</script>

{#snippet spotlightCarousel(participants: Participant[])}
  <div class="participant-carousel-shell">
    <button
      class="participant-carousel-nav"
      type="button"
      aria-label="Предыдущие участники"
      data-visible={canScrollLeft}
      tabindex={canScrollLeft ? 0 : -1}
      onclick={() => moveCarousel(-1)}
    ><ChevronLeft size={18} /></button>
    <div class="participant-carousel" bind:this={carousel} onscroll={updateCarouselNav}>
      <div class="participant-focus-strip">
        <StreamTiles />
        <ParticipantList {participants} variant="strip" />
      </div>
    </div>
    <button
      class="participant-carousel-nav"
      type="button"
      aria-label="Следующие участники"
      data-visible={canScrollRight}
      tabindex={canScrollRight ? 0 : -1}
      onclick={() => moveCarousel(1)}
    ><ChevronRight size={18} /></button>
  </div>
{/snippet}

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
      </div>
      {@render spotlightCarousel(stripParticipants)}
    </div>
  {:else if screenFocused}
    <!-- The focused stream itself is the sibling ScreenStage; the strip row
         below carries everyone else in the same spotlight carousel. -->
    {@render spotlightCarousel(getSortedParticipants())}
  {:else}
    <div class="tile-grid" id="tileGrid" data-count={Math.min(totalCount, 9)} data-streams={Math.min(streamCount, 9)} aria-live="polite">
      <StreamTiles />
      <ParticipantList />
    </div>
  {/if}
</div>
<ParticipantContextMenu />
