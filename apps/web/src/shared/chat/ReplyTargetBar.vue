<script setup lang="ts">
// The composer row that shows which message the draft answers. It renders
// inside the bordered composer field, directly above the text row and on the
// same footing as pending image attachments, so the draft reads as one input
// rather than a stray card floating above it. The quote is a jump target, and
// cancelling is an icon so the row reads as part of the composer instead of a
// form with a stray text button.
import { X } from '@lucide/vue';
import ReplyPreview from './ReplyPreview.vue';
import type { ReplyTarget } from './reply-store';

const props = withDefaults(
  defineProps<{
    target: ReplyTarget;
    onJump?: ((messageId: string) => void) | undefined;
  }>(),
  { onJump: undefined }
);

const emit = defineEmits<{ cancel: [] }>();
</script>

<template>
  <div class="reply-target">
    <span class="reply-target__label">В ответ</span>
    <ReplyPreview
      :preview="target"
      :interactive="Boolean(props.onJump) && !target.deleted"
      @jump="props.onJump?.($event)"
    />
    <button
      class="reply-target__cancel"
      type="button"
      aria-label="Отменить ответ"
      title="Отменить ответ"
      @click="emit('cancel')"
    >
      <X :size="16" aria-hidden="true" />
    </button>
  </div>
</template>
