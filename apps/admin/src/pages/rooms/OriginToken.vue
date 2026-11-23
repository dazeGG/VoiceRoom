<script setup lang="ts">
import { Button } from '../../ui';
import { toggledFilter, type CallOriginFilters, type OriginPick } from './call-filters.ts';

defineProps<{
  label: string;
  value: string;
  short: string;
  field: keyof CallOriginFilters;
  pick?: OriginPick | undefined;
  shared?: boolean;
}>();
</script>

<template>
  <Button
    v-if="pick"
    size="sm"
    variant="soft"
    class="admin-origin__token"
    :class="{ 'admin-origin__token--shared': shared && pick.filters[field] !== value }"
    :aria-pressed="pick.filters[field] === value"
    :title="`${label} ${value}${shared ? ' · тот же IP у другого участника' : ''}`"
    @click.stop="pick.onChange(toggledFilter(pick.filters, field, value))"
    >{{ short }}</Button
  >
  <span
    v-else
    class="admin-origin__token admin-origin__token--static"
    :class="{ 'admin-origin__token--shared': shared }"
    :title="`${label} ${value}`"
    >{{ short }}</span
  >
</template>
