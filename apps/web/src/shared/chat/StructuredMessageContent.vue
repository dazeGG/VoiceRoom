<script setup lang="ts">
// A mention names a person, so it behaves like one: given a handler it is a
// button that opens that person's card, the same card their avatar or name in
// the message header opens. Without a handler — a preview, a quoted reply —
// it stays plain text rather than offering an action that leads nowhere.
// Text segments find their links the way plain chat text does: a message is
// sent as one text segment, so a typed link is only found here.
import type { RoomMessageContentV1 } from '@voice-room/shared/room-message-content';
import ChatText from '@/shared/components/ChatText.vue';

withDefaults(
  defineProps<{
    content?: RoomMessageContentV1 | null | undefined;
    fallback?: string;
    /** Given, a mention is a button; without it the mention is plain text. */
    onmention?: ((userId: string, label: string, event: MouseEvent) => void) | undefined;
  }>(),
  { content: undefined, fallback: '', onmention: undefined }
);

function mentionLabel(label: string): string {
  return label.startsWith('@') ? label : `@${label}`;
}
</script>

<template>
  <span v-if="content?.version === 1 && Array.isArray(content.segments)" class="structured-message"
    ><template v-for="(segment, i) in content.segments" :key="i"
      ><ChatText v-if="segment.type === 'text'" :text="segment.text" /><a
        v-else-if="segment.type === 'link'"
        :href="segment.href"
        target="_blank"
        rel="noopener noreferrer external"
        >{{ segment.label }}</a
      ><template v-else-if="segment.type === 'mention'"
        ><button
          v-if="onmention && segment.userId"
          class="structured-message__mention structured-message__mention--button"
          type="button"
          :data-user-id="segment.userId"
          :aria-label="`Открыть профиль ${mentionLabel(segment.label)}`"
          @click="onmention?.(segment.userId, segment.label, $event)"
        >
          {{ mentionLabel(segment.label) }}</button
        ><span v-else class="structured-message__mention" :data-user-id="segment.userId">{{
          mentionLabel(segment.label)
        }}</span></template
      ></template
    ></span
  >
  <span v-else><ChatText :text="fallback" /></span>
</template>
