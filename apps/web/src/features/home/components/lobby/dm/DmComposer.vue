<script setup lang="ts">
// The compose field of one thread. It is mounted per thread, so the unsent
// text it brings back and stores belongs to that thread alone.
import { ArrowUp } from '@lucide/vue';
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import type { DirectMessage } from '@/api/dm';
import { getAppRealtime } from '@/api/realtime';
import AttachmentComposer from '@/shared/chat/AttachmentComposer.vue';
import AttachmentUploadControl from '@/shared/chat/AttachmentUploadControl.vue';
import type { AttachmentComposeStore } from '@/shared/chat/attachment-compose';
import type { ComposerHandle } from '@/shared/chat/composer-handle';
import { pasteImages, sendOrEditLast } from '@/shared/chat/composer-input';
import ComposerEmojiPicker from '@/shared/chat/ComposerEmojiPicker.vue';
import EmojiComposer from '@/shared/chat/EmojiComposer.vue';
import ReplyTargetBar from '@/shared/chat/ReplyTargetBar.vue';
import TypingIndicator from '@/shared/chat/TypingIndicator.vue';
import { createTypingNotifier } from '@/shared/chat/typing';
import { useChatDraft } from '@/shared/chat/use-chat-draft';
import { iconSm } from '@/shared/ui/icons';
import { useLobby } from '../../../model/lobby-context';
import { useToastsStore } from '../../../model/toasts.store';

const { peerId, selfId, peerName, media, typingLabel, onEditLast } = defineProps<{
  peerId: string;
  selfId: string;
  peerName: string;
  media: AttachmentComposeStore | null;
  /** Who is typing on the other side, if anyone. */
  typingLabel: string;
  /** ArrowUp in an empty field; answers whether a message went into editing. */
  onEditLast: () => boolean;
}>();

const emit = defineEmits<{ jump: [messageId: string] }>();

const replyTarget = defineModel<DirectMessage | null>('replyTarget', { default: null });

const lobby = useLobby();
const { pushToast } = useToastsStore();

const input = ref<ComposerHandle | null>(null);
// The thread is fixed for this component's life.
const conversation = { type: 'dm' as const, id: peerId };
const draft = useChatDraft(conversation);
draft.restore(selfId);
const draftText = draft.text;

const typingNotifier = createTypingNotifier((activity) => {
  getAppRealtime().send('dm.typing', { userId: conversation.id, activity });
});

function focus(): void {
  input.value?.focus();
}

defineExpose({ focus });

// Typing and picked emoji both arrive as input, so this is every edit.
function onInput(): void {
  if (draftText.value.trim()) typingNotifier.notify();
  draft.schedule();
}

onMounted(() => {
  void nextTick().then(focus);
  window.addEventListener('pagehide', draft.persist);
});

onBeforeUnmount(() => {
  window.removeEventListener('pagehide', draft.persist);
  draft.persist();
  typingNotifier.reset();
});

// The field empties at once and stays writable: the message joins the
// thread's outbox, which shows it until the server has it, so the next one
// can be written and sent while the previous is still on its way.
async function submit(): Promise<void> {
  const text = draftText.value.trim();
  if (!text && !media?.canSend) return;
  // Images still uploading would be left behind.
  if (media?.drafts.length && !media.canSend) return;
  lobby.outboxFor(conversation.id).enqueue({
    text,
    attachmentIds: media?.readyIds ?? [],
    replyTo: replyTarget.value ? { messageId: replyTarget.value.id } : undefined
  });
  typingNotifier.reset();
  draft.clear();
  // The uploaded images now belong to the message; the field starts afresh.
  media?.clearBound();
  replyTarget.value = null;
  await nextTick();
  focus();
}

function onKeydown(event: KeyboardEvent): void {
  sendOrEditLast(event, { empty: !draftText.value.trim(), send: () => void submit(), editLast: onEditLast });
}

const onPaste = (event: ClipboardEvent): Promise<void> =>
  pasteImages(media, event, (message) => pushToast(message, { variant: 'error' }));

// The field remembers its caret while the picker has focus, so the emoji
// lands where the person was writing, and the field takes focus back and
// reports the input as if it were typed.
function insertEmoji(emoji: string): void {
  input.value?.insertText(emoji);
}
</script>

<template>
  <div class="dm-composer" @paste="onPaste">
    <div class="dm-composer__row attachment-compose">
      <ReplyTargetBar
        v-if="replyTarget"
        :target="{
          messageId: replyTarget.id,
          deleted: false,
          author: { id: replyTarget.senderId, name: replyTarget.senderId === selfId ? 'Вы' : peerName },
          text: replyTarget.body
        }"
        :on-jump="(messageId: string) => emit('jump', messageId)"
        @cancel="replyTarget = null"
      />
      <AttachmentComposer v-if="media" :store="media" />
      <div class="attachment-compose__controls">
        <AttachmentUploadControl
          v-if="media"
          :store="media"
          @error="(message: string) => pushToast(message, { variant: 'error' })"
        />
        <EmojiComposer
          ref="input"
          v-model="draftText"
          class="dm-composer__input"
          placeholder="Написать сообщение…"
          @keydown="onKeydown"
          @input="onInput"
        />
        <ComposerEmojiPicker :user-id="selfId" @pick="insertEmoji" @browse="typingNotifier.notify('emoji')" />
        <button
          class="dm-composer__send"
          type="submit"
          aria-label="Отправить"
          title="Отправить"
          :disabled="!(draftText.trim() || media?.canSend)"
          @click="void submit()"
        >
          <ArrowUp v-bind="iconSm" aria-hidden="true" />
        </button>
      </div>
    </div>
    <TypingIndicator :label="typingLabel" />
  </div>
</template>
