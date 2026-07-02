<script lang="ts">
  import { Popover, Select, Slider } from '$lib/shared/ui';
  import {
    NOISE_MODE_SELECT_OPTIONS,
    roomDeviceUi
  } from '$lib/features/room/room-device-ui.svelte';
  import {
    GATE_THRESHOLD_MAX_DB,
    GATE_THRESHOLD_MIN_DB,
    SCREEN_FPS_OPTIONS,
    SCREEN_QUALITY_OPTIONS,
    SCREEN_QUALITY_ORDER
  } from '../client/core/config';
  import { state as roomState } from '../client/core/state.svelte';
  import {
    closeDevicePopover,
    closeOutputPopover,
    getGateControlView,
    refreshDevices,
    switchMicrophone,
    switchNoiseMode,
    switchOutputDevice,
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
  import {
    getScreenStreamModeView,
    handleScreenButtonClick,
    selectScreenStreamMode,
    setCustomScreenFps,
    setCustomScreenQuality
  } from '../client/services/screen-share-service';
  import { handleLeaveButtonClick } from '../client/room/room';
  import { leaveScreenView } from '../client/ui/screen-view';

  import { screenUi } from '../screen-ui.svelte';

  let screenPopoverOpen = $state(false);

  const connection = $derived(getConnectionStatusView());
  const callControls = $derived(getCallControlsView());
  const outputControls = $derived(getOutputControlsView());
  const screenControls = $derived(getScreenControlsView());
  const gate = $derived(getGateControlView());
  const screenModes = $derived(getScreenStreamModeView());
  const screenQualityOptions = SCREEN_QUALITY_ORDER.map((qualityId) => SCREEN_QUALITY_OPTIONS[qualityId]).map((option) => ({
    value: option.id,
    label: option.label
  }));
  const screenFpsOptions = Object.values(SCREEN_FPS_OPTIONS).map((option) => ({
    value: option.id,
    label: option.label
  }));

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

  function toggleScreenPopover(event: MouseEvent, toggle: () => void): void {
    event.stopPropagation();
    closeDevicePopover();
    closeOutputPopover();
    toggle();
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

    <div class="dock-cluster">
      <Popover
        bind:open={screenPopoverOpen}
        placement="top-end"
        role="dialog"
        ariaLabel="Настройки стрима"
        rootClass="dock-anchor"
        panelClass="device-popover screen-popover"
        keepContentMounted
      >
        {#snippet trigger({ open, toggle, panelId })}
          <div class="dock-split">
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
            <button
              class="dock-menu-button"
              id="screenMenuButton"
              type="button"
              aria-expanded={open}
              aria-controls={panelId}
              aria-label="Настройки стрима"
              data-icon="chevron-down"
              onclick={(event) => toggleScreenPopover(event, toggle)}
            ></button>
          </div>
        {/snippet}

        {#snippet content()}
          <section class="screen-mode-panel" aria-labelledby="screenModeTitle">
            <div class="screen-mode-title" id="screenModeTitle">Режим стрима</div>
            <div class="screen-mode-list" role="radiogroup" aria-label="Режим стрима">
              {#each screenModes as mode}
                <button
                  class="screen-mode-option"
                  type="button"
                  role="radio"
                  aria-checked={mode.checked}
                  data-active={mode.checked}
                  onclick={() => void selectScreenStreamMode(mode.id)}
                >
                  <span class="screen-mode-copy">
                    <strong>{mode.label}</strong>
                    <span>{mode.summary}</span>
                  </span>
                  <span class="screen-mode-radio" aria-hidden="true"></span>
                </button>
              {/each}
            </div>

            {#if roomState.localScreenMode === 'custom'}
              <div class="screen-mode-advanced">
                <span class="screen-mode-divider" aria-hidden="true"></span>
                <div class="screen-mode-advanced-title">Расширенные</div>
                <label class="field">
                  <span>Качество</span>
                  <Select
                    bind:value={roomState.localScreenQualityId}
                    options={screenQualityOptions}
                    label="Качество стрима"
                    variant="dock"
                    flip
                    onValueChange={setCustomScreenQuality}
                  />
                </label>
                <label class="field">
                  <span>FPS</span>
                  <Select
                    bind:value={roomState.localScreenFpsId}
                    options={screenFpsOptions}
                    label="FPS стрима"
                    variant="dock"
                    flip
                    onValueChange={setCustomScreenFps}
                  />
                </label>
              </div>
            {/if}
          </section>
        {/snippet}
      </Popover>
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
