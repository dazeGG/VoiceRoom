<script setup lang="ts">
import { IconButton, DropdownMenu, MenuRadioGroup, MenuRadioItem } from '@voiceroom/ui-kit/components';
// The phone dock: four big buttons and nothing to aim at. The phone picks the
// microphone and its own volume keys stand in for muting the sound.
import { t } from '@/shared/i18n';
import { Headphones, Mic, MicOff, PhoneOff, Smartphone, Video, VideoOff, Volume2 } from '@lucide/vue';
import { computed, watch } from 'vue';
import { handleLeaveButtonClick } from '@voiceroom/call/engine/room/room';
import { toggleCamera } from '@voiceroom/call/engine/services/camera-service';
import { supportsAudioOutputSelection } from '@voiceroom/call/engine/services/media-playback-service';
import { getCallControlsView, getCameraControlsView, handleMicButtonClick } from '@voiceroom/call/engine/ui/controls';
import { refreshDevices, switchOutputDevice } from '@voiceroom/call/engine/ui/devices';
import { useMobileCallUiStore } from '@/features/room/mobile-call-ui.store';
import { useRoomDeviceUiStore } from '@voiceroom/call/engine/core/room-device-ui.store';

type OutputKind = 'headset' | 'earpiece' | 'speaker';

const roomDeviceUi = useRoomDeviceUiStore();
const mobileCall = useMobileCallUiStore();

const callControls = computed(() => getCallControlsView());
const cameraControls = computed(() => getCameraControlsView());
// iOS routes the sound itself and lets no page choose; the button is then left out.
const canPickOutput = supportsAudioOutputSelection();
const outputs = computed(() =>
  roomDeviceUi.outputOptions.map((option) => ({ ...option, kind: outputKind(String(option.label)) }))
);
const currentOutput = computed(
  () => outputs.value.find((option) => option.value === roomDeviceUi.outputDeviceId) ?? outputs.value[0]
);

function outputKind(label: string): OutputKind {
  if (/head|airpods|buds|bluetooth|наушн|гарнитур/i.test(label)) return 'headset';
  if (/earpiece|handset|телефон/i.test(label)) return 'earpiece';
  return 'speaker';
}

watch(
  () => mobileCall.outputOpen,
  (open) => {
    if (open) void refreshDevices();
  }
);

function handleCameraClick(): void {
  void toggleCamera();
}

function pickOutput(value: string): void {
  mobileCall.outputOpen = false;
  if (value === roomDeviceUi.outputDeviceId) return;
  roomDeviceUi.outputDeviceId = value;
  void switchOutputDevice();
}
</script>

<template>
  <div class="mobile-call-dock" role="group" :aria-label="t('Управление звонком')">
    <IconButton
      class="mobile-call-dock__button mobile-call-dock__button--mic"
      :label="callControls.label"
      :aria-pressed="callControls.ariaPressed"
      :disabled="callControls.disabled"
      :size="44"
      variant="filled"
      @click="handleMicButtonClick"
    >
      <MicOff v-if="callControls.ariaPressed" aria-hidden="true" />
      <Mic v-else aria-hidden="true" />
    </IconButton>
    <DropdownMenu
      v-if="canPickOutput"
      v-model:open="mobileCall.outputOpen"
      :aria-label="t('Куда выводить звук')"
      side="top"
      align="center"
      focus-checked
    >
      <template #trigger>
        <IconButton
          class="mobile-call-dock__button mobile-call-dock__button--output"
          :label="t('Куда выводить звук')"
          :size="44"
          variant="filled"
        >
          <Headphones v-if="currentOutput?.kind === 'headset'" aria-hidden="true" />
          <Smartphone v-else-if="currentOutput?.kind === 'earpiece'" aria-hidden="true" />
          <Volume2 v-else aria-hidden="true" />
        </IconButton>
      </template>
      <template #content>
        <MenuRadioGroup
          :model-value="String(currentOutput?.value ?? '')"
          @update:model-value="
            (value) => {
              if (value !== undefined) pickOutput(value);
            }
          "
        >
          <MenuRadioItem
            v-for="option in outputs"
            :key="option.value"
            :value="String(option.value)"
            :label="String(option.label)"
          >
            <template #icon>
              <Headphones v-if="option.kind === 'headset'" aria-hidden="true" />
              <Smartphone v-else-if="option.kind === 'earpiece'" aria-hidden="true" />
              <Volume2 v-else aria-hidden="true" />
            </template>
          </MenuRadioItem>
        </MenuRadioGroup>
      </template>
    </DropdownMenu>
    <IconButton
      :class="[
        'mobile-call-dock__button',
        { 'mobile-call-dock__button--camera-on': cameraControls.stateName === 'on' }
      ]"
      :label="cameraControls.label"
      :aria-pressed="cameraControls.ariaPressed"
      :disabled="cameraControls.disabled"
      :size="44"
      variant="filled"
      @click="handleCameraClick"
    >
      <Video v-if="cameraControls.stateName === 'on'" aria-hidden="true" />
      <VideoOff v-else aria-hidden="true" />
    </IconButton>
    <IconButton
      class="mobile-call-dock__button mobile-call-dock__button--leave"
      :label="t('Покинуть звонок')"
      :size="44"
      variant="filled"
      @click="handleLeaveButtonClick"
    >
      <PhoneOff aria-hidden="true" />
    </IconButton>
  </div>
</template>
