<script setup lang="ts">
import { CircleAlert, Info, Sparkles, TriangleAlert, X } from '@lucide/vue';
import { t } from '../../i18n';
import IconButton from '../IconButton/IconButton.vue';
import type { CalloutProps } from './types';

withDefaults(defineProps<CalloutProps>(), { tone: 'info', titleAs: 'p' });
const emit = defineEmits<{ dismiss: [] }>();

const icons = { info: Info, warning: TriangleAlert, danger: CircleAlert, accent: Sparkles };
</script>

<template>
  <div :class="['ui-callout', `ui-callout--${tone}`, { 'ui-callout--pill': layout === 'pill' }]">
    <span v-if="layout === 'pill'" class="ui-callout__dot" aria-hidden="true" />
    <span v-else class="ui-callout__icon" aria-hidden="true">
      <slot name="icon"><component :is="icons[tone]" /></slot>
    </span>
    <div class="ui-callout__body">
      <component :is="titleAs" class="ui-callout__title">{{ title }}</component>
      <p v-if="text" class="ui-callout__text">{{ text }}</p>
      <slot />
      <div v-if="$slots.actions" class="ui-callout__actions"><slot name="actions" /></div>
    </div>
    <IconButton v-if="dismissible" :label="t('Закрыть')" :size="28" :tooltip="false" @click="emit('dismiss')">
      <X aria-hidden="true" />
    </IconButton>
  </div>
</template>
