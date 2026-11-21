<script setup lang="ts">
import { Inbox } from '@lucide/vue';
import type { EmptyStateProps } from './types';

defineProps<EmptyStateProps>();
</script>

<template>
  <div class="ui-empty" :class="{ 'ui-empty--compact': compact }">
    <span class="ui-empty__icon" aria-hidden="true"
      ><slot name="icon"><Inbox /></slot
    ></span>
    <p class="ui-empty__title">{{ title }}</p>
    <p v-if="text" class="ui-empty__text">{{ text }}</p>
    <div v-if="!compact && $slots.action" class="ui-empty__action"><slot name="action" /></div>
  </div>
</template>
