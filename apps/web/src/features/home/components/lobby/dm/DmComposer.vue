<script setup lang="ts">
import { Button, IconButton } from '@voiceroom/ui-kit/components';
// The compose field of one thread. It is mounted per thread, so the unsent
// text it brings back and stores belongs to that thread alone.
import { t } from '@/shared/i18n';
import { ArrowUp } from '@lucide/vue';
import { isOfficialAccount } from '@voiceroom/shared/official-account';
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
import { buildDiagnostics } from '@/features/support/diagnostics';
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
const official = isOfficialAccount({ id: peerId });
const buildSupportReport = (signal: AbortSignal) => buildDiagnostics(new Date(), signal);
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
  const text = draftText.value;
  if (!text.trim() && !media?.canSend) return;
  // Images still uploading would be left behind.
  if (media?.busy || (media?.drafts.length && !media.canSend)) return;
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
          author: { id: replyTarget.senderId, name: replyTarget.senderId === selfId ? t('Вы') : peerName },
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
          :build-diagnostics="official ? buildSupportReport : undefined"
          @error="(message: string) => pushToast(message, { variant: 'error' })"
        />
        <EmojiComposer
          ref="input"
          v-model="draftText"
          class="dm-composer__input"
          :maxlength="2000"
          markdown
          :placeholder="official ? t('Напишите, что улучшить или что работает не так…') : t('Написать сообщение…')"
          @keydown="onKeydown"
          @input="onInput"
        />
        <ComposerEmojiPicker :user-id="selfId" @pick="insertEmoji" @browse="typingNotifier.notify('emoji')" />
        <IconButton
          class="dm-composer__send"
          type="submit"
          :label="t('Отправить')"
          :disabled="media?.busy || !(draftText.trim() || media?.canSend)"
          :size="32"
          variant="primary"
          @click="void submit()"
        >
          <ArrowUp aria-hidden="true" />
        </IconButton>
      </div>
    </div>
    <TypingIndicator :label="typingLabel" />
    <p v-if="official" class="dm-composer__disclaimer">
      {{ t('VoiceRoom никогда не просит пароли и коды.') }}
      <Button
        variant="plain"
        size="inline"
        href="https://docs.voiceroom.ru/account/support/"
        target="_blank"
        rel="noreferrer"
      >
        {{ t('Подробнее') }}
      </Button>
    </p>
  </div>
</template>
