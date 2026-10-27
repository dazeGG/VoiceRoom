<script setup lang="ts">
import { RotateCcw } from '@lucide/vue';
import { iconSm } from '@/shared/ui/icons';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { formatHotkeyBinding, hotkeyBindingFromEvent, isHotkeyModifierCode } from './hotkey';
import type { HotkeyBinding, HotkeyRecorderProps } from './types';

const props = withDefaults(defineProps<HotkeyRecorderProps>(), {
  defaultValue: null,
  disabled: false,
  ariaLabel: 'Горячая клавиша'
});

const emit = defineEmits<{ recordingChange: [recording: boolean]; valueChange: [value: HotkeyBinding | null] }>();

const value = defineModel<HotkeyBinding | null>({ default: null });

const recording = ref(false);
const recorderButton = ref<HTMLButtonElement>();

function startRecording(): void {
  if (props.disabled) return;
  if (!recording.value) emit('recordingChange', true);
  recording.value = true;
  recorderButton.value?.focus();
}

function stopRecording(): void {
  if (recording.value) emit('recordingChange', false);
  recording.value = false;
}

function captureKey(event: KeyboardEvent): void {
  if (!recording.value) return;
  event.preventDefault();
  event.stopImmediatePropagation();

  if (event.key === 'Escape') {
    stopRecording();
    return;
  }
  if (isHotkeyModifierCode(event.code)) return;

  const next = hotkeyBindingFromEvent(event);
  if (!next) return;
  value.value = next;
  stopRecording();
  emit('valueChange', next);
}

function reset(): void {
  if (props.disabled) return;
  value.value = props.defaultValue;
  stopRecording();
  emit('valueChange', props.defaultValue);
}

function handleFocusOut(event: FocusEvent): void {
  const next = event.relatedTarget;
  if (next instanceof Node && event.currentTarget instanceof Node && event.currentTarget.contains(next)) return;
  stopRecording();
}

// Capture phase: Reka's Escape listener on window must not see the key while recording.
onMounted(() => window.addEventListener('keydown', captureKey, true));
onBeforeUnmount(() => {
  window.removeEventListener('keydown', captureKey, true);
  stopRecording();
});
</script>

<template>
  <div class="hotkey-recorder" @focusout="handleFocusOut">
    <button
      ref="recorderButton"
      class="hotkey-recorder__field"
      :data-hotkey-recorder-recording="String(recording)"
      type="button"
      :disabled="disabled"
      :aria-label="ariaLabel"
      :aria-pressed="recording"
      @click="startRecording"
    >
      <span class="hotkey-recorder__value" :class="{ 'hotkey-recorder__value--empty': !value }">
        {{ recording ? 'Нажмите клавиши…' : formatHotkeyBinding(value) }}
      </span>
    </button>
    <button
      class="hotkey-recorder__reset"
      type="button"
      :disabled="disabled"
      :aria-label="`Сбросить: ${ariaLabel}`"
      title="Сбросить"
      @click="reset"
    >
      <RotateCcw v-bind="iconSm" aria-hidden="true" />
    </button>
  </div>
</template>
