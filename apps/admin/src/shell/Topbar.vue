<script setup lang="ts">
import { ChevronRight } from '@lucide/vue';
import type { RefreshStatus } from '../frame.ts';
import Freshness from './Freshness.vue';

defineProps<{ crumb: string; title: string; refresh: RefreshStatus | null; still?: string | null }>();
</script>

<template>
  <header class="admin-topbar">
    <div class="admin-topbar__location">
      <span class="admin-topbar__crumb">{{ crumb }}</span>
      <ChevronRight class="admin-topbar__chevron" aria-hidden="true" />
      <h1 class="admin-topbar__title">{{ title }}</h1>
    </div>
    <slot />
    <Freshness v-if="refresh" :status="refresh" />
    <span v-else class="admin-topbar__still">{{ still }}</span>
  </header>
</template>
