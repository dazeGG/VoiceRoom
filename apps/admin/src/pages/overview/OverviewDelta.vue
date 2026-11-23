<script setup lang="ts">
import { ArrowDownRight, ArrowUpRight } from '@lucide/vue';
import { computed } from 'vue';

const props = defineProps<{ current: number; previous: number; unit: string }>();
const change = computed(() => Math.round((props.current - props.previous) * 10) / 10);
</script>

<template>
  <span class="admin-overview-delta" :class="{ 'admin-tone--success': change > 0, 'admin-tone--danger': change < 0 }">
    <ArrowUpRight v-if="change > 0" aria-hidden="true" />
    <ArrowDownRight v-else-if="change < 0" aria-hidden="true" />
    {{ change === 0 ? `без изменений ${unit}` : `${change > 0 ? '+' : ''}${change} ${unit}` }}
  </span>
</template>
