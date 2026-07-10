<script lang="ts">
  import {
    ChevronDown,
    HeadphoneOff,
    Headphones,
    Mic,
    MicOff,
    ScreenShare,
    ScreenShareOff,
    X
  } from '@lucide/svelte';
  import { Popover, Select, Slider } from '$lib/shared/ui';
  import {
    NOISE_MODE_SELECT_OPTIONS,
    roomDeviceUi
  } from '$lib/features/room/room-device-ui.svelte';
  import {
    GATE_THRESHOLD_MAX_DB,
    GATE_THRESHOLD_MIN_DB
  } from '../client/core/config';
  import {
    closeDevicePopover,
    closeOutputPopover,
    getGateControlView,
    refreshDevices,
    switchMicrophone,
    switchNoiseMode,
    switchOutputDevice,
    toggleGate,
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
              <span class="dock-icon dock-icon-mic" aria-hidden="true"><Mic /></span>
              <span class="dock-icon dock-icon-muted" aria-hidden="true"><MicOff /></span>
              <span class="sr-only" id="muteText">{callControls.label}</span>
            </button>
            <button
              class="dock-menu-button"
              id="deviceMenuButton"
              type="button"
              aria-expanded={open}
              aria-controls={panelId}
              aria-label="Выбрать микрофон"
              onclick={(event) => toggleDevicePopover(event, toggle)}
            >
              <ChevronDown />
            </button>
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
          <div class="field">
            <div class="gate-field-head">
              <span>Гейт</span>
              <button
                class="gate-switch"
                type="button"
                role="switch"
                aria-checked={gate.gateOn}
                aria-label="Шумовой гейт"
                onclick={toggleGate}
              >
                <span class="gate-switch-knob" aria-hidden="true"></span>
              </button>
            </div>
            <div class="gate-control" data-disabled={!gate.markerActive}>
              <Slider
                value={gate.thresholdValue}
                min={GATE_THRESHOLD_MIN_DB}
                max={GATE_THRESHOLD_MAX_DB}
                step={1}
                disabled={!gate.markerActive}
                showFill={false}
                ariaLabel="Порог гейта в децибелах"
                ariaValueText={gate.thresholdLabel}
                onValueChange={updateGateThresholdFromSlider}
              >
                {#snippet background()}
                  <span
                    class="mic-level-fill"
                    style:transform="scaleX({gate.levelScale.toFixed(3)})"
                    data-state={gate.levelState}
                  ></span>
                {/snippet}
              </Slider>
              <output id="gateThresholdValue">{gate.thresholdLabel}</output>
            </div>
          </div>
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
              <span class="dock-icon dock-icon-output" aria-hidden="true"><Headphones /></span>
              <span class="dock-icon dock-icon-output-muted" aria-hidden="true"><HeadphoneOff /></span>
              <span class="sr-only" id="outputText">{outputControls.label}</span>
            </button>
            <button
              class="dock-menu-button"
              id="outputMenuButton"
              type="button"
              aria-expanded={open}
              aria-controls={panelId}
              aria-label="Выбрать динамик"
              onclick={(event) => toggleOutputPopover(event, toggle)}
            >
              <ChevronDown />
            </button>
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

    <div class="dock-cluster">
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
        <span class="dock-icon dock-icon-screen" aria-hidden="true"><ScreenShare /></span>
        <span class="dock-icon dock-icon-screen-stop" aria-hidden="true"><ScreenShareOff /></span>
        <span class="sr-only" id="screenText">{screenControls.label}</span>
      </button>
    </div>

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

    <button class="dock-button leave-button" id="leaveButton" type="button" aria-label="Выйти из комнаты" hidden={screenUi.hideLeaveButton} onclick={handleLeaveButtonClick}>
      <X aria-hidden="true" />
    </button>
    <button
      class="dock-button screen-exit-button"
      id="screenExitButton"
      type="button"
      aria-label="Выйти со стрима"
      hidden={!screenUi.showScreenExit}
      onclick={() => leaveScreenView({ keepPreview: false }).catch((error) => console.error(error))}
    >
      <ScreenShareOff aria-hidden="true" />
    </button>
  </div>
</div>