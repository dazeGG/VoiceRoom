<script setup lang="ts">
import { TabsContent } from 'reka-ui';

import { useTemplateRef } from 'vue';
import type { TabPanelProps } from './types';

defineProps<TabPanelProps>();
const panel = useTemplateRef<HTMLElement>('panel');
defineExpose({ panel });
</script>

<template>
  <div v-if="value === undefined" ref="panel" class="ui-tabs__panel" role="tabpanel">
    <slot />
  </div>
  <TabsContent v-else class="ui-tabs__panel" :value="value">
    <slot />
  </TabsContent>
</template>
