<script setup lang="ts">
import { t } from '@voice-room/ui/i18n';
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
import { Popover } from '@voice-room/ui/components';
import type {
  CallControlsView,
  CameraControlsView,
  OutputControlsView,
  ScreenControlsView
} from '../engine/ui/controls';
import type { ConnectionStatusView } from '../engine/ui/status';
import type { CallDevice } from './types';

defineProps<{
  connection: ConnectionStatusView;
  callControls: CallControlsView;
  outputControls: OutputControlsView;
  screenControls: ScreenControlsView;
  cameraControls: CameraControlsView;
  pushToTalk: boolean;
  pushToTalkActive: boolean;
  microphoneMenu: boolean;
  outputMenu: boolean;
  cameraMenu: boolean;
  hideLeaveButton: boolean;
  showScreenExit: boolean;
}>();

const emit = defineEmits<{
  toggleMicrophone: [event: MouseEvent];
  toggleOutput: [];
  toggleCamera: [];
  toggleScreen: [];
  leave: [];
  exitScreen: [];
  toggleDeviceMenu: [device: CallDevice];
  updateDeviceMenu: [device: CallDevice, open: boolean];
}>();

defineSlots<{ deviceSettings(props: { device: CallDevice }): unknown }>();
</script>

<template>
  <div class="room-dock" :aria-label="t('Управление голосом')">
    <div class="room-dock__shell">
      <div class="room-dock__cluster">
        <Popover
          :open="microphoneMenu"
          placement="top-end"
          role="dialog"
          :aria-label="t('Настройки микрофона')"
          root-class="room-dock__anchor"
          panel-class="room-dock__device-popover"
          keep-content-mounted
          flip
          @update:open="emit('updateDeviceMenu', 'microphone', $event)"
        >
          <template #trigger="{ open, panelId }">
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
                @click="emit('toggleMicrophone', $event)"
              >
                <span class="room-dock__icon room-dock__icon--mic" aria-hidden="true"><Mic /></span>
                <span class="room-dock__icon room-dock__icon--muted" aria-hidden="true"><MicOff /></span>
                <span
                  v-if="pushToTalk"
                  :class="['room-dock__ptt-badge', { 'room-dock__ptt-badge--active': pushToTalkActive }]"
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
                :aria-label="t('Выбрать микрофон')"
                @click.stop="emit('toggleDeviceMenu', 'microphone')"
              >
                <ChevronDown />
              </button>
            </div>
          </template>

          <template #content><slot name="deviceSettings" device="microphone" /></template>
        </Popover>
      </div>

      <div class="room-dock__cluster">
        <Popover
          :open="outputMenu"
          placement="top-end"
          role="dialog"
          :aria-label="t('Настройки динамика')"
          root-class="room-dock__anchor"
          panel-class="room-dock__device-popover"
          keep-content-mounted
          flip
          @update:open="emit('updateDeviceMenu', 'output', $event)"
        >
          <template #trigger="{ open, panelId }">
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
                @click="emit('toggleOutput')"
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
                :aria-label="t('Выбрать динамик')"
                @click.stop="emit('toggleDeviceMenu', 'output')"
              >
                <ChevronDown />
              </button>
            </div>
          </template>

          <template #content><slot name="deviceSettings" device="output" /></template>
        </Popover>
      </div>

      <div class="room-dock__cluster">
        <Popover
          :open="cameraMenu"
          placement="top-end"
          role="dialog"
          :aria-label="t('Настройки камеры')"
          root-class="room-dock__anchor"
          panel-class="room-dock__device-popover"
          keep-content-mounted
          flip
          @update:open="emit('updateDeviceMenu', 'camera', $event)"
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
                @click="emit('toggleCamera')"
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
                :aria-label="t('Выбрать камеру')"
                @click.stop="emit('toggleDeviceMenu', 'camera')"
              >
                <ChevronDown />
              </button>
            </div>
          </template>

          <template #content><slot name="deviceSettings" device="camera" /></template>
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
          @click="emit('toggleScreen')"
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
          :aria-label="connection.label || t('Связь')"
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
          <span class="room-dock__connection-label">{{ connection.label || t('Связь') }}</span>
        </span>
      </div>

      <button
        id="leaveButton"
        class="room-dock__button room-dock__button--leave"
        type="button"
        :aria-label="t('Покинуть звонок')"
        :hidden="hideLeaveButton"
        @click="emit('leave')"
      >
        <PhoneOff aria-hidden="true" />
      </button>
      <button
        id="screenExitButton"
        class="room-dock__button room-dock__button--screen-exit"
        type="button"
        :aria-label="t('Выйти со стрима')"
        :hidden="!showScreenExit"
        @click="emit('exitScreen')"
      >
        <ScreenShareOff aria-hidden="true" />
      </button>
    </div>
  </div>
</template>
