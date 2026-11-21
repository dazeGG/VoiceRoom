<script setup lang="ts">
import { t } from '../../i18n';
import { RotateCcw } from '@lucide/vue';
import { computed, onBeforeUnmount, onMounted, ref, useId, useTemplateRef } from 'vue';
import { formatHotkeyKeys, hotkeyBindingFromEvent, type HotkeyBinding } from '../../hotkey';
import { useFieldControl } from '../Field/context';
import IconButton from '../IconButton/IconButton.vue';
import Kbd from '../Kbd/Kbd.vue';
import type { HotkeyFieldProps } from './types';

const props = withDefaults(defineProps<HotkeyFieldProps>(), {
  defaultValue: null,
  disabled: false,
  ariaLabel: ''
});

const emit = defineEmits<{ recordingChange: [recording: boolean]; valueChange: [value: HotkeyBinding | null] }>();

const value = defineModel<HotkeyBinding | null>({ default: null });

const recording = ref(false);
const controlAttrs = useFieldControl();
const valueId = useId();
const keys = computed(() => (value.value ? formatHotkeyKeys(value.value) : []));
const recorderButton = useTemplateRef<HTMLButtonElement>('recorderButton');
const fieldAttrs = computed(() => controlAttrs({}, valueId));

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
  <div class="ui-input ui-hotkey" @focusout="handleFocusOut">
    <button
      v-bind="fieldAttrs"
      ref="recorderButton"
      class="ui-input__control ui-hotkey__trigger"
      type="button"
      :disabled="disabled"
      :aria-label="ariaLabel || (fieldAttrs.id ? undefined : t('Горячая клавиша'))"
      :aria-pressed="recording"
      @click="startRecording"
    >
      <span v-if="recording" class="ui-hotkey__dot" aria-hidden="true"></span>
      <span :id="valueId" class="ui-hotkey__keys">
        <template v-if="recording">{{ t('Нажмите клавиши…') }}</template>
        <Kbd v-else-if="keys.length" :keys="keys" />
        <template v-else>{{ t('Не назначено') }}</template>
      </span>
    </button>
    <div class="ui-input__actions">
      <IconButton
        :size="28"
        :disabled="disabled"
        :label="t('Сбросить: {p0}', { p0: ariaLabel || t('Горячая клавиша') })"
        @click="reset"
      >
        <RotateCcw aria-hidden="true" />
      </IconButton>
    </div>
  </div>
</template>
