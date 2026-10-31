<script setup lang="ts">
// One message of a chat thread: the row that takes the context menu, and in
// it the reply quote, attachments, text, link preview, reactions and hover
// actions, or the editor while the message is being edited. Shared by the
// room and direct chats; `variant` picks the surrounding chat's class names
// and part order (a direct message shows its pictures above its text), the
// `content` slot renders the text, and `card` replaces every part for a
// message that is a card of its own (a direct-message invitation).
import { computed } from 'vue';
import type { Attachment } from '@voice-room/shared/contracts/messages';
import type { LinkPreview } from '@voice-room/shared/link-preview';
import AttachmentMosaic from './AttachmentMosaic.vue';
import LinkPreviewCard from './LinkPreviewCard.vue';
import MessageEditor from './MessageEditor.vue';
import MessageHoverActions from './MessageHoverActions.vue';
import ReactionSummary from './ReactionSummary.vue';
import type { ReactionStore } from './reaction-store';
import ReplyPreview from './ReplyPreview.vue';
import type { ReplyTarget } from './reply-store';

const props = withDefaults(
  defineProps<{
    message: {
      id: string;
      replyPreview?: ReplyTarget | undefined;
      attachments?: Attachment[] | undefined;
      linkPreview?: LinkPreview | undefined;
    };
    /** The plain text the editor starts from. */
    text: string;
    variant: 'chat-msg' | 'dm-msg';
    /** The longest text the editor accepts. */
    maxlength: number;
    /** The first message of its author's run. */
    first: boolean;
    editing: boolean;
    /** The context menu is open on this message. */
    menuOpen: boolean;
    mentionsMe?: boolean;
    reactions: ReactionStore;
    /** The viewer; without one the reactions are shown but cannot be changed. */
    userId: string | undefined;
    /** Saves the edited text; rejects when the server refuses, and the editor stays open. */
    onSaveEdit: (text: string) => Promise<void>;
  }>(),
  { mentionsMe: false }
);

const emit = defineEmits<{
  menu: [event: MouseEvent];
  jump: [messageId: string];
  reply: [];
  copy: [];
  closeEdit: [];
}>();

defineSlots<{
  content(): unknown;
  card?(): unknown;
}>();

const dm = computed(() => props.variant === 'dm-msg');
</script>

<template>
  <div
    class="message-bubble"
    :class="{
      'message-bubble--dm': dm,
      'message-bubble--first': first,
      'message-bubble--context': menuOpen,
      'message-bubble--mentions-me': mentionsMe
    }"
    :data-message-id="message.id"
    @contextmenu="emit('menu', $event)"
  >
    <slot v-if="$slots.card" name="card" />
    <MessageEditor
      v-else-if="editing"
      :text="text"
      :variant="variant"
      :maxlength="maxlength"
      :on-save="onSaveEdit"
      @close="emit('closeEdit')"
    />
    <template v-else>
      <div class="message-bubble__body" :class="{ 'message-bubble__body--dm': dm }">
        <ReplyPreview
          v-if="message.replyPreview"
          :preview="message.replyPreview"
          interactive
          @jump="(messageId: string) => emit('jump', messageId)"
        />
        <AttachmentMosaic v-if="dm && message.attachments?.length" :attachments="message.attachments" />
        <slot name="content" />
        <LinkPreviewCard v-if="message.linkPreview" :preview="message.linkPreview" />
        <AttachmentMosaic v-if="!dm && message.attachments?.length" :attachments="message.attachments" />
        <ReactionSummary :store="reactions" :message-id="message.id" :can-mutate="Boolean(userId)" />
      </div>
      <MessageHoverActions
        :reaction-store="userId ? reactions : undefined"
        :message-id="message.id"
        :user-id="userId"
        :on-reply="() => emit('reply')"
        @copy="emit('copy')"
        @more="(event: MouseEvent) => emit('menu', event)"
      />
    </template>
  </div>
</template>
