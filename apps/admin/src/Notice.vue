<script setup lang="ts">
import { Button, Callout } from '@voiceroom/ui-kit/components';
import type { LoadFailure } from './load-failure.ts';

defineProps<{ failure: LoadFailure }>();
const emit = defineEmits<{ retry: [] }>();
</script>

<template>
  <Callout v-if="failure.kind === 'forbidden'" title="Этот раздел недоступен вашей роли." />
  <Callout v-else :title="failure.message" tone="danger" role="alert">
    <template #actions>
      <Button size="sm" variant="outline" @click="emit('retry')">Повторить</Button>
    </template>
  </Callout>
</template>
