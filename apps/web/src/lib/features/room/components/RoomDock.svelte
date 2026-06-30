<script lang="ts">
  import { onMount } from 'svelte';
  import { Select } from '$lib/shared/ui';
  import {
    NOISE_MODE_SELECT_OPTIONS,
    roomDeviceUi
  } from '$lib/features/room/room-device-ui.svelte';
  import {
    closeDevicePopover,
    closeOutputPopover,
    getGateControlView,
    refreshDevices,
    switchMicrophone,
    switchNoiseMode,
    switchOutputDevice,
    updateGateThresholdFromPosition,
    updateGateThresholdFromSlider
  } from '../client/ui/devices';
  import {
    getCallControlsView,
    getOutputControlsView,
    getScreenControlsView,
    handleMicButtonClick,
    toggleOutputMute
  } from '../client/ui/controls';
  import { getConnectionStatusView } from '../client/ui/status';
  import { handleScreenButtonClick } from '../client/services/screen-share-service';
  import { handleLeaveButtonClick } from '../client/room/room';
  import { leaveScreenView } from '../client/ui/screen-view';

  import { state } from '../client/core/state.svelte';
  import { screenUi } from '../screen-ui.svelte';

  const connection = $derived(getConnectionStatusView());
  const callControls = $derived(getCallControlsView());
  const outputControls = $derived(getOutputControlsView());
  const screenControls = $derived(getScreenControlsView());
  const gate = $derived(getGateControlView());

  let micLevelTrack: HTMLDivElement | undefined;

  function toggleDevicePopover(event: MouseEvent): void {
    event.stopPropagation();
    closeOutputPopover();
    roomDeviceUi.devicePopoverOpen = !roomDeviceUi.devicePopoverOpen;
    if (roomDeviceUi.devicePopoverOpen) void refreshDevices();
  }

  function toggleOutputPopover(event: MouseEvent): void {
    event.stopPropagation();
    closeDevicePopover();
    roomDeviceUi.outputPopoverOpen = !roomDeviceUi.outputPopoverOpen;
    if (roomDeviceUi.outputPopoverOpen) void refreshDevices();
  }

  function handleDocumentClick(event: MouseEvent): void {
    const target = event.target as Node;
    if (roomDeviceUi.devicePopoverOpen) {
      const popover = document.getElementById('devicePopover');
      const button = document.getElementById('deviceMenuButton');
      if (popover && button && !popover.contains(target) && !button.contains(target)) {
        closeDevicePopover();
      }
    }
    if (roomDeviceUi.outputPopoverOpen) {
      const popover = document.getElementById('outputPopover');
      const button = document.getElementById('outputMenuButton');
      if (popover && button && !popover.contains(target) && !button.contains(target)) {
        closeOutputPopover();
      }
    }
  }

  function handleDocumentKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      closeDevicePopover();
      closeOutputPopover();
    }
  }

  function handleGatePointerDown(event: PointerEvent): void {
    event.preventDefault();
    updateGateFromPointer(event);
    micLevelTrack?.setPointerCapture?.(event.pointerId);
    micLevelTrack?.addEventListener('pointermove', handleGatePointerMove);
    micLevelTrack?.addEventListener('pointerup', handleGatePointerEnd, { once: true });
    micLevelTrack?.addEventListener('pointercancel', handleGatePointerEnd, { once: true });
  }

  function handleGatePointerMove(event: PointerEvent): void {
    updateGateFromPointer(event);
  }

  function handleGatePointerEnd(event: PointerEvent): void {
    micLevelTrack?.releasePointerCapture?.(event.pointerId);
    micLevelTrack?.removeEventListener('pointermove', handleGatePointerMove);
  }

  function updateGateFromPointer(event: PointerEvent): void {
    if (!micLevelTrack) return;
    const rect = micLevelTrack.getBoundingClientRect();
    updateGateThresholdFromPosition(event.clientX, rect.left, rect.width);
  }

  onMount(() => {
    document.addEventListener('click', handleDocumentClick);
    document.addEventListener('keydown', handleDocumentKeydown);
    return () => {
      document.removeEventListener('click', handleDocumentClick);
      document.removeEventListener('keydown', handleDocumentKeydown);
    };
  });
</script>

<div class="room-dock" aria-label="Управление голосом">
  <div class="dock-shell">
    <div class="dock-cluster">
      <div class="dock-anchor">
        <div class="dock-split">
          <button
            class="dock-button mic-button"
            id="muteButton"
            type="button"
            aria-pressed={callControls.ariaPressed}
            aria-label={callControls.label}
            data-state={callControls.stateName}
            disabled={callControls.disabled}
            onclick={handleMicButtonClick}
          >
            <span class="dock-icon dock-icon-mic" data-icon="mic" aria-hidden="true"></span>
            <span class="dock-icon dock-icon-muted" data-icon="mic-muted" aria-hidden="true"></span>
            <span class="sr-only" id="muteText">{callControls.label}</span>
          </button>
          <button
            class="dock-menu-button"
            id="deviceMenuButton"
            type="button"
            aria-expanded={roomDeviceUi.devicePopoverOpen}
            aria-controls="devicePopover"
            aria-label="Выбрать микрофон"
            data-icon="chevron-down"
            onclick={toggleDevicePopover}
          ></button>
        </div>

        <div class="device-popover" id="devicePopover" hidden={!roomDeviceUi.devicePopoverOpen}>
          <label class="field">
            <span>Микрофон</span>
            <Select
              bind:value={roomDeviceUi.microphoneId}
              options={roomDeviceUi.microphoneOptions}
              label="Микрофон"
              variant="dock"
              flip
              onValueChange={() => void switchMicrophone()}
            />
          </label>
          <label class="field">
            <span>Шумоподавление</span>
            <Select
              bind:value={roomDeviceUi.noiseMode}
              options={NOISE_MODE_SELECT_OPTIONS}
              label="Шумоподавление"
              variant="dock"
              flip
              onValueChange={() => void switchNoiseMode()}
            />
          </label>
          <label class="field">
            <span>Гейт</span>
            <div class="gate-control">
              <div class="gate-meter-wrap">
                <div
                  class="mic-level-track"
                  id="micLevelTrack"
                  bind:this={micLevelTrack}
                  role="meter"
                  aria-label="Уровень микрофона"
                  aria-valuemin="-100"
                  aria-valuemax="0"
                  aria-valuenow={gate.ariaValueNow}
                  onpointerdown={handleGatePointerDown}
                >
                  <span
                    class="mic-level-fill"
                    id="micLevelFill"
                    style:transform="scaleX({gate.levelScale.toFixed(3)})"
                    data-state={gate.levelState}
                  ></span>
                  <span
                    class="mic-gate-marker"
                    id="micGateMarker"
                    style:left={gate.markerLeft}
                    data-active={String(gate.markerActive)}
                  ></span>
                </div>
                <input
                  id="gateThresholdSlider"
                  type="range"
                  min="-100"
                  max="0"
                  step="1"
                  value={gate.thresholdValue}
                  aria-label="Порог гейта в децибелах"
                  oninput={(event) => updateGateThresholdFromSlider(event.currentTarget.value)}
                />
              </div>
              <output id="gateThresholdValue" for="gateThresholdSlider">{gate.thresholdLabel}</output>
            </div>
          </label>
        </div>
      </div>
    </div>

    <div class="dock-cluster">
      <div class="dock-anchor">
        <div class="dock-split">
          <button
            class="dock-button output-button"
            id="outputButton"
            type="button"
            aria-pressed={outputControls.ariaPressed}
            aria-label={outputControls.label}
            data-state={outputControls.stateName}
            onclick={toggleOutputMute}
          >
            <span class="dock-icon dock-icon-output" data-icon="headphones" aria-hidden="true"></span>
            <span class="dock-icon dock-icon-output-muted" data-icon="headphones-muted" aria-hidden="true"></span>
            <span class="sr-only" id="outputText">{outputControls.label}</span>
          </button>
          <button
            class="dock-menu-button"
            id="outputMenuButton"
            type="button"
            aria-expanded={roomDeviceUi.outputPopoverOpen}
            aria-controls="outputPopover"
            aria-label="Выбрать динамик"
            data-icon="chevron-down"
            onclick={toggleOutputPopover}
          ></button>
        </div>

        <div class="device-popover output-popover" id="outputPopover" hidden={!roomDeviceUi.outputPopoverOpen}>
          <label class="field">
            <span>Динамик</span>
            <Select
              bind:value={roomDeviceUi.outputDeviceId}
              options={roomDeviceUi.outputOptions}
              label="Динамик"
              variant="dock"
              flip
              disabled={roomDeviceUi.outputDisabled}
              onValueChange={() => void switchOutputDevice()}
            />
          </label>
        </div>
      </div>
    </div>

    <button
      class="dock-button screen-button"
      id="screenButton"
      type="button"
      aria-pressed={screenControls.ariaPressed}
      aria-label={screenControls.label}
      data-state={screenControls.stateName}
      disabled={screenControls.disabled}
      onclick={handleScreenButtonClick}
    >
      <span class="dock-icon dock-icon-screen" data-icon="screen-share" aria-hidden="true"></span>
      <span class="dock-icon dock-icon-screen-stop" data-icon="screen-stop" aria-hidden="true"></span>
      <span class="sr-only" id="screenText">{screenControls.label}</span>
    </button>

    <span class="dock-divider" aria-hidden="true"></span>

    <div class="dock-connection-wrap">
      <div class="dock-connection" data-state={connection.stateName} role="status" aria-label={connection.label || 'Связь'}>
        <span class="dock-bar" aria-hidden="true"></span>
        <span class="dock-bar" aria-hidden="true"></span>
        <span class="dock-bar" aria-hidden="true"></span>
      </div>
      <span class="dock-connection-popover" role="tooltip">
        <span class="dock-connection-dot" aria-hidden="true"></span>
        <span class="dock-connection-label">{connection.label || 'Связь'}</span>
      </span>
    </div>

    <button class="dock-button leave-button" id="leaveButton" type="button" aria-label="Выйти из комнаты" data-icon="leave" hidden={screenUi.hideLeaveButton} onclick={handleLeaveButtonClick}></button>
    <button
      class="dock-button screen-exit-button"
      id="screenExitButton"
      type="button"
      aria-label="Выйти со стрима"
      data-icon="screen-stop"
      hidden={!screenUi.showScreenExit}
      onclick={() => leaveScreenView({ keepPreview: false }).catch((error) => console.error(error))}
    ></button>
  </div>
</div>