<script setup lang="ts">
import { Button, IconButton } from '@voice-room/ui/components';
import { t } from '@/shared/i18n';
import { SwitchCamera } from '@lucide/vue';
import { computed, ref } from 'vue';
import { state as roomClientState } from '@voice-room/call/engine/core/room-runtime.store';
import { flipCamera } from '@voice-room/call/engine/services/camera-service';
import { useMobileCallUiStore } from '@/features/room/mobile-call-ui.store';
import { useRoomUiStore } from '@/features/room/room-ui.store';

/** `pill` carries its label; `round` is the icon alone, for the small picture-in-picture. */
const { variant = 'pill' } = defineProps<{ variant?: 'pill' | 'round' }>();

const mobileCall = useMobileCallUiStore();
const roomUi = useRoomUiStore();

// Each tap turns the icon half a turn, the way the camera turns.
const turns = ref(0);
const label = computed(() => (roomClientState.cameraFacing === 'environment' ? t('На фронтальную') : t('На основную')));

function flip(event: MouseEvent): void {
  event.stopPropagation();
  turns.value += 1;
  void flipCamera();
}

// Not a drag of the picture under it, but still a touch that keeps the controls.
function keepControls(event: PointerEvent): void {
  event.stopPropagation();
  mobileCall.restartChromeTimer(() => roomUi.chatOpen);
}
</script>

<template>
  <IconButton
    v-if="variant === 'round'"
    scrim
    pill
    class="mobile-call-flip--round"
    :label="t('{p0} камеру', { p0: label })"
    :size="44"
    variant="outline"
    :disabled="roomClientState.cameraStarting"
    @click="flip"
    @pointerdown="keepControls"
  >
    <span class="mobile-call-flip__icon" :style="{ transform: `rotate(${turns * 180}deg)` }">
      <SwitchCamera aria-hidden="true" />
    </span>
  </IconButton>
  <Button
    v-else
    scrim
    class="mobile-call-flip"
    variant="outline"
    size="lg"
    :aria-label="t('{p0} камеру', { p0: label })"
    :disabled="roomClientState.cameraStarting"
    @click="flip"
    @pointerdown="keepControls"
  >
    <template #icon>
      <span class="mobile-call-flip__icon" :style="{ transform: `rotate(${turns * 180}deg)` }">
        <SwitchCamera aria-hidden="true" />
      </span>
    </template>
    {{ label }}
  </Button>
</template>
