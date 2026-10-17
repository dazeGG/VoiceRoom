<script lang="ts">
  // The call on a phone in portrait: it covers the room page with a full-screen
  // layout (grid, focus, or two people face to face) whose controls hide
  // themselves. Opening someone's screen hands the page back to the room stage.
  import { onMount } from 'svelte';
  import { MicOff } from '@lucide/svelte';
  import { getDesktopBoundaryPolicy } from '$lib/platform/desktop-boundary';
  import { state as roomClientState } from '../client/core/state.svelte';
  import { isMicrophoneShownMuted } from '../client/core/microphone-mute';
  import {
    getMobileCallScene,
    isMobileCallActive,
    mobileCallUi,
    resetMobileCall,
    restartChromeTimer,
    setMobileCallEnabled,
    showChrome,
    stopChromeTimer,
    tapStage
  } from '../mobile-call-ui.svelte';
  import MobileCallTile from './MobileCallTile.svelte';
  import MobileCallPip from './MobileCallPip.svelte';
  import MobileCallGrid from './MobileCallGrid.svelte';
  import MobileCallFocus from './MobileCallFocus.svelte';
  import MobileCallTopbar from './MobileCallTopbar.svelte';
  import MobileCallDock from './MobileCallDock.svelte';
  import MobileCameraFlip from './MobileCameraFlip.svelte';
  import RoomCallTimer from './RoomCallTimer.svelte';
  import { roomUi } from '../room-ui.svelte';

  const active = $derived(isMobileCallActive());
  const scene = $derived(getMobileCallScene());
  // Full screen myself, my camera switch sits over my name, clear of the picture-in-picture.
  const selfBigFlip = $derived(scene.kind === 'duo' && scene.big.isLocal && Boolean(roomClientState.localCameraStream));

  // Any touch on the call restarts the countdown that hides the controls.
  function watchTouches(node: HTMLElement): () => void {
    node.addEventListener('pointerdown', restartChromeTimer);
    return () => node.removeEventListener('pointerdown', restartChromeTimer);
  }

  // The controls start hiding as soon as the call shows them, and again once a
  // menu or the chat over the call closes.
  $effect(() => {
    void roomUi.chatOpen;
    void mobileCallUi.outputOpen;
    if (!active || !mobileCallUi.chromeVisible) return;
    restartChromeTimer();
    return stopChromeTimer;
  });

  onMount(() => {
    setMobileCallEnabled(getDesktopBoundaryPolicy().platformClass === 'mobile');
    return () => {
      resetMobileCall();
      setMobileCallEnabled(false);
    };
  });
</script>

{#if active}
  <div
    class="mobile-call"
    data-chrome={mobileCallUi.chromeVisible ? 'visible' : 'hidden'}
    data-scene={scene.kind}
    {@attach watchTouches}
  >
    {#if scene.kind === 'duo'}
      <div class="mc-bleed">
        <MobileCallTile
          participant={scene.big}
          variant="bleed"
          ontap={() => tapStage({ pipExpanded: scene.kind === 'duo' && scene.pipExpanded })}
        />
      </div>
      {#if selfBigFlip}
        <div class="mc-bleed-controls" inert={!mobileCallUi.chromeVisible}><MobileCameraFlip /></div>
      {/if}
    {/if}

    <div class="mc-content">
      {#if scene.kind === 'duo'}
        {#key scene.pip.id}
          <MobileCallPip {scene} corner={mobileCallUi.pipCorner} />
        {/key}
      {:else if scene.kind === 'focus'}
        <MobileCallFocus big={scene.big} self={scene.self} strip={scene.strip} />
      {:else}
        <MobileCallGrid pages={scene.pages} />
      {/if}
    </div>

    <!-- Hidden controls leave the tab order and the screen reader with the picture. -->
    <div class="mc-chrome" inert={!mobileCallUi.chromeVisible}>
      <MobileCallTopbar duo={scene.kind === 'duo'} />
      <MobileCallDock />
    </div>

    <button
      class="mc-bubble"
      type="button"
      aria-label="Показать управление"
      inert={mobileCallUi.chromeVisible}
      onclick={showChrome}
    >
      <RoomCallTimer variant="bubble" />
      {#if roomClientState.joined && isMicrophoneShownMuted()}<MicOff size={14} aria-hidden="true" />{/if}
    </button>
  </div>
{/if}

<style>
  .mobile-call {
    --mc-safe-top: env(safe-area-inset-top, 0px);
    --mc-safe-bottom: env(safe-area-inset-bottom, 0px);
    --mc-dock-bottom: max(12px, var(--mc-safe-bottom));
    /* The band the tiles may use: under the top bar and above the dock. */
    --mc-top: calc(var(--mc-safe-top) + 58px);
    --mc-bottom: calc(var(--mc-dock-bottom) + 86px);
    position: fixed;
    inset: 0;
    z-index: 10;
    overflow: hidden;
    background: var(--vr-bg);
    color: var(--vr-text);
    font-family: var(--font-ui);
    -webkit-user-select: none;
    user-select: none;
  }

  .mobile-call[data-chrome='hidden'] {
    --mc-top: calc(var(--mc-safe-top) + 4px);
    --mc-bottom: max(8px, var(--mc-safe-bottom));
  }

  .mc-chrome {
    display: contents;
  }

  .mc-content {
    position: absolute;
    top: var(--mc-top);
    right: 0;
    bottom: var(--mc-bottom);
    left: 0;
    /* The picture-in-picture measures itself against the band. */
    container-type: size;
    transition:
      top 350ms cubic-bezier(0.2, 0.8, 0.2, 1),
      bottom 350ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  /* Two people: only the picture-in-picture lives in the band, over the full-screen picture. */
  .mobile-call[data-scene='duo'] .mc-content {
    pointer-events: none;
  }

  .mobile-call[data-scene='duo'] .mc-content > :global(*) {
    pointer-events: auto;
  }

  .mc-bleed {
    position: absolute;
    inset: 0;
  }

  .mc-bleed-controls {
    position: absolute;
    left: 14px;
    bottom: calc(var(--mc-bottom) + 42px);
    z-index: 3;
    transition:
      bottom 350ms cubic-bezier(0.2, 0.8, 0.2, 1),
      opacity 250ms ease,
      transform 300ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  .mobile-call[data-chrome='hidden'] .mc-bleed-controls {
    opacity: 0;
    transform: translateY(10px);
    pointer-events: none;
  }

  .mc-bubble {
    position: absolute;
    top: calc(var(--mc-safe-top) + 12px);
    left: 12px;
    z-index: 5;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 28px;
    padding: 0 11px;
    border: 0;
    border-radius: 9px;
    background: var(--vr-scrim);
    color: var(--vr-danger);
    -webkit-backdrop-filter: blur(10px);
    backdrop-filter: blur(10px);
    opacity: 0;
    pointer-events: none;
    transform: translateY(-8px);
    transition:
      opacity 250ms ease,
      transform 300ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  .mobile-call[data-chrome='hidden'] .mc-bubble {
    opacity: 1;
    pointer-events: auto;
    transform: none;
  }

  /* The room page under the call is taller than the screen; scrolling it would
     slide the call away from the finger. */
  :global(html:has(.mobile-call)),
  :global(body:has(.mobile-call)) {
    overflow: hidden;
    overscroll-behavior: none;
  }

  /* The room's own top bar lies under the call: it must not take taps or be
     read out a second time next to the call's bar. */
  :global(body:has(.mobile-call) .topbar) {
    visibility: hidden;
  }

  /* The account offer and the screen-on hint hang under the top bar, clear of
     the name plates, and go away with the controls. */
  :global(body:has(.mobile-call) .room-cta-stack) {
    top: calc(env(safe-area-inset-top, 0px) + 64px);
    bottom: auto;
  }

  :global(body:has(.mobile-call[data-chrome='hidden']) .room-cta-stack) {
    opacity: 0;
    pointer-events: none;
    transition: opacity 250ms ease;
  }

  :global(body:has(.mobile-call[data-chrome='hidden']) .room-cta-stack > *) {
    pointer-events: none;
  }
</style>
