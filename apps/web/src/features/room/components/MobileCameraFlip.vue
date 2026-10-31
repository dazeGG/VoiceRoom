<script setup lang="ts">
import { SwitchCamera } from '@lucide/vue';
import { computed, ref } from 'vue';
import { state as roomClientState } from '@/features/room/client/core/room-runtime.store';
import { flipCamera } from '@/features/room/client/services/camera-service';
import { useMobileCallUiStore } from '@/features/room/mobile-call-ui.store';

/** `pill` carries its label; `round` is the icon alone, for the small picture-in-picture. */
const { variant = 'pill' } = defineProps<{ variant?: 'pill' | 'round' }>();

const mobileCall = useMobileCallUiStore();

// Each tap turns the icon half a turn, the way the camera turns.
const turns = ref(0);
const label = computed(() => (roomClientState.cameraFacing === 'environment' ? 'На фронтальную' : 'На основную'));

function flip(event: MouseEvent): void {
  event.stopPropagation();
  turns.value += 1;
  void flipCamera();
}

// Not a drag of the picture under it, but still a touch that keeps the controls.
function keepControls(event: PointerEvent): void {
  event.stopPropagation();
  mobileCall.restartChromeTimer();
}
</script>

<template>
  <button
    :class="['mobile-call-flip', `mobile-call-flip--${variant}`]"
    type="button"
    :aria-label="`${label} камеру`"
    :disabled="roomClientState.cameraStarting"
    @click="flip"
    @pointerdown="keepControls"
  >
    <span class="mobile-call-flip__icon" :style="{ transform: `rotate(${turns * 180}deg)` }">
      <SwitchCamera :size="variant === 'round' ? 20 : 22" aria-hidden="true" />
    </span>
    <span v-if="variant === 'pill'">{{ label }}</span>
  </button>
</template>
