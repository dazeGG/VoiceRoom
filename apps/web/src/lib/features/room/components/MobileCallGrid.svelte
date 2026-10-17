<script lang="ts">
  // Everyone at once, filling the screen: rows of equal height, the tiles of a
  // row sharing its width. Past nine people the grid pages sideways.
  import type { Participant } from '../client/core/types';
  import { mobileCallUi, pinInFocus, toggleChrome } from '../mobile-call-ui.svelte';
  import MobileCallTile from './MobileCallTile.svelte';
  import MobileCameraFlip from './MobileCameraFlip.svelte';

  let { pages }: { pages: Participant[][][] } = $props();

  let scroller = $state<HTMLElement>();
  let page = $state(0);
  const currentPage = $derived(Math.min(page, pages.length - 1));
  const alone = $derived(pages.flat(2).length < 2);
  const lonelySelf = $derived(alone && pages[0]?.[0]?.[0]?.isLocal ? pages[0][0][0] : null);

  function syncPage(): void {
    if (!scroller?.clientWidth) return;
    page = Math.round(scroller.scrollLeft / scroller.clientWidth);
  }

  function goToPage(index: number): void {
    scroller?.scrollTo({ left: index * scroller.clientWidth, behavior: 'smooth' });
  }

  /** Tiles in reading order, each spanning its share of the six columns. */
  function cells(rows: Participant[][]): Array<{ participant: Participant; span: number }> {
    return rows.flatMap((row) => row.map((participant) => ({ participant, span: 6 / row.length })));
  }

  // My own tile puts me in focus to see my camera big (alone, there is nothing to
  // focus between); anyone else's shows or hides the controls.
  function tapTile(participant: Participant): void {
    if (participant.isLocal && !alone) pinInFocus(participant.id);
    else toggleChrome();
  }
</script>

<div class="mc-grid" data-paged={pages.length > 1 ? 'true' : undefined}>
  <div class="mc-grid-pages" bind:this={scroller} onscroll={syncPage}>
    {#each pages as rows, index (index)}
      <div
        class="mc-grid-page"
        role="group"
        aria-label={`Страница ${index + 1}`}
        style:grid-template-rows={`repeat(${rows.length}, minmax(0, 1fr))`}
      >
        <!-- One flat list keyed by person: moving to another row keeps the tile and its video. -->
        {#each cells(rows) as { participant, span } (participant.id)}
          <div class="mc-grid-cell" style:grid-column={`span ${span}`}>
            <MobileCallTile {participant} ontap={() => tapTile(participant)} />
          </div>
        {/each}
      </div>
    {/each}
  </div>
  {#if lonelySelf?.cameraStream}
    <!-- Alone there is no focus to open, so the camera switch sits on my tile. -->
    <div class="mc-grid-flip" inert={!mobileCallUi.chromeVisible}><MobileCameraFlip /></div>
  {/if}
  {#if pages.length > 1}
    <div class="mc-grid-dots" role="group" aria-label="Страницы" inert={!mobileCallUi.chromeVisible}>
      {#each pages as _, index (index)}
        <button
          type="button"
          class="mc-grid-dot"
          aria-label={`Страница ${index + 1}`}
          aria-current={index === currentPage ? 'page' : undefined}
          onclick={() => goToPage(index)}
        ></button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .mc-grid {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .mc-grid-pages {
    display: flex;
    flex: 1 1 auto;
    min-height: 0;
    overflow-x: auto;
    overflow-y: hidden;
    overscroll-behavior-x: contain;
    scroll-snap-type: x mandatory;
    scrollbar-width: none;
  }

  .mc-grid-pages::-webkit-scrollbar {
    display: none;
  }

  /* Room for the page dots under the grid. */
  .mc-grid[data-paged='true'] .mc-grid-pages {
    margin-bottom: 28px;
  }

  /* Six columns take rows of one, two or three tiles alike. */
  .mc-grid-page {
    display: grid;
    flex: 0 0 100%;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 6px;
    min-height: 0;
    padding: 0 8px;
    box-sizing: border-box;
    scroll-snap-align: start;
  }

  .mc-grid-cell {
    min-width: 0;
    min-height: 0;
  }

  .mc-grid-flip {
    position: absolute;
    right: 18px;
    bottom: 44px;
    z-index: 3;
    transition:
      opacity 250ms ease,
      transform 300ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  :global(.mobile-call[data-chrome='hidden']) .mc-grid-flip {
    opacity: 0;
    transform: translateY(10px);
    pointer-events: none;
  }

  .mc-grid-dots {
    position: absolute;
    left: 50%;
    bottom: 3px;
    display: flex;
    gap: 2px;
    height: 22px;
    padding: 0 4px;
    border-radius: 11px;
    background: var(--vr-scrim);
    transform: translateX(-50%);
    transition: opacity 250ms ease;
  }

  :global(.mobile-call[data-chrome='hidden']) .mc-grid-dots {
    opacity: 0;
    pointer-events: none;
  }

  .mc-grid-dot {
    position: relative;
    width: 16px;
    height: 22px;
    padding: 0;
    border: 0;
    background: transparent;
  }

  .mc-grid-dot::before {
    position: absolute;
    top: 8px;
    left: 5px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: color-mix(in oklch, var(--vr-text) 30%, transparent);
    content: '';
  }

  .mc-grid-dot[aria-current='page']::before {
    background: var(--vr-text);
  }
</style>
