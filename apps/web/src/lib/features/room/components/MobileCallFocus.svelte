<script lang="ts">
  // One person big and everyone else in a strip below, me first on its left.
  import { PinOff } from '@lucide/svelte';
  import type { Participant } from '../client/core/types';
  import { STRIP_FITTING_TILES } from '../mobile-call-layout';
  import { mobileCallUi, pinInFocus, toggleChrome, unpin } from '../mobile-call-ui.svelte';
  import MobileCallTile from './MobileCallTile.svelte';
  import MobileCameraFlip from './MobileCameraFlip.svelte';

  let { big, self, strip }: { big: Participant; self: Participant | null; strip: Participant[] } = $props();

  const pinned = $derived(mobileCallUi.pinnedId === big.id);
  const fits = $derived(strip.length + (self ? 1 : 0) <= STRIP_FITTING_TILES);
</script>

<div class="mc-focus">
  <div class="mc-focus-big">
    <MobileCallTile participant={big} variant="focus" ontap={toggleChrome} />
    {#if pinned}
      <div class="mc-pin-controls" inert={!mobileCallUi.chromeVisible}>
        {#if big.isLocal && big.cameraStream}<MobileCameraFlip />{/if}
        <button class="mc-unpin" type="button" onclick={unpin}>
          <PinOff size={20} aria-hidden="true" />
          <span>Открепить</span>
        </button>
      </div>
    {/if}
  </div>
  <div class="mc-strip" data-fits={fits ? 'true' : undefined} style:--strip-others={strip.length}>
    {#if self}
      <div class="mc-strip-self">
        <MobileCallTile participant={self} variant="strip" ontap={() => pinInFocus(self.id)} />
      </div>
      <span class="mc-strip-divider" aria-hidden="true"></span>
    {/if}
    <div class="mc-strip-scroller">
      {#each strip as participant (participant.id)}
        <div class="mc-strip-item">
          <MobileCallTile {participant} variant="strip" ontap={() => pinInFocus(participant.id)} />
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .mc-focus {
    display: flex;
    flex-direction: column;
    gap: 6px;
    height: 100%;
    min-height: 0;
    padding: 0 8px;
    box-sizing: border-box;
  }

  .mc-focus-big {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
  }

  .mc-pin-controls {
    position: absolute;
    right: 10px;
    bottom: 44px;
    z-index: 4;
    display: flex;
    gap: 8px;
    transition:
      opacity 250ms ease,
      transform 300ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  :global(.mobile-call[data-chrome='hidden']) .mc-pin-controls {
    opacity: 0;
    transform: translateY(10px);
    pointer-events: none;
  }

  .mc-unpin {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    height: 52px;
    padding: 0 18px 0 16px;
    border: 1px solid var(--vr-line-strong);
    border-radius: 16px;
    background: var(--vr-scrim);
    color: var(--vr-text);
    -webkit-backdrop-filter: blur(12px);
    backdrop-filter: blur(12px);
    font: inherit;
    font-size: 15px;
    font-weight: 500;
    white-space: nowrap;
  }

  .mc-strip {
    position: relative;
    display: flex;
    flex: none;
    height: min(150px, 25%);
  }

  .mc-strip-self,
  .mc-strip-item {
    flex: 0 0 100px;
    min-width: 0;
  }

  .mc-strip-divider {
    flex: 0 0 13px;
    align-self: center;
    height: 56%;
    background: linear-gradient(var(--vr-line-strong), var(--vr-line-strong)) center / 1px 100% no-repeat;
  }

  .mc-strip-scroller {
    display: flex;
    flex: 1 1 auto;
    gap: 6px;
    min-width: 0;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    scrollbar-width: none;
  }

  .mc-strip-scroller::-webkit-scrollbar {
    display: none;
  }

  .mc-strip-item {
    scroll-snap-align: start;
  }

  /* Three tiles or fewer share the width; more scroll, with a fade saying so. */
  .mc-strip[data-fits='true'] .mc-strip-self {
    flex: 1 1 0;
  }

  .mc-strip[data-fits='true'] .mc-strip-scroller {
    flex: var(--strip-others) 1 0;
  }

  .mc-strip[data-fits='true'] .mc-strip-item {
    flex: 1 1 0;
  }

  .mc-strip:not([data-fits='true'])::after {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: 28px;
    background: linear-gradient(90deg, transparent, color-mix(in oklch, var(--vr-bg) 90%, transparent));
    content: '';
    pointer-events: none;
  }
</style>
