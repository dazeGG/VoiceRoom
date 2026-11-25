<script setup lang="ts">
import { CircleAlert, Clock, Info, Sparkles, TriangleAlert, X } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import { t } from '../../i18n';
import { formatCallClock, useCallClock } from '../call-clock';
import IconButton from '../IconButton/IconButton.vue';
import type { CalloutProps } from './types';

const props = withDefaults(defineProps<CalloutProps>(), { tone: 'info', titleAs: 'p' });
const emit = defineEmits<{ dismiss: [] }>();

const icons = { info: Info, warning: TriangleAlert, danger: CircleAlert, accent: Sparkles };
const deadline = computed(() => (props.layout === 'countdown' ? props.deadline : undefined));
const remaining = useCallClock(() => deadline.value, 'until');
const seconds = computed(() => Math.ceil(remaining.value / 1000));
const currentTone = computed(() => {
  if (deadline.value === undefined) return props.tone;
  return seconds.value > 60 ? 'warning' : 'danger';
});

const countdownMessage = 'Вы одни в звонке. Отключим через {time}';
const clockToken = '{time}';
const clockParts = computed(() => t(countdownMessage).split(clockToken));
const announcement = ref('');
const milestones = [10, 60, 240];
const announced = new Set<number>();

watch([deadline, seconds], ([target, current], [previousTarget, previous]) => {
  if (target !== previousTarget) {
    announcement.value = '';
    announced.clear();
    return;
  }
  if (current === 0) return;
  const milestone = milestones.find((value) => previous > value && current <= value && !announced.has(value));
  if (milestone === undefined) return;
  announced.add(milestone);
  announcement.value = t(countdownMessage, { time: formatCallClock(milestone) });
});
</script>

<template>
  <div :class="['ui-callout', `ui-callout--${currentTone}`, layout && `ui-callout--${layout}`]">
    <span v-if="layout === 'pill'" class="ui-callout__dot" aria-hidden="true" />
    <span v-else class="ui-callout__icon" aria-hidden="true">
      <slot name="icon"><component :is="deadline === undefined ? icons[currentTone] : Clock" /></slot>
    </span>
    <div class="ui-callout__body">
      <component :is="titleAs" v-if="title" class="ui-callout__title">{{ title }}</component>
      <component
        :is="title ? 'p' : titleAs"
        v-if="deadline !== undefined"
        :class="title ? 'ui-callout__text' : 'ui-callout__title'"
      >
        <span role="timer" aria-live="off"
          >{{ clockParts[0] }}<span class="ui-callout__clock">{{ formatCallClock(seconds) }}</span
          >{{ clockParts[1] }}</span
        >
      </component>
      <p v-if="text" class="ui-callout__text">{{ text }}</p>
      <slot />
      <div v-if="$slots.actions && deadline === undefined" class="ui-callout__actions"><slot name="actions" /></div>
    </div>
    <div v-if="$slots.actions && deadline !== undefined" class="ui-callout__actions"><slot name="actions" /></div>
    <span v-if="deadline !== undefined" class="ui-callout__announcement" role="status" aria-atomic="true">{{
      announcement
    }}</span>
    <IconButton v-if="dismissible" :label="t('Закрыть')" :size="28" :tooltip="false" @click="emit('dismiss')">
      <X aria-hidden="true" />
    </IconButton>
  </div>
</template>
