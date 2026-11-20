<script setup lang="ts">
import { t } from '@voice-room/ui/i18n';
import { Select, Slider } from '@voice-room/ui/components';
import { GATE_THRESHOLD_MAX_DB, GATE_THRESHOLD_MIN_DB } from '../engine/core/config';
import { NOISE_MODE_SELECT_OPTIONS } from '../engine/core/room-device-ui.store';
import type { GateControlView } from '../engine/ui/devices';
import type { CallDevice, CallDeviceSettings } from './types';

defineProps<{ device: CallDevice; state: CallDeviceSettings; gate: GateControlView }>();

const emit = defineEmits<{
  select: [device: CallDevice | 'noiseMode', id: string];
  microphoneVolume: [value: number];
  toggleGate: [];
  gateThreshold: [value: number];
}>();
</script>

<template>
  <template v-if="device === 'microphone'">
    <label class="room-dock__field">
      <span>{{ t('Микрофон') }}</span>
      <Select
        :model-value="state.microphoneId"
        :options="state.microphoneOptions"
        :label="t('Микрофон')"
        variant="dock"
        flip
        @value-change="emit('select', 'microphone', $event)"
      />
    </label>
    <div class="room-dock__field">
      <div class="room-dock__volume-head">
        <span>{{ t('Громкость микрофона') }}</span>
        <output>{{ Math.round(state.microphoneVolume) }}%</output>
      </div>
      <Slider
        :model-value="state.microphoneVolume"
        :min="0"
        :max="200"
        :step="1"
        :default-value="100"
        :aria-label="t('Громкость микрофона')"
        :aria-value-text="`${Math.round(state.microphoneVolume)}%`"
        @value-change="emit('microphoneVolume', $event)"
      />
    </div>
    <label class="room-dock__field">
      <span>{{ t('Шумоподавление') }}</span>
      <Select
        :model-value="state.noiseMode"
        :options="NOISE_MODE_SELECT_OPTIONS"
        :label="t('Шумоподавление')"
        variant="dock"
        flip
        @value-change="emit('select', 'noiseMode', $event)"
      />
    </label>
    <div class="room-dock__field">
      <div class="room-dock__gate-head">
        <span>{{ t('Гейт') }}</span>
        <button
          class="room-dock__gate-switch"
          type="button"
          role="switch"
          :aria-checked="gate.gateOn"
          :aria-label="t('Шумовой гейт')"
          @click="emit('toggleGate')"
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
          :aria-label="t('Порог гейта в децибелах')"
          :aria-value-text="gate.thresholdLabel"
          @value-change="emit('gateThreshold', $event)"
        >
          <template #background>
            <span
              :class="['room-dock__level-fill', { 'room-dock__level-fill--closed': gate.levelState === 'closed' }]"
              :style="{ transform: `scaleX(${gate.levelScale.toFixed(3)})` }"
            ></span>
          </template>
        </Slider>
        <output id="gateThresholdValue">{{ gate.thresholdLabel }}</output>
      </div>
    </div>
  </template>
  <label v-else-if="device === 'output'" class="room-dock__field">
    <span>{{ t('Динамик') }}</span>
    <Select
      :model-value="state.outputDeviceId"
      :options="state.outputOptions"
      :label="t('Динамик')"
      variant="dock"
      flip
      :disabled="state.outputDisabled"
      @value-change="emit('select', 'output', $event)"
    />
  </label>
  <label v-else class="room-dock__field">
    <span>{{ t('Камера') }}</span>
    <Select
      :model-value="state.cameraId"
      :options="state.cameraOptions"
      :label="t('Камера')"
      variant="dock"
      flip
      @value-change="emit('select', 'camera', $event)"
    />
  </label>
</template>
