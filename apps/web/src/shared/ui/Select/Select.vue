<script setup lang="ts">
import { Select, type SelectProps } from '@voice-room/ui/components';
import EmojiText from '@/shared/chat/EmojiText.vue';

const props = defineProps<SelectProps>();
const emit = defineEmits<{ valueChange: [value: string] }>();
const value = defineModel<string>({ default: '' });
</script>

<template>
  <Select v-bind="props" v-model="value" @value-change="emit('valueChange', $event)">
    <template #option-label="{ text }"><EmojiText :text="text" /></template>
  </Select>
</template>
