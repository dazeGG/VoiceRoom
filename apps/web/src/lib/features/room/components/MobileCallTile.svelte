<script lang="ts">
  // One person on the phone layout. The picture is never cropped: it is fitted
  // whole, and a blurred copy of the same frame fills the rest of the tile.
  import EmojiText from '$lib/shared/chat/EmojiText.svelte';
  import { HeadphoneOff, MicOff, MonitorPlay } from '@lucide/svelte';
  import { getAvatarPresentation } from '../client/ui/avatar-presentation';
  import { state as roomState } from '../client/core/state.svelte';
  import { enterScreenView } from '../client/ui/screen-view';
  import { keepVideoFitted } from '../client/ui/video-fit';
  import type { Participant } from '../client/core/types';
  import { createLogger, errorContext } from '$lib/shared/log';

  const log = createLogger('room:mobile-tile');

  let {
    participant,
    variant = 'grid',
    ontap,
    onframe
  }: {
    participant: Participant;
    /** `bleed` fills the whole screen, `pip` is the floating picture-in-picture. */
    variant?: 'grid' | 'focus' | 'strip' | 'bleed' | 'pip';
    ontap: () => void;
    /** The camera's width over its height, `null` while there is no picture. */
    onframe?: (ratio: number | null) => void;
  } = $props();

  // A new avatar gets a fresh attempt: only the URL that failed stays hidden.
  let failedAvatarUrl = $state<string | null>(null);

  const avatar = $derived(getAvatarPresentation(participant));
  const imageFailed = $derived(failedAvatarUrl !== null && failedAvatarUrl === avatar.src);
  const cameraStream = $derived(participant.cameraStream);
  const mirrored = $derived(participant.isLocal && roomState.cameraFacing !== 'environment');
  const canWatch = $derived(!participant.isLocal && participant.screen);

  function showCamera(stream: MediaStream) {
    return (video: HTMLVideoElement) => {
      video.srcObject = stream;
      void video.play().catch(() => {});
      return () => {
        video.srcObject = null;
      };
    };
  }

  // A phone camera can change its shape while it starts or turns, so the size
  // is reported on every change, not only once.
  function reportFrame(video: HTMLVideoElement): () => void {
    const report = (): void => {
      if (video.videoWidth > 0 && video.videoHeight > 0) onframe?.(video.videoWidth / video.videoHeight);
    };
    video.addEventListener('loadedmetadata', report);
    video.addEventListener('resize', report);
    report();
    return () => {
      video.removeEventListener('loadedmetadata', report);
      video.removeEventListener('resize', report);
      onframe?.(null);
    };
  }

  // The plate is drawn for the eye; the button under it says the same aloud.
  const spokenLabel = $derived(
    [
      participant.name,
      participant.isLocal ? 'вы' : '',
      participant.muted ? 'микрофон выключен' : '',
      participant.deafened ? 'звук выключен' : ''
    ]
      .filter(Boolean)
      .join(', ')
  );

  function watchScreen(event: MouseEvent): void {
    event.stopPropagation();
    void enterScreenView(participant.id).catch((error) => log.error('screen view action failed', errorContext(error)));
  }
</script>

<div
  class="mc-tile"
  data-variant={variant}
  data-peer-id={participant.id}
  data-local={participant.isLocal ? 'true' : undefined}
  data-camera={cameraStream ? 'true' : undefined}
  data-speaking={String(participant.speaking)}
  style:--participant-pastel={avatar.background}
  style:--participant-avatar-fg={avatar.foreground}
>
  {#if cameraStream}
    <!-- The picture-in-picture takes the camera's own shape, so nothing is left to fill:
         its picture fills the box outright, and Safari on iPhone has no stale size to fit
         it by (WebKit bug 275210). -->
    {#if variant !== 'pip'}
      <video
        class="mc-tile-backdrop"
        {@attach showCamera(cameraStream)}
        data-mirrored={mirrored ? 'true' : undefined}
        aria-hidden="true"
        autoplay
        playsinline
        muted
      ></video>
    {/if}
    <video
      class="mc-tile-video"
      {@attach showCamera(cameraStream)}
      {@attach reportFrame}
      {@attach keepVideoFitted}
      style:object-fit={variant === 'pip' ? 'fill' : undefined}
      data-mirrored={mirrored ? 'true' : undefined}
      autoplay
      playsinline
      muted
    ></video>
  {:else}
    <span class="mc-tile-avatar" aria-hidden="true">
      {#if avatar.src && !imageFailed}<img
          src={avatar.src}
          alt=""
          onerror={() => (failedAvatarUrl = avatar.src)}
        />{:else}{avatar.initials}{/if}
    </span>
  {/if}
  <!-- The whole tile is one button; the screen action below sits beside it, not inside. -->
  <button class="mc-tile-hit" type="button" aria-label={spokenLabel} onclick={ontap}></button>
  <div class="mc-tile-name" aria-hidden="true">
    <span class="mc-tile-name-text"><EmojiText text={participant.name} /></span>
    {#if participant.isLocal}<span class="mc-tile-you">вы</span>{/if}
    {#if participant.muted}<span class="mc-tile-icon"><MicOff /></span>{/if}
    {#if participant.deafened}<span class="mc-tile-icon"><HeadphoneOff /></span>{/if}
  </div>
  {#if canWatch}
    <button class="mc-tile-screen" type="button" disabled={roomState.screenRequesting} onclick={watchScreen}>
      <MonitorPlay aria-hidden="true" />
      <span>Экран</span>
    </button>
  {/if}
</div>

<style>
  .mc-tile {
    position: relative;
    display: grid;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    place-items: center;
    overflow: hidden;
    container-type: size;
    border-radius: 16px;
    background: color-mix(in oklch, var(--participant-pastel), var(--vr-bg) 30%);
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
    user-select: none;
  }

  .mc-tile[data-variant='focus'] {
    border-radius: 18px;
  }

  .mc-tile[data-variant='strip'],
  .mc-tile[data-variant='pip'] {
    border-radius: 14px;
  }

  /* Full screen: no corners, and a calmer avatar colour over the whole screen. */
  .mc-tile[data-variant='bleed'] {
    border-radius: 0;
    background: color-mix(in oklch, var(--participant-pastel), var(--vr-bg) 64%);
  }

  .mc-tile[data-camera='true'] {
    background: var(--vr-bg);
  }

  /* The speaking outline is drawn over the picture. */
  .mc-tile::after {
    /* Above the picture and the tile's button, under the plate. */
    position: absolute;
    inset: 0;
    z-index: 2;
    border-radius: inherit;
    box-shadow: inset 0 0 0 1px var(--vr-line);
    content: '';
    pointer-events: none;
  }

  .mc-tile[data-speaking='true']::after {
    box-shadow: inset 0 0 0 2px var(--vr-accent);
  }

  .mc-tile[data-variant='bleed'][data-speaking='true']::after {
    box-shadow: inset 0 0 0 3px var(--vr-accent);
  }

  /* A blurred copy fills what the fitted picture leaves. It is drawn at a
     quarter of the tile and scaled up: the blur then costs a sixteenth. */
  .mc-tile-backdrop {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 25%;
    height: 25%;
    object-fit: cover;
    filter: blur(5.5px) brightness(0.42) saturate(1.2);
    transform: translate(-50%, -50%) scale(4.6);
    pointer-events: none;
  }

  .mc-tile-video {
    position: absolute;
    inset: 0;
    z-index: 1;
    width: 100%;
    height: 100%;
    object-fit: contain;
    pointer-events: none;
  }

  .mc-tile-backdrop[data-mirrored='true'] {
    transform: translate(-50%, -50%) scale(-4.6, 4.6);
  }

  .mc-tile-video[data-mirrored='true'] {
    transform: scaleX(-1);
  }

  .mc-tile-hit {
    position: absolute;
    inset: 0;
    z-index: 2;
    width: 100%;
    height: 100%;
    padding: 0;
    border: 0;
    border-radius: inherit;
    background: transparent;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }

  .mc-tile-hit:focus-visible {
    outline: 2px solid var(--vr-accent);
    outline-offset: -2px;
  }

  .mc-tile-avatar {
    position: relative;
    display: grid;
    width: max(28px, min(84px, 36cqmin));
    aspect-ratio: 1;
    place-items: center;
    overflow: hidden;
    border-radius: 50%;
    background: var(--participant-pastel);
    color: var(--participant-avatar-fg);
    font-size: max(9px, min(27px, 11.5cqmin));
    font-weight: 600;
  }

  .mc-tile[data-variant='bleed'] .mc-tile-avatar {
    width: max(28px, min(120px, 36cqmin));
    font-size: max(9px, min(38px, 11.5cqmin));
  }

  .mc-tile-avatar > img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .mc-tile-name {
    position: absolute;
    left: 8px;
    bottom: 8px;
    z-index: 3;
    pointer-events: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: calc(100% - 16px);
    height: 26px;
    margin: 0;
    padding: 0 9px;
    overflow: hidden;
    border-radius: 8px;
    background: var(--vr-scrim);
    color: var(--vr-text);
    font-size: 13px;
    font-weight: 500;
    line-height: 1;
    white-space: nowrap;
  }

  .mc-tile[data-variant='focus'] .mc-tile-name {
    left: 10px;
    bottom: 10px;
  }

  /* Full screen: the plate sits above the dock, which moves with the controls. */
  .mc-tile[data-variant='bleed'] .mc-tile-name {
    left: 14px;
    bottom: calc(var(--mc-bottom) + 8px);
    transition: bottom 350ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  .mc-tile-name-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .mc-tile-you {
    flex: none;
    color: var(--vr-text-3);
  }

  .mc-tile-icon {
    display: inline-flex;
    flex: none;
    color: var(--vr-danger);
  }

  .mc-tile-icon :global(svg) {
    width: 14px;
    height: 14px;
  }

  .mc-tile-screen {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 4;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 10px;
    border: 1px solid var(--vr-line-strong);
    border-radius: 10px;
    background: var(--vr-scrim);
    color: var(--vr-text);
    font: inherit;
    font-size: 13px;
    font-weight: 500;
  }

  .mc-tile-screen :global(svg) {
    width: 16px;
    height: 16px;
  }

  /* Narrow tiles (three in a row, the strip, the picture-in-picture) get a
     smaller plate. */
  @container (max-width: 129px) {
    .mc-tile-name,
    .mc-tile[data-variant='focus'] .mc-tile-name {
      left: 5px;
      bottom: 5px;
      gap: 4px;
      max-width: calc(100% - 10px);
      height: 20px;
      padding: 0 6px;
      border-radius: 6px;
      font-size: 11.5px;
    }

    .mc-tile-icon :global(svg) {
      width: 12px;
      height: 12px;
    }

    .mc-tile-screen span {
      display: none;
    }
  }
</style>
