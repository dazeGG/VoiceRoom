<script setup lang="ts">
import { computed } from 'vue';
import { ChevronLeft, ChevronRight } from '@lucide/vue';
import { fromInputValue, toInputValue } from '../../time-range.ts';
import { Button, IconButton, TextField } from '../../ui';
import { shiftDay, startOfDay } from './days.ts';

const props = defineProps<{ dayStart: number; today: number; keepDays: number }>();
const emit = defineEmits<{ change: [dayStart: number] }>();
const earliest = computed(() => shiftDay(props.today, -props.keepDays));

function pick(at: number): void {
  emit('change', Math.min(props.today, Math.max(earliest.value, startOfDay(at))));
}

function pickDate(value: string): void {
  const at = fromInputValue(value, false);
  if (at !== null) pick(at);
}
</script>

<template>
  <div class="admin-day-picker" role="group" aria-label="День ленты">
    <IconButton
      label="Предыдущий день"
      :size="32"
      :disabled="dayStart <= earliest"
      @click="pick(shiftDay(dayStart, -1))"
    >
      <ChevronLeft aria-hidden="true" />
    </IconButton>
    <TextField
      type="date"
      size="sm"
      aria-label="День"
      :model-value="toInputValue(dayStart, false)"
      :min="toInputValue(earliest, false)"
      :max="toInputValue(today, false)"
      @update:model-value="pickDate"
    />
    <IconButton label="Следующий день" :size="32" :disabled="dayStart >= today" @click="pick(shiftDay(dayStart, 1))">
      <ChevronRight aria-hidden="true" />
    </IconButton>
    <Button v-if="dayStart < today" size="sm" variant="plain" @click="pick(today)">Сегодня</Button>
  </div>
</template>
