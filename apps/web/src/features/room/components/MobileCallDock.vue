<script setup lang="ts">
import { IconButton } from '@voice-room/ui/components';
// The phone dock: four big buttons and nothing to aim at. The phone picks the
// microphone and its own volume keys stand in for muting the sound.
import { t } from '@/shared/i18n';
import { Check, Headphones, Mic, MicOff, PhoneOff, Smartphone, Video, VideoOff, Volume2 } from '@lucide/vue';
import { computed } from 'vue';
import { handleLeaveButtonClick } from '@voice-room/call/engine/room/room';
import { toggleCamera } from '@voice-room/call/engine/services/camera-service';
import { supportsAudioOutputSelection } from '@voice-room/call/engine/services/media-playback-service';
import { getCallControlsView, getCameraControlsView, handleMicButtonClick } from '@voice-room/call/engine/ui/controls';
import { refreshDevices, switchOutputDevice } from '@voice-room/call/engine/ui/devices';
import { useMobileCallUiStore } from '@/features/room/mobile-call-ui.store';
import { useRoomDeviceUiStore } from '@voice-room/call/engine/core/room-device-ui.store';

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

function toggleOutputMenu(): void {
  mobileCall.outputOpen = !mobileCall.outputOpen;
  if (mobileCall.outputOpen) void refreshDevices();
}

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
  <template v-if="mobileCall.outputOpen">
    <button
      class="mobile-call-dock__output-scrim"
      type="button"
      :aria-label="t('Закрыть выбор звука')"
      @click="mobileCall.outputOpen = false"
    ></button>
    <div class="mobile-call-dock__output-menu" role="group" :aria-label="t('Куда выводить звук')">
      <button
        v-for="option in outputs"
        :key="option.value"
        class="mobile-call-dock__output-option"
        type="button"
        :aria-pressed="option.value === currentOutput?.value"
        @click="pickOutput(String(option.value))"
      >
        <span class="mobile-call-dock__output-icon">
          <Headphones v-if="option.kind === 'headset'" :size="20" aria-hidden="true" />
          <Smartphone v-else-if="option.kind === 'earpiece'" :size="20" aria-hidden="true" />
          <Volume2 v-else :size="20" aria-hidden="true" />
        </span>
        <span class="mobile-call-dock__output-label">{{ option.label }}</span>
        <Check
          v-if="option.value === currentOutput?.value"
          class="mobile-call-dock__output-check"
          :size="20"
          :stroke-width="2.4"
          aria-hidden="true"
        />
      </button>
    </div>
  </template>

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
    <IconButton
      v-if="canPickOutput"
      class="mobile-call-dock__button mobile-call-dock__button--output"
      :label="t('Куда выводить звук')"
      :aria-expanded="mobileCall.outputOpen"
      :size="44"
      variant="filled"
      @click="toggleOutputMenu"
    >
      <Headphones v-if="currentOutput?.kind === 'headset'" aria-hidden="true" />
      <Smartphone v-else-if="currentOutput?.kind === 'earpiece'" aria-hidden="true" />
      <Volume2 v-else aria-hidden="true" />
    </IconButton>
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
