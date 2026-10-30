<script setup lang="ts">
import { ref } from 'vue';
import { getDefaultHotkeyBinding, readHotkeyBinding, setDesktopGlobalHotkeysSuspended } from '@/features/room/client';
import type { HotkeyAction } from '@/features/room/client';
import { HotkeyRecorder } from '@/shared/ui';
import type { HotkeyBinding } from '@/shared/ui/HotkeyRecorder/types';
import { saveHotkey } from '../../model/hotkey-settings';

const props = withDefaults(
  defineProps<{
    action: HotkeyAction;
    label: string;
    description: string;
    ariaLabel: string;
    disabled?: boolean;
  }>(),
  { disabled: false }
);

const emit = defineEmits<{
  /** Clearing the push-to-talk key switched the microphone back to open. */
  pushToTalkOff: [];
}>();

const value = ref<HotkeyBinding | null>(readHotkeyBinding(props.action));

function change(binding: HotkeyBinding | null): void {
  if (saveHotkey(props.action, binding)) emit('pushToTalkOff');
}
</script>

<template>
  <div class="settings__hotkey-row" :class="{ 'settings__hotkey-row--disabled': disabled }">
    <div>
      <span class="settings__hotkey-label">{{ label }}</span>
      <span class="settings__hotkey-description">{{ description }}</span>
    </div>
    <HotkeyRecorder
      v-model="value"
      :default-value="getDefaultHotkeyBinding(action)"
      :disabled="disabled"
      :aria-label="ariaLabel"
      @recording-change="(recording: boolean) => void setDesktopGlobalHotkeysSuspended(recording)"
      @value-change="change"
    />
  </div>
</template>
