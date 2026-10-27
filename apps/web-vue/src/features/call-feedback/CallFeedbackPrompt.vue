<script setup lang="ts">
// "How was the call?" after leaving one, as its own window in the middle of
// the page: the end of a call, the same window the leave screen is. Hidden
// during a call, and while the leave screen is up, which asks the question
// itself. A click beside it closes it as the cross does; an answer leaves a
// short thanks.
import { computed, ref, watch } from 'vue';
import { Dialog } from '@/shared/ui/Dialog';
import CallFeedbackCard from './CallFeedbackCard.vue';
import { useCallFeedbackStore } from './call-feedback.store';

withDefaults(defineProps<{ hidden?: boolean }>(), { hidden: false });

const THANKS_MS = 2500;

const feedback = useCallFeedbackStore();

const thanked = ref(false);
const card = ref<InstanceType<typeof CallFeedbackCard> | null>(null);

const call = computed(() => feedback.call);

// Svelte: {#key call}. A new call mounts a new card with nothing chosen.
const callKey = ref(0);
watch(call, () => callKey.value++);

watch(thanked, (value, _before, onCleanup) => {
  if (!value) return;
  const timer = setTimeout(() => (thanked.value = false), THANKS_MS);
  onCleanup(() => clearTimeout(timer));
});

function close(): void {
  if (card.value) card.value.close();
  else thanked.value = false;
}
</script>

<template>
  <Dialog
    :open="!hidden && (call !== null || thanked)"
    :title="call ? 'Как прошёл звонок?' : 'Спасибо!'"
    :width="420"
    initial-focus=".call-feedback__thumb"
    :on-close="close"
  >
    <CallFeedbackCard v-if="call" :key="callKey" ref="card" :call="call" @answered="thanked = true" />
    <p v-else class="call-feedback__thanks" role="status">Спасибо! Это помогает делать звонки лучше.</p>
  </Dialog>
</template>
