<script setup lang="ts">
import { Card } from '@voiceroom/ui-kit/components';
import { useId } from 'vue';

defineProps<{ title?: string; flush?: boolean }>();
const id = useId();
</script>

<template>
  <Card
    as="section"
    class="admin-panel"
    :class="{ 'admin-panel--flush': flush }"
    :aria-labelledby="title ? id : undefined"
  >
    <header v-if="title || $slots.aside" class="admin-panel__header">
      <h3 v-if="title" :id="id" class="admin-panel__title">{{ title }}</h3>
      <slot name="aside" />
    </header>
    <slot />
  </Card>
</template>
