<script lang="ts">
  import { Select } from '$lib/shared/ui';
  import {
    NOISE_MODE_SELECT_OPTIONS,
    roomDeviceUi
  } from '$lib/features/room/room-device-ui.svelte';
  import {
    switchMicrophone,
    switchNoiseMode,
    switchOutputDevice
  } from '../client/ui/devices';
  import { getConnectionStatusView } from '../client/ui/status';

  const connection = $derived(getConnectionStatusView());
</script>

<div class="room-dock" aria-label="Управление голосом">
  <div class="dock-shell">
    <!-- Mic split: toggle + settings chevron -->
    <div class="dock-cluster">
      <div class="dock-anchor">
        <div class="dock-split">
          <button class="dock-button mic-button" id="muteButton" type="button" aria-pressed="false" aria-label="Подключить микрофон">
            <span class="dock-icon dock-icon-mic" data-icon="mic" aria-hidden="true"></span>
            <span class="dock-icon dock-icon-muted" data-icon="mic-muted" aria-hidden="true"></span>
            <span class="sr-only" id="muteText">Подключить микрофон</span>
          </button>
          <button class="dock-menu-button" id="deviceMenuButton" type="button" aria-expanded="false" aria-controls="devicePopover" aria-label="Выбрать микрофон" data-icon="chevron-down"></button>
        </div>

        <div class="device-popover" id="devicePopover" hidden>
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
                <div class="mic-level-track" id="micLevelTrack" role="meter" aria-label="Уровень микрофона" aria-valuemin="-100" aria-valuemax="0" aria-valuenow="-100">
                  <span class="mic-level-fill" id="micLevelFill"></span>
                  <span class="mic-gate-marker" id="micGateMarker"></span>
                </div>
                <input id="gateThresholdSlider" type="range" min="-100" max="0" step="1" value="-100" aria-label="Порог гейта в децибелах">
              </div>
              <output id="gateThresholdValue" for="gateThresholdSlider">Выкл</output>
            </div>
          </label>
        </div>
      </div>
    </div>

    <!-- Headphones split: toggle + settings chevron -->
    <div class="dock-cluster">
      <div class="dock-anchor">
        <div class="dock-split">
          <button class="dock-button output-button" id="outputButton" type="button" aria-pressed="false" aria-label="Выключить звук">
            <span class="dock-icon dock-icon-output" data-icon="headphones" aria-hidden="true"></span>
            <span class="dock-icon dock-icon-output-muted" data-icon="headphones-muted" aria-hidden="true"></span>
            <span class="sr-only" id="outputText">Выключить звук</span>
          </button>
          <button class="dock-menu-button" id="outputMenuButton" type="button" aria-expanded="false" aria-controls="outputPopover" aria-label="Выбрать динамик" data-icon="chevron-down"></button>
        </div>

        <div class="device-popover output-popover" id="outputPopover" hidden>
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

    <!-- Screen share -->
    <button class="dock-button screen-button" id="screenButton" type="button" aria-pressed="false" aria-label="Показать экран">
      <span class="dock-icon dock-icon-screen" data-icon="screen-share" aria-hidden="true"></span>
      <span class="dock-icon dock-icon-screen-stop" data-icon="screen-stop" aria-hidden="true"></span>
      <span class="sr-only" id="screenText">Показать экран</span>
    </button>

    <span class="dock-divider" aria-hidden="true"></span>

    <!-- Connection: signal bars + ping popover on hover -->
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

    <!-- Leave -->
    <button class="dock-button leave-button" id="leaveButton" type="button" aria-label="Выйти из комнаты" data-icon="leave"></button>
    <button class="dock-button screen-exit-button" id="screenExitButton" type="button" aria-label="Выйти со стрима" data-icon="screen-stop" hidden></button>
    <button class="sound-button" id="soundButton" type="button" hidden>Разрешить звук</button>
  </div>
</div>