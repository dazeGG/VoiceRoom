<script setup lang="ts">
import { computed, ref } from 'vue';
import { Calendar } from '@lucide/vue';
import { Field } from '@voiceroom/ui-kit/components';
import { fromInputValue, rangeLabel, toInputValue, type RangePreset, type TimeRange } from './time-range.ts';
import { Button, Popover, SegmentControl, TextField } from './ui';

const props = defineProps<{
  value: TimeRange;
  presets: readonly RangePreset[];
  withTime: boolean;
  resolved?: { from: number; to: number } | null | undefined;
}>();
const emit = defineEmits<{ change: [range: TimeRange] }>();
const fromText = ref('');
const toText = ref('');
const invalid = ref(false);
const custom = computed(() => props.value.kind === 'custom');
const inputType = computed(() => (props.withTime ? 'datetime-local' : 'date'));
const label = computed(() => (custom.value ? rangeLabel(props.value, props.presets, props.withTime) : 'Свой период'));
const covered = computed(() =>
  props.resolved ? rangeLabel({ kind: 'custom', ...props.resolved }, props.presets, props.withTime) : ''
);
const options = computed(() => props.presets.map(({ id, short }) => ({ value: id, label: short })));

function prefill(): void {
  const now = Date.now();
  const span = props.value.kind === 'custom' ? props.value : (props.resolved ?? { from: now - 86_400_000, to: now });
  fromText.value = toInputValue(span.from, props.withTime);
  toText.value = toInputValue(span.to, props.withTime);
  invalid.value = false;
}

function apply(close: () => void): void {
  const from = fromInputValue(fromText.value, props.withTime);
  const to = fromInputValue(toText.value, props.withTime);
  if (from === null || to === null || from > to) {
    invalid.value = true;
    return;
  }
  emit('change', { kind: 'custom', from, to });
  close();
}
</script>

<template>
  <div class="admin-range">
    <SegmentControl
      v-bind="{ ariaLabel: 'Период' }"
      :value="value.kind === 'preset' ? value.id : ''"
      :options="options"
      @change="(id) => emit('change', { kind: 'preset', id })"
    />
    <Popover role="dialog" aria-label="Период" title="Свой период" placement="bottom-start" flip>
      <template #trigger="{ open, toggle, panelId }">
        <Button
          :variant="custom ? 'soft' : 'outline'"
          aria-haspopup="dialog"
          :aria-expanded="open"
          :aria-controls="panelId"
          :aria-label="custom ? `Свой период: ${label}` : label"
          @click="
            () => {
              if (!open) prefill();
              toggle();
            }
          "
        >
          <template #icon><Calendar aria-hidden="true" /></template>
          {{ label }}
        </Button>
      </template>
      <template #content="{ close }">
        <form class="admin-range__form" @submit.prevent="apply(close)">
          <Field label="С">
            <TextField
              v-model="fromText"
              :type="inputType"
              size="sm"
              :aria-invalid="invalid"
              @update:model-value="invalid = false"
            />
          </Field>
          <Field label="По">
            <TextField
              v-model="toText"
              :type="inputType"
              size="sm"
              :aria-invalid="invalid"
              @update:model-value="invalid = false"
            />
          </Field>
          <p v-if="invalid" class="admin-range__error" role="alert">Начало должно быть раньше конца.</p>
          <Button type="submit" variant="primary" size="sm">Показать</Button>
        </form>
      </template>
    </Popover>
    <span v-if="covered && !custom" class="admin-range__covered">{{ covered }}</span>
  </div>
</template>
