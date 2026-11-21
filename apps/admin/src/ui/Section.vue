<script setup lang="ts">
import { ChevronDown } from '@lucide/vue';
import { Button } from '@voice-room/ui/components';
import { useId, useTemplateRef } from 'vue';
import { useSectionState } from './use-section-state.ts';

const props = withDefaults(defineProps<{ page: string; id: string; title: string; defaultOpen?: boolean }>(), {
  defaultOpen: true
});
const model = defineModel<boolean | undefined>('open', { default: undefined });
const { open, setOpen } = useSectionState(props.page, props.id, props.defaultOpen);
const uid = useId();
const section = useTemplateRef('section');
defineExpose({ section });

function toggle(): void {
  const next = !(model.value ?? open.value);
  setOpen(next);
  model.value = next;
}
</script>

<template>
  <section ref="section" class="admin-section" :aria-labelledby="uid + '-heading'">
    <header class="admin-section__header">
      <h2 :id="uid + '-heading'" class="admin-section__title">
        <Button size="sm" :aria-expanded="model ?? open" :aria-controls="uid + '-body'" @click="toggle">
          <template #icon><ChevronDown class="admin-section__chevron" aria-hidden="true" /></template>
          {{ title }}
        </Button>
      </h2>
      <slot name="summary" />
      <div v-if="$slots.link" class="admin-section__link"><slot name="link" /></div>
    </header>
    <div :id="uid + '-body'" class="admin-section__body" :hidden="!(model ?? open)"><slot /></div>
  </section>
</template>
