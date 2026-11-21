<script setup lang="ts">
import { TabsContent } from 'reka-ui';

defineProps<{ value: string }>();
</script>

<template>
  <TabsContent class="ui-tabs__panel" :value="value">
    <slot />
  </TabsContent>
</template>
