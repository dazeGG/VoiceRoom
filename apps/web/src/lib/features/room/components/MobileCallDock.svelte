<script lang="ts">
  // The phone dock: four big buttons and nothing to aim at. The phone picks the
  // microphone and its own volume keys stand in for muting the sound.
  import { Check, Headphones, Mic, MicOff, PhoneOff, Smartphone, Video, VideoOff, Volume2 } from '@lucide/svelte';
  import { roomDeviceUi } from '../room-device-ui.svelte';
  import { getCallControlsView, getCameraControlsView, handleMicButtonClick } from '../client/ui/controls';
  import { refreshDevices, switchOutputDevice } from '../client/ui/devices';
  import { supportsAudioOutputSelection } from '../client/services/media-playback-service';
  import { toggleCamera } from '../client/services/camera-service';
  import { handleLeaveButtonClick } from '../client/room/room';
  import { mobileCallUi } from '../mobile-call-ui.svelte';

  const callControls = $derived(getCallControlsView());
  const cameraControls = $derived(getCameraControlsView());
  // iOS routes the sound itself and lets no page choose; the button is then left out.
  const canPickOutput = supportsAudioOutputSelection();
  const outputs = $derived(
    roomDeviceUi.outputOptions.map((option) => ({ ...option, kind: outputKind(String(option.label)) }))
  );
  const currentOutput = $derived(outputs.find((option) => option.value === roomDeviceUi.outputDeviceId) ?? outputs[0]);

  function outputKind(label: string): 'headset' | 'earpiece' | 'speaker' {
    if (/head|airpods|buds|bluetooth|наушн|гарнитур/i.test(label)) return 'headset';
    if (/earpiece|handset|телефон/i.test(label)) return 'earpiece';
    return 'speaker';
  }

  function toggleOutputMenu(): void {
    mobileCallUi.outputOpen = !mobileCallUi.outputOpen;
    if (mobileCallUi.outputOpen) void refreshDevices();
  }

  function pickOutput(value: string): void {
    mobileCallUi.outputOpen = false;
    if (value === roomDeviceUi.outputDeviceId) return;
    roomDeviceUi.outputDeviceId = value;
    void switchOutputDevice();
  }
</script>

{#snippet outputIcon(kind: 'headset' | 'earpiece' | 'speaker', size: number)}
  {#if kind === 'headset'}<Headphones {size} aria-hidden="true" />{:else if kind === 'earpiece'}<Smartphone
      {size}
      aria-hidden="true"
    />{:else}<Volume2 {size} aria-hidden="true" />{/if}
{/snippet}

{#if mobileCallUi.outputOpen}
  <button
    class="mc-output-scrim"
    type="button"
    aria-label="Закрыть выбор звука"
    onclick={() => (mobileCallUi.outputOpen = false)}
  ></button>
  <div class="mc-output-menu" role="group" aria-label="Куда выводить звук">
    {#each outputs as option (option.value)}
      <button
        class="mc-output-option"
        type="button"
        aria-pressed={option.value === currentOutput?.value}
        onclick={() => pickOutput(String(option.value))}
      >
        <span class="mc-output-option-icon">{@render outputIcon(option.kind, 20)}</span>
        <span class="mc-output-option-label">{option.label}</span>
        {#if option.value === currentOutput?.value}<Check
            class="mc-output-check"
            size={20}
            strokeWidth={2.4}
            aria-hidden="true"
          />{/if}
      </button>
    {/each}
  </div>
{/if}

<div class="mc-dock" role="group" aria-label="Управление звонком">
  <button
    class="mc-dock-button mc-dock-mic"
    type="button"
    aria-label={callControls.label}
    aria-pressed={callControls.ariaPressed}
    data-state={callControls.stateName}
    disabled={callControls.disabled}
    onclick={handleMicButtonClick}
  >
    {#if callControls.ariaPressed}<MicOff size={24} aria-hidden="true" />{:else}<Mic
        size={24}
        aria-hidden="true"
      />{/if}
  </button>
  {#if canPickOutput}
    <button
      class="mc-dock-button mc-dock-output"
      type="button"
      aria-label="Куда выводить звук"
      aria-expanded={mobileCallUi.outputOpen}
      onclick={toggleOutputMenu}
    >
      {@render outputIcon(currentOutput?.kind ?? 'speaker', 24)}
    </button>
  {/if}
  <button
    class="mc-dock-button mc-dock-camera"
    type="button"
    aria-label={cameraControls.label}
    aria-pressed={cameraControls.ariaPressed}
    data-state={cameraControls.stateName}
    disabled={cameraControls.disabled}
    onclick={() => void toggleCamera()}
  >
    {#if cameraControls.stateName === 'on'}<Video size={24} aria-hidden="true" />{:else}<VideoOff
        size={24}
        aria-hidden="true"
      />{/if}
  </button>
  <button
    class="mc-dock-button mc-dock-leave"
    type="button"
    aria-label="Покинуть звонок"
    onclick={handleLeaveButtonClick}
  >
    <PhoneOff size={24} aria-hidden="true" />
  </button>
</div>

<style>
  .mc-dock {
    position: absolute;
    left: 50%;
    bottom: var(--mc-dock-bottom);
    z-index: 5;
    display: flex;
    gap: 8px;
    padding: 8px;
    border: 1px solid var(--vr-line-strong);
    border-radius: 22px;
    background: var(--vr-dock-bg);
    box-shadow: var(--vr-shadow-dock);
    -webkit-backdrop-filter: blur(14px);
    backdrop-filter: blur(14px);
    transform: translateX(-50%);
    transition:
      opacity 250ms ease,
      transform 300ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  :global(.mobile-call[data-chrome='hidden']) .mc-dock {
    opacity: 0;
    transform: translate(-50%, 130px);
    pointer-events: none;
  }

  .mc-dock-button {
    display: grid;
    width: 58px;
    height: 58px;
    place-items: center;
    border: 0;
    border-radius: 16px;
    background: var(--vr-surface-3);
    color: var(--vr-text);
    -webkit-tap-highlight-color: transparent;
  }

  .mc-dock-button:disabled {
    opacity: 0.5;
  }

  .mc-dock-mic[aria-pressed='true'] {
    background: var(--vr-danger-off);
    color: var(--vr-danger);
  }

  .mc-dock-output[aria-expanded='true'] {
    background: var(--vr-surface-3-hover);
  }

  .mc-dock-camera[data-state='on'] {
    background: var(--vr-accent-soft);
    color: var(--vr-accent);
  }

  .mc-dock-leave {
    background: var(--vr-danger);
    color: var(--vr-on-danger);
  }

  .mc-output-scrim {
    position: absolute;
    inset: 0;
    z-index: 6;
    border: 0;
    background: transparent;
  }

  .mc-output-menu {
    position: absolute;
    left: 50%;
    bottom: calc(var(--mc-dock-bottom) + 86px);
    z-index: 7;
    display: grid;
    gap: 2px;
    width: min(250px, calc(100% - 24px));
    padding: 6px;
    box-sizing: border-box;
    border: 1px solid var(--vr-line-strong);
    border-radius: 18px;
    background: var(--vr-surface-2);
    box-shadow: var(--vr-shadow-popover);
    transform: translateX(-50%);
  }

  .mc-output-option {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 52px;
    padding: 0 12px;
    border: 0;
    border-radius: 12px;
    background: transparent;
    color: var(--vr-text);
    font: inherit;
    font-size: 15px;
    font-weight: 500;
    text-align: left;
  }

  .mc-output-option[aria-pressed='true'] {
    background: var(--vr-surface-3);
  }

  .mc-output-option-icon {
    display: inline-flex;
    color: var(--vr-text-2);
  }

  .mc-output-option-label {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mc-output-option :global(.mc-output-check) {
    flex: none;
    color: var(--vr-accent);
  }
</style>
