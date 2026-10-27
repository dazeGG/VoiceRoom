<script setup lang="ts">
import {
  ChevronDown,
  HeadphoneOff,
  Headphones,
  Mic,
  MicOff,
  PhoneOff,
  ScreenShare,
  ScreenShareOff,
  Video,
  VideoOff
} from '@lucide/vue';
import { computed, onBeforeUnmount, watch } from 'vue';
import { Popover, Select, Slider } from '@/shared/ui';
import { createLogger, errorContext } from '@/shared/log';
import { NOISE_MODE_SELECT_OPTIONS, useRoomDeviceUiStore } from '../room-device-ui.store';
import { GATE_THRESHOLD_MAX_DB, GATE_THRESHOLD_MIN_DB } from '../client/core/config';
import {
  closeCameraPopover,
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
  getCameraControlsView,
  getOutputControlsView,
  getScreenControlsView,
  handleMicButtonClick,
  toggleOutputMute
} from '../client/ui/controls';
import { getConnectionStatusView } from '../client/ui/status';
import { handleScreenButtonClick } from '../client/services/screen-share-service';
import { handleLeaveButtonClick } from '../client/room/room';
import { leaveScreenView } from '../client/ui/screen-view';
import { state as roomClientState } from '../client/core/room-runtime.store';
import { setMicrophoneVolume } from '../client/services/microphone-service';
import { setMicrophoneLevelReporting } from '../client/media/meters';
import { switchCamera, toggleCamera } from '../client/services/camera-service';
import { useScreenUiStore } from '../screen-ui.store';

const log = createLogger('room:dock');

const roomDeviceUi = useRoomDeviceUiStore();
const screenUi = useScreenUiStore();

const connection = computed(() => getConnectionStatusView());
const callControls = computed(() => getCallControlsView());
const outputControls = computed(() => getOutputControlsView());
const screenControls = computed(() => getScreenControlsView());
const cameraControls = computed(() => getCameraControlsView());
const gate = computed(() => getGateControlView());

// The live microphone level is only reported while its popover is open.
watch(() => roomDeviceUi.devicePopoverOpen, setMicrophoneLevelReporting, { immediate: true });
onBeforeUnmount(() => setMicrophoneLevelReporting(false));

function toggleDevicePopover(event: MouseEvent, toggle: () => void): void {
  event.stopPropagation();
  closeOutputPopover();
  closeCameraPopover();
  const wasOpen = roomDeviceUi.devicePopoverOpen;
  toggle();
  if (!wasOpen) void refreshDevices();
}

function toggleOutputPopover(event: MouseEvent, toggle: () => void): void {
  event.stopPropagation();
  closeDevicePopover();
  closeCameraPopover();
  const wasOpen = roomDeviceUi.outputPopoverOpen;
  toggle();
  if (!wasOpen) void refreshDevices();
}

function toggleCameraPopover(event: MouseEvent): void {
  event.stopPropagation();
  closeDevicePopover();
  closeOutputPopover();
  const wasOpen = roomDeviceUi.cameraPopoverOpen;
  roomDeviceUi.cameraPopoverOpen = !wasOpen;
  if (!wasOpen) void refreshDevices();
}

function exitScreenView(): void {
  leaveScreenView({ keepPreview: false }).catch((error: unknown) =>
    log.error('screen view action failed', errorContext(error))
  );
}
</script>

<template>
  <div class="room-dock" aria-label="Управление голосом">
    <div class="room-dock__shell">
      <div class="room-dock__cluster">
        <Popover
          v-model:open="roomDeviceUi.devicePopoverOpen"
          placement="top-end"
          role="dialog"
          aria-label="Настройки микрофона"
          root-class="room-dock__anchor"
          panel-class="room-dock__device-popover"
          keep-content-mounted
          flip
        >
          <template #trigger="{ open, toggle, panelId }">
            <div
              :class="[
                'room-dock__split',
                {
                  'room-dock__split--muted': callControls.stateName === 'muted',
                  'room-dock__split--active': callControls.stateName === 'ptt-active'
                }
              ]"
            >
              <button
                id="muteButton"
                :class="[
                  'room-dock__button',
                  'room-dock__button--mic',
                  { 'room-dock__button--muted': callControls.stateName === 'muted' }
                ]"
                type="button"
                :aria-pressed="callControls.ariaPressed"
                :aria-label="callControls.label"
                :disabled="callControls.disabled"
                @click="handleMicButtonClick"
              >
                <span class="room-dock__icon room-dock__icon--mic" aria-hidden="true"><Mic /></span>
                <span class="room-dock__icon room-dock__icon--muted" aria-hidden="true"><MicOff /></span>
                <span
                  v-if="roomClientState.microphoneMode === 'push-to-talk'"
                  :class="[
                    'room-dock__ptt-badge',
                    { 'room-dock__ptt-badge--active': roomClientState.pushToTalkActive }
                  ]"
                  aria-hidden="true"
                  >PTT</span
                >
                <span id="muteText" class="room-dock__label">{{ callControls.label }}</span>
              </button>
              <button
                id="deviceMenuButton"
                class="room-dock__menu-button"
                type="button"
                :aria-expanded="open"
                :aria-controls="panelId"
                aria-label="Выбрать микрофон"
                @click="toggleDevicePopover($event, toggle)"
              >
                <ChevronDown />
              </button>
            </div>
          </template>

          <template #content>
            <label class="room-dock__field">
              <span>Микрофон</span>
              <Select
                v-model="roomDeviceUi.microphoneId"
                :options="roomDeviceUi.microphoneOptions"
                label="Микрофон"
                variant="dock"
                flip
                @value-change="void switchMicrophone()"
              />
            </label>
            <div class="room-dock__field">
              <div class="room-dock__volume-head">
                <span>Громкость микрофона</span>
                <output>{{ Math.round(roomDeviceUi.microphoneVolume) }}%</output>
              </div>
              <Slider
                v-model="roomDeviceUi.microphoneVolume"
                :min="0"
                :max="200"
                :step="1"
                :default-value="100"
                aria-label="Громкость микрофона"
                :aria-value-text="`${Math.round(roomDeviceUi.microphoneVolume)}%`"
                @value-change="setMicrophoneVolume"
              />
            </div>
            <label class="room-dock__field">
              <span>Шумоподавление</span>
              <Select
                v-model="roomDeviceUi.noiseMode"
                :options="NOISE_MODE_SELECT_OPTIONS"
                label="Шумоподавление"
                variant="dock"
                flip
                @value-change="void switchNoiseMode()"
              />
            </label>
            <div class="room-dock__field">
              <div class="room-dock__gate-head">
                <span>Гейт</span>
                <button
                  class="room-dock__gate-switch"
                  type="button"
                  role="switch"
                  :aria-checked="gate.gateOn"
                  aria-label="Шумовой гейт"
                  @click="toggleGate"
                >
                  <span class="room-dock__gate-switch-knob" aria-hidden="true"></span>
                </button>
              </div>
              <div :class="['room-dock__gate-control', { 'room-dock__gate-control--disabled': !gate.markerActive }]">
                <Slider
                  :model-value="gate.thresholdValue"
                  :min="GATE_THRESHOLD_MIN_DB"
                  :max="GATE_THRESHOLD_MAX_DB"
                  :step="1"
                  :disabled="!gate.markerActive"
                  :show-fill="false"
                  aria-label="Порог гейта в децибелах"
                  :aria-value-text="gate.thresholdLabel"
                  @value-change="updateGateThresholdFromSlider"
                >
                  <template #background>
                    <span
                      :class="[
                        'room-dock__level-fill',
                        { 'room-dock__level-fill--closed': gate.levelState === 'closed' }
                      ]"
                      :style="{ transform: `scaleX(${gate.levelScale.toFixed(3)})` }"
                    ></span>
                  </template>
                </Slider>
                <output id="gateThresholdValue">{{ gate.thresholdLabel }}</output>
              </div>
            </div>
          </template>
        </Popover>
      </div>

      <div class="room-dock__cluster">
        <Popover
          v-model:open="roomDeviceUi.outputPopoverOpen"
          placement="top-end"
          role="dialog"
          aria-label="Настройки динамика"
          root-class="room-dock__anchor"
          panel-class="room-dock__device-popover"
          keep-content-mounted
          flip
        >
          <template #trigger="{ open, toggle, panelId }">
            <div :class="['room-dock__split', { 'room-dock__split--muted': outputControls.stateName === 'muted' }]">
              <button
                id="outputButton"
                :class="[
                  'room-dock__button',
                  'room-dock__button--output',
                  { 'room-dock__button--muted': outputControls.stateName === 'muted' }
                ]"
                type="button"
                :aria-pressed="outputControls.ariaPressed"
                :aria-label="outputControls.label"
                @click="toggleOutputMute()"
              >
                <span class="room-dock__icon room-dock__icon--output" aria-hidden="true"><Headphones /></span>
                <span class="room-dock__icon room-dock__icon--output-muted" aria-hidden="true"><HeadphoneOff /></span>
                <span id="outputText" class="room-dock__label">{{ outputControls.label }}</span>
              </button>
              <button
                id="outputMenuButton"
                class="room-dock__menu-button"
                type="button"
                :aria-expanded="open"
                :aria-controls="panelId"
                aria-label="Выбрать динамик"
                @click="toggleOutputPopover($event, toggle)"
              >
                <ChevronDown />
              </button>
            </div>
          </template>

          <template #content>
            <label class="room-dock__field">
              <span>Динамик</span>
              <Select
                v-model="roomDeviceUi.outputDeviceId"
                :options="roomDeviceUi.outputOptions"
                label="Динамик"
                variant="dock"
                flip
                :disabled="roomDeviceUi.outputDisabled"
                @value-change="void switchOutputDevice()"
              />
            </label>
          </template>
        </Popover>
      </div>

      <div class="room-dock__cluster">
        <Popover
          v-model:open="roomDeviceUi.cameraPopoverOpen"
          placement="top-end"
          role="dialog"
          aria-label="Настройки камеры"
          root-class="room-dock__anchor"
          panel-class="room-dock__device-popover"
          keep-content-mounted
          flip
        >
          <template #trigger="{ open, panelId }">
            <div :class="['room-dock__split', { 'room-dock__split--on': cameraControls.stateName === 'on' }]">
              <button
                id="cameraButton"
                :class="[
                  'room-dock__button',
                  'room-dock__button--camera',
                  { 'room-dock__button--on': cameraControls.stateName === 'on' }
                ]"
                type="button"
                :aria-pressed="cameraControls.ariaPressed"
                :aria-label="cameraControls.label"
                :disabled="cameraControls.disabled"
                @click="void toggleCamera()"
              >
                <span class="room-dock__icon room-dock__icon--camera" aria-hidden="true"><Video /></span>
                <span class="room-dock__icon room-dock__icon--camera-off" aria-hidden="true"><VideoOff /></span>
                <span class="room-dock__label">{{ cameraControls.label }}</span>
              </button>
              <button
                id="cameraMenuButton"
                class="room-dock__menu-button"
                type="button"
                :aria-expanded="open"
                :aria-controls="panelId"
                aria-label="Выбрать камеру"
                @click="toggleCameraPopover"
              >
                <ChevronDown />
              </button>
            </div>
          </template>

          <template #content>
            <label class="room-dock__field">
              <span>Камера</span>
              <Select
                v-model="roomDeviceUi.cameraId"
                :options="roomDeviceUi.cameraOptions"
                label="Камера"
                variant="dock"
                flip
                @value-change="void switchCamera(roomDeviceUi.cameraId)"
              />
            </label>
          </template>
        </Popover>
      </div>

      <div class="room-dock__cluster room-dock__cluster--screen">
        <button
          id="screenButton"
          :class="[
            'room-dock__button',
            'room-dock__button--screen',
            { 'room-dock__button--live': screenControls.stateName === 'live' }
          ]"
          type="button"
          :aria-pressed="screenControls.ariaPressed"
          :aria-label="screenControls.label"
          :disabled="screenControls.disabled"
          @click="handleScreenButtonClick"
        >
          <span class="room-dock__icon room-dock__icon--screen" aria-hidden="true"><ScreenShare /></span>
          <span class="room-dock__icon room-dock__icon--screen-stop" aria-hidden="true"><ScreenShareOff /></span>
          <span id="screenText" class="room-dock__label">{{ screenControls.label }}</span>
        </button>
      </div>

      <span class="room-dock__divider" aria-hidden="true"></span>

      <div class="room-dock__connection-wrap">
        <div
          :class="['room-dock__connection', `room-dock__connection--${connection.stateName}`]"
          role="status"
          :aria-label="connection.label || 'Связь'"
        >
          <span class="room-dock__bar" aria-hidden="true"></span>
          <span class="room-dock__bar" aria-hidden="true"></span>
          <span class="room-dock__bar" aria-hidden="true"></span>
        </div>
        <span
          :class="['room-dock__connection-popover', `room-dock__connection-popover--${connection.stateName}`]"
          role="tooltip"
        >
          <span class="room-dock__connection-dot" aria-hidden="true"></span>
          <span class="room-dock__connection-label">{{ connection.label || 'Связь' }}</span>
        </span>
      </div>

      <button
        id="leaveButton"
        class="room-dock__button room-dock__button--leave"
        type="button"
        aria-label="Покинуть звонок"
        :hidden="screenUi.hideLeaveButton"
        @click="handleLeaveButtonClick"
      >
        <PhoneOff aria-hidden="true" />
      </button>
      <button
        id="screenExitButton"
        class="room-dock__button room-dock__button--screen-exit"
        type="button"
        aria-label="Выйти со стрима"
        :hidden="!screenUi.showScreenExit"
        @click="exitScreenView"
      >
        <ScreenShareOff aria-hidden="true" />
      </button>
    </div>
  </div>
</template>
