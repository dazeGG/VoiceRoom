<script lang="ts">
  import { Popover } from '$lib/shared/ui';
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

  import { screenUi } from '../screen-ui.svelte';

  const connection = $derived(getConnectionStatusView());
  const callControls = $derived(getCallControlsView());
  const outputControls = $derived(getOutputControlsView());
  const screenControls = $derived(getScreenControlsView());
  const gate = $derived(getGateControlView());

  let micLevelTrack: HTMLDivElement | undefined;

  function toggleDevicePopover(event: MouseEvent, toggle: () => void): void {
    event.stopPropagation();
    closeOutputPopover();
    const wasOpen = roomDeviceUi.devicePopoverOpen;
    toggle();
    if (!wasOpen) void refreshDevices();
  }

  function toggleOutputPopover(event: MouseEvent, toggle: () => void): void {
    event.stopPropagation();
    closeDevicePopover();
    const wasOpen = roomDeviceUi.outputPopoverOpen;
    toggle();
    if (!wasOpen) void refreshDevices();
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
</script>

<div class="room-dock" aria-label="Управление голосом">
  <div class="dock-shell">
    <div class="dock-cluster">
      <Popover
        bind:open={roomDeviceUi.devicePopoverOpen}
        placement="top-end"
        role="dialog"
        ariaLabel="Настройки микрофона"
        rootClass="dock-anchor"
        panelClass="device-popover"
        keepContentMounted
      >
        {#snippet trigger({ open, toggle, panelId })}
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
              aria-expanded={open}
              aria-controls={panelId}
              aria-label="Выбрать микрофон"
              data-icon="chevron-down"
              onclick={(event) => toggleDevicePopover(event, toggle)}
            ></button>
          </div>
        {/snippet}

        {#snippet content()}
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
        {/snippet}
      </Popover>
    </div>

    <div class="dock-cluster">
      <Popover
        bind:open={roomDeviceUi.outputPopoverOpen}
        placement="top-end"
        role="dialog"
        ariaLabel="Настройки динамика"
        rootClass="dock-anchor"
        panelClass="device-popover output-popover"
        keepContentMounted
      >
        {#snippet trigger({ open, toggle, panelId })}
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
              aria-expanded={open}
              aria-controls={panelId}
              aria-label="Выбрать динамик"
              data-icon="chevron-down"
              onclick={(event) => toggleOutputPopover(event, toggle)}
            ></button>
          </div>
        {/snippet}

        {#snippet content()}
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
        {/snippet}
      </Popover>
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