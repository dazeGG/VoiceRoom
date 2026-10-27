<script setup lang="ts">
import { RotateCcw } from '@lucide/vue';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { formatHotkeyBinding, hotkeyBindingFromEvent, isHotkeyModifierCode } from './hotkey';
import type { HotkeyBinding, HotkeyRecorderProps } from './types';

type Props = Pick<HotkeyRecorderProps, 'ariaLabel' | 'defaultValue' | 'disabled'>;

const props = withDefaults(defineProps<Props>(), { defaultValue: null, disabled: false, ariaLabel: 'Горячая клавиша' });

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

onMounted(() => window.addEventListener('keydown', captureKey));
onBeforeUnmount(() => {
  window.removeEventListener('keydown', captureKey);
  stopRecording();
});
</script>

<template>
  <div class="hotkey-recorder" @focusout="handleFocusOut">
    <button
      ref="recorderButton"
      class="hotkey-recorder__field"
      :class="{ 'hotkey-recorder__field--recording': recording }"
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
      <RotateCcw :size="15" :stroke-width="2" aria-hidden="true" />
    </button>
  </div>
</template>
