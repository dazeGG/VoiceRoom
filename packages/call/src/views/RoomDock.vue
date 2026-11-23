<script setup lang="ts">
import { t } from '@voiceroom/ui-kit/i18n';
import {
  ChevronUp,
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
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { IconButton, Popover, Separator, Tooltip } from '@voiceroom/ui-kit/components';
import { formatHotkeyKeys } from '@voiceroom/ui-kit/hotkey';
import { HOTKEY_BINDINGS_CHANGED_EVENT, readHotkeyBinding } from '../engine/core/hotkeys';
import type {
  CallControlsView,
  CameraControlsView,
  OutputControlsView,
  ScreenControlsView
} from '../engine/ui/controls';
import type { ConnectionStatusView } from '../engine/ui/status';
import type { CallDevice } from './types';

const props = defineProps<{
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

function readDockBindings() {
  return {
    mic: readHotkeyBinding('mic-mute'),
    pushToTalk: readHotkeyBinding('push-to-talk'),
    output: readHotkeyBinding('output-mute')
  };
}

const bindings = ref(readDockBindings());
const microphoneShortcut = computed(() => {
  const binding = props.pushToTalk ? bindings.value.pushToTalk : bindings.value.mic;
  return binding ? formatHotkeyKeys(binding) : undefined;
});
const outputShortcut = computed(() => (bindings.value.output ? formatHotkeyKeys(bindings.value.output) : undefined));

function refreshHotkeys(): void {
  bindings.value = readDockBindings();
}

onMounted(() => window.addEventListener(HOTKEY_BINDINGS_CHANGED_EVENT, refreshHotkeys));
onBeforeUnmount(() => window.removeEventListener(HOTKEY_BINDINGS_CHANGED_EVENT, refreshHotkeys));
</script>

<template>
  <div class="room-dock" role="group" :aria-label="t('Управление голосом')">
    <div class="room-dock__shell">
      <div class="room-dock__cluster">
        <Popover
          :open="microphoneMenu"
          placement="top-end"
          role="dialog"
          :title="t('Настройки микрофона')"
          flip
          @update:open="emit('updateDeviceMenu', 'microphone', $event)"
        >
          <template #trigger="{ open, panelId }">
            <div
              :class="[
                'room-dock__split',
                {
                  'room-dock__split--muted': callControls.stateName === 'muted' || callControls.stateName === 'ptt',
                  'room-dock__split--on': callControls.stateName === 'live' || pushToTalkActive
                }
              ]"
            >
              <IconButton
                id="muteButton"
                class="room-dock__button room-dock__button--mic"
                :size="44"
                :aria-pressed="callControls.ariaPressed"
                :label="callControls.label"
                :shortcut="microphoneShortcut"
                :disabled="callControls.disabled"
                @click="emit('toggleMicrophone', $event)"
              >
                <MicOff v-if="callControls.stateName === 'muted'" aria-hidden="true" />
                <Mic v-else aria-hidden="true" />
                <span
                  v-if="pushToTalk"
                  :class="['room-dock__ptt-badge', { 'room-dock__ptt-badge--active': pushToTalkActive }]"
                  aria-hidden="true"
                  >PTT</span
                >
              </IconButton>
              <IconButton
                id="deviceMenuButton"
                class="room-dock__menu-button"
                :size="24"
                :aria-expanded="open"
                :aria-controls="panelId"
                aria-haspopup="dialog"
                :label="t('Выбрать микрофон')"
                @click.stop="emit('toggleDeviceMenu', 'microphone')"
              >
                <ChevronUp aria-hidden="true" />
              </IconButton>
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
          :title="t('Настройки динамика')"
          flip
          @update:open="emit('updateDeviceMenu', 'output', $event)"
        >
          <template #trigger="{ open, panelId }">
            <div
              :class="[
                'room-dock__split',
                outputControls.ariaPressed ? 'room-dock__split--muted' : 'room-dock__split--on'
              ]"
            >
              <IconButton
                id="outputButton"
                class="room-dock__button room-dock__button--output"
                :size="44"
                :aria-pressed="outputControls.ariaPressed"
                :label="outputControls.label"
                :shortcut="outputShortcut"
                @click="emit('toggleOutput')"
              >
                <HeadphoneOff v-if="outputControls.ariaPressed" aria-hidden="true" />
                <Headphones v-else aria-hidden="true" />
              </IconButton>
              <IconButton
                id="outputMenuButton"
                class="room-dock__menu-button"
                :size="24"
                :aria-expanded="open"
                :aria-controls="panelId"
                aria-haspopup="dialog"
                :label="t('Выбрать динамик')"
                @click.stop="emit('toggleDeviceMenu', 'output')"
              >
                <ChevronUp aria-hidden="true" />
              </IconButton>
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
          :title="t('Настройки камеры')"
          flip
          @update:open="emit('updateDeviceMenu', 'camera', $event)"
        >
          <template #trigger="{ open, panelId }">
            <div
              :class="[
                'room-dock__split',
                cameraControls.ariaPressed ? 'room-dock__split--on' : 'room-dock__split--muted'
              ]"
            >
              <IconButton
                id="cameraButton"
                class="room-dock__button room-dock__button--camera"
                :size="44"
                :aria-pressed="cameraControls.ariaPressed"
                :label="cameraControls.label"
                :disabled="cameraControls.disabled"
                @click="emit('toggleCamera')"
              >
                <Video v-if="cameraControls.ariaPressed" aria-hidden="true" />
                <VideoOff v-else aria-hidden="true" />
              </IconButton>
              <IconButton
                id="cameraMenuButton"
                class="room-dock__menu-button"
                :size="24"
                :aria-expanded="open"
                :aria-controls="panelId"
                aria-haspopup="dialog"
                :label="t('Выбрать камеру')"
                @click.stop="emit('toggleDeviceMenu', 'camera')"
              >
                <ChevronUp aria-hidden="true" />
              </IconButton>
            </div>
          </template>

          <template #content><slot name="deviceSettings" device="camera" /></template>
        </Popover>
      </div>

      <div class="room-dock__cluster room-dock__cluster--screen">
        <IconButton
          id="screenButton"
          class="room-dock__button room-dock__button--screen"
          :size="44"
          :variant="screenControls.ariaPressed ? 'primary' : 'filled'"
          :aria-pressed="screenControls.ariaPressed"
          :label="screenControls.label"
          :disabled="screenControls.disabled"
          @click="emit('toggleScreen')"
        >
          <ScreenShareOff v-if="screenControls.ariaPressed" aria-hidden="true" />
          <ScreenShare v-else aria-hidden="true" />
        </IconButton>
      </div>

      <Separator class="room-dock__divider" orientation="vertical" decorative />

      <div class="room-dock__connection-wrap">
        <Tooltip :text="connection.label || t('Связь')">
          <div
            :class="['room-dock__connection', `room-dock__connection--${connection.stateName}`]"
            role="status"
            :aria-label="connection.label || t('Связь')"
          >
            <span class="room-dock__bar" aria-hidden="true"></span>
            <span class="room-dock__bar" aria-hidden="true"></span>
            <span class="room-dock__bar" aria-hidden="true"></span>
          </div>
        </Tooltip>
      </div>

      <IconButton
        id="leaveButton"
        class="room-dock__button room-dock__button--leave"
        :size="44"
        :label="t('Покинуть звонок')"
        :hidden="hideLeaveButton"
        @click="emit('leave')"
      >
        <PhoneOff aria-hidden="true" />
      </IconButton>
      <IconButton
        id="screenExitButton"
        class="room-dock__button room-dock__button--screen-exit"
        :size="44"
        :label="t('Выйти со стрима')"
        :hidden="!showScreenExit"
        @click="emit('exitScreen')"
      >
        <ScreenShareOff aria-hidden="true" />
      </IconButton>
    </div>
  </div>
</template>
