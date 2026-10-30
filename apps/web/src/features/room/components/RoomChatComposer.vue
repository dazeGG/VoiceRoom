<script setup lang="ts">
// The room chat's compose form: text with @mentions, emoji, attachments and a
// reply target. Sending itself belongs to the panel, which owns the messages.
import { onBeforeUnmount, onMounted, ref, nextTick } from 'vue';
import { ArrowUp } from '@lucide/vue';
import type { MembershipMember } from '@voice-room/shared/contracts/membership';
import { contentFromPlainText } from '@voice-room/shared/room-message-content';
import type { ChatMessage } from '@/api/rooms';
import { getAppRealtime } from '@/api/realtime';
import { useRoomMembershipStore } from '@/entities/room/room-membership.store';
import { useSessionStore } from '@/features/auth/session.store';
import AttachmentComposer from '@/shared/chat/AttachmentComposer.vue';
import AttachmentUploadControl from '@/shared/chat/AttachmentUploadControl.vue';
import type { AttachmentComposeStore } from '@/shared/chat/attachment-compose';
import type { ChatDraft } from '@/shared/chat/use-chat-draft';
import { pasteImages, sendOrEditLast } from '@/shared/chat/composer-input';
import type { ComposerHandle } from '@/shared/chat/composer-handle';
import ComposerEmojiPicker from '@/shared/chat/ComposerEmojiPicker.vue';
import EmojiComposer from '@/shared/chat/EmojiComposer.vue';
import MentionAutocomplete from '@/shared/chat/MentionAutocomplete.vue';
import ReplyTargetBar from '@/shared/chat/ReplyTargetBar.vue';
import TypingIndicator from '@/shared/chat/TypingIndicator.vue';
import { createTypingNotifier } from '@/shared/chat/typing';
import { iconSm } from '@/shared/ui/icons';
import type { OutgoingRoomMessage } from '../use-room-chat-session';

const props = defineProps<{
  roomId: string;
  draft: ChatDraft;
  media: AttachmentComposeStore | null;
  /** Mentions are offered and sent as structured content. */
  typingLabel: string;
  /** ArrowUp in an empty field; answers whether a message went into editing. */
  onEditLast: () => boolean;
}>();

const emit = defineEmits<{
  /** Puts the message on its way; the panel shows it until the server has it. */
  send: [message: OutgoingRoomMessage];
  jump: [messageId: string];
  toast: [message: string, options?: { variant?: 'error' }];
}>();

const replyTarget = defineModel<ChatMessage | null>('replyTarget', { default: null });

const session = useSessionStore();
const membership = useRoomMembershipStore();
const input = ref<ComposerHandle | null>(null);
const { text, mentions } = props.draft;

const typingNotifier = createTypingNotifier((activity) => {
  if (props.roomId) getAppRealtime().send('room.chat.typing', { roomId: props.roomId, activity });
});

function focus(): void {
  input.value?.focus();
}

defineExpose({ focus });

onMounted(() => window.addEventListener('pagehide', props.draft.persist));
onBeforeUnmount(() => {
  window.removeEventListener('pagehide', props.draft.persist);
  props.draft.persist();
});

async function updateMentionCandidates(): Promise<void> {
  const selfId = session.user?.id;
  if (!selfId || !input.value) {
    mentions.close();
    return;
  }
  const caret = input.value.getSelection().start;
  const query = mentions.update(text.value, caret);
  if (!query && !text.value.slice(0, caret).endsWith('@')) return;
  await membership.loadRoomMembership(props.roomId, { query });
  if (mentions.query !== query) return;
  mentions.setCandidates(
    membership.getRoomMembership(props.roomId).members.filter((member) => member.userId !== selfId)
  );
}

function chooseMention(member: MembershipMember): void {
  if (!input.value) return;
  const selected = mentions.choose(text.value, input.value.getSelection().start, member);
  if (!selected) return;
  text.value = selected.text;
  props.draft.schedule();
  void nextTick().then(() => {
    input.value?.focus();
    input.value?.setSelection(selected.caret);
  });
}

// Typing, a pasted or picked emoji (both arrive as input) all come through here.
function onInput(): void {
  void updateMentionCandidates();
  if (text.value.trim()) typingNotifier.notify();
  props.draft.schedule();
}

// The field empties at once and stays writable: the message joins the
// panel's outbox, which shows it in the chat until the server has it, so the
// next one can be written and sent while the previous is still on its way.
async function submit(event?: SubmitEvent): Promise<void> {
  event?.preventDefault();
  if (!props.roomId) return;
  // Do not collapse whitespace; newlines are intentional.
  const message = text.value.trim();
  const withMedia = Boolean(props.media?.canSend);
  if (!message && !withMedia) return;
  // Images still uploading would be left behind.
  if (props.media?.drafts.length && !props.media.canSend) return;

  emit('send', {
    text: message,
    content: mentions.selected.length ? mentions.toContent(message) : (contentFromPlainText(message) ?? undefined),
    attachmentIds: withMedia ? (props.media?.readyIds ?? []) : [],
    replyTo: replyTarget.value ? { messageId: replyTarget.value.id } : undefined
  });
  props.draft.clear();
  replyTarget.value = null;
  // The uploaded images now belong to the message; the field starts afresh.
  if (withMedia) props.media?.clearBound();
  typingNotifier.reset();
  await nextTick();
  focus();
}

function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing) return;
  if (mentions.isOpen) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      mentions.move(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      const member = mentions.candidates[mentions.activeIndex];
      if (member) chooseMention(member);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      mentions.close();
      return;
    }
  }
  sendOrEditLast(event, { empty: !text.value.trim(), send: () => void submit(), editLast: props.onEditLast });
}

const onPaste = (event: ClipboardEvent): Promise<void> =>
  pasteImages(props.media, event, (message) => emit('toast', message, { variant: 'error' }));
</script>

<template>
  <form class="room-chat-composer" @submit="submit" @paste="onPaste">
    <div class="room-chat-composer__row attachment-compose">
      <ReplyTargetBar
        v-if="replyTarget"
        :target="{
          messageId: replyTarget.id,
          deleted: false,
          author: { id: replyTarget.authorUserId || replyTarget.peerId, name: replyTarget.name },
          text: replyTarget.text
        }"
        :on-jump="(messageId: string) => emit('jump', messageId)"
        @cancel="replyTarget = null"
      />
      <AttachmentComposer v-if="media" :store="media" />
      <div class="attachment-compose__controls">
        <AttachmentUploadControl
          v-if="media"
          :store="media"
          @error="(message: string) => emit('toast', message, { variant: 'error' })"
        />
        <EmojiComposer
          ref="input"
          v-model="text"
          class="room-chat-composer__input"
          :maxlength="500"
          placeholder="Написать в комнату…"
          @keydown="onKeydown"
          @input="onInput"
          @compositionstart="mentions.setComposing(true)"
          @compositionend="
            mentions.setComposing(false);
            void updateMentionCandidates();
          "
        />
        <ComposerEmojiPicker
          :user-id="session.user?.id ?? ''"
          @pick="(emoji: string) => input?.insertText(emoji)"
          @browse="typingNotifier.notify('emoji')"
        />
        <button
          class="room-chat-composer__send"
          type="submit"
          aria-label="Отправить"
          title="Отправить"
          :disabled="!(text.trim() || media?.canSend)"
        >
          <ArrowUp v-bind="iconSm" aria-hidden="true" />
        </button>
      </div>
    </div>
    <MentionAutocomplete
      v-if="mentions.isOpen"
      :candidates="mentions.candidates"
      :active-index="mentions.activeIndex"
      @select="chooseMention"
    />
    <TypingIndicator :label="typingLabel" />
  </form>
</template>
