<script lang="ts">
  import { SwitchCamera } from '@lucide/svelte';
  import { state as roomClientState } from '../client/core/state.svelte';
  import { flipCamera } from '../client/services/camera-service';
  import { restartChromeTimer } from '../mobile-call-ui.svelte';

  /** `pill` carries its label; `round` is the icon alone, for the small picture-in-picture. */
  let { variant = 'pill' }: { variant?: 'pill' | 'round' } = $props();

  // Each tap turns the icon half a turn, the way the camera turns.
  let turns = $state(0);
  const label = $derived(roomClientState.cameraFacing === 'environment' ? 'На фронтальную' : 'На основную');

  function flip(event: MouseEvent): void {
    event.stopPropagation();
    turns += 1;
    void flipCamera();
  }
</script>

<button
  class="mc-flip"
  type="button"
  data-variant={variant}
  aria-label={`${label} камеру`}
  disabled={roomClientState.cameraStarting}
  onclick={flip}
  onpointerdown={(event) => {
    // Not a drag of the picture under it, but still a touch that keeps the controls.
    event.stopPropagation();
    restartChromeTimer();
  }}
>
  <span class="mc-flip-icon" style:transform={`rotate(${turns * 180}deg)`}>
    <SwitchCamera size={variant === 'round' ? 20 : 22} aria-hidden="true" />
  </span>
  {#if variant === 'pill'}<span>{label}</span>{/if}
</button>

<style>
  .mc-flip {
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
    -webkit-tap-highlight-color: transparent;
  }

  .mc-flip[data-variant='round'] {
    justify-content: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border-radius: 50%;
  }

  .mc-flip:disabled {
    opacity: 0.6;
  }

  .mc-flip-icon {
    display: inline-flex;
    transition: transform 450ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }
</style>
