<script lang="ts">
  // The compose field of one thread. It is mounted per thread, so the unsent
  // text it brings back and stores belongs to that thread alone.
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import type { DirectMessage } from '$lib/api/dm';
  import { getAppRealtime } from '$lib/api/realtime';
  import { useLobby } from '$lib/features/home/model/lobby-context';
  import AttachmentComposer from '$lib/shared/chat/AttachmentComposer.svelte';
  import AttachmentUploadControl from '$lib/shared/chat/AttachmentUploadControl.svelte';
  import { imageFilesFromClipboard, type AttachmentComposeStore } from '$lib/shared/chat/attachment-compose.svelte';
  import { loadChatDraft, saveChatDraft } from '$lib/shared/chat/chat-drafts';
  import { SendAttempt } from '$lib/shared/chat/send-attempt';
  import ComposerEmojiPicker from '$lib/shared/chat/ComposerEmojiPicker.svelte';
  import type { ComposerHandle } from '$lib/shared/chat/composer-handle';
  import EmojiComposer from '$lib/shared/chat/EmojiComposer.svelte';
  import ReplyTargetBar from '$lib/shared/chat/ReplyTargetBar.svelte';
  import TypingIndicator from '$lib/shared/chat/TypingIndicator.svelte';
  import { createTypingNotifier } from '$lib/shared/chat/typing.svelte';
  import { pushToast } from '../../../model/toasts.svelte';

  let {
    peerId,
    selfId,
    peerName,
    media,
    typingLabel,
    replyTarget = $bindable(null),
    sending = $bindable(false),
    onEditLast,
    onJump
  }: {
    peerId: string;
    selfId: string;
    peerName: string;
    media: AttachmentComposeStore | null;
    /** Who is typing on the other side, if anyone. */
    typingLabel: string;
    replyTarget?: DirectMessage | null;
    sending?: boolean;
    /** ArrowUp in an empty field; answers whether a message went into editing. */
    onEditLast: () => boolean;
    onJump: (messageId: string) => void;
  } = $props();

  const lobby = useLobby();
  const DRAFT_SAVE_DELAY_MS = 400;

  let input = $state<ComposerHandle | null>(null);
  // The thread is fixed for this component's life.
  const conversation = { type: 'dm' as const, id: untrack(() => peerId) };
  let draft = $state(untrack(() => loadChatDraft(selfId, conversation)?.text ?? ''));
  let draftSaveTimer: ReturnType<typeof setTimeout> | null = null;
  const sendAttempt = new SendAttempt();

  const typingNotifier = createTypingNotifier((activity) => {
    getAppRealtime().send('dm.typing', { userId: conversation.id, activity });
  });

  export function focus(): void {
    input?.focus();
  }

  function persistDraft(): void {
    if (draftSaveTimer) {
      clearTimeout(draftSaveTimer);
      draftSaveTimer = null;
    }
    saveChatDraft(selfId, conversation, { text: draft });
  }

  // Typing and picked emoji both arrive as input, so this is every edit.
  function onInput(): void {
    if (draft.trim()) typingNotifier.notify();
    if (draftSaveTimer) clearTimeout(draftSaveTimer);
    draftSaveTimer = setTimeout(persistDraft, DRAFT_SAVE_DELAY_MS);
  }

  onMount(() => {
    void tick().then(focus);
    window.addEventListener('pagehide', persistDraft);
    return () => window.removeEventListener('pagehide', persistDraft);
  });

  onDestroy(() => {
    persistDraft();
    typingNotifier.reset();
  });

  async function submit(): Promise<void> {
    const text = draft.trim();
    if ((!text && !media?.canSend) || sending) return;
    if (media?.drafts.length && !media.canSend) return;
    sending = true;
    try {
      const attachmentIds = media?.readyIds ?? [];
      const replyTo = replyTarget ? { messageId: replyTarget.id } : undefined;
      await lobby.sendMessage(text, attachmentIds, replyTo, sendAttempt.keyFor({ text, attachmentIds, replyTo }));
    } catch {
      // Keep the draft intact so the message can be retried.
      return;
    } finally {
      sending = false;
    }
    typingNotifier.reset();
    // Stored at once: the thread may have been left while the message was on
    // its way, and then this field is gone but its saved text is not.
    draft = '';
    persistDraft();
    media?.clearBound();
    replyTarget = null;
    sendAttempt.reset();
    await tick();
    focus();
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.isComposing) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
      return;
    }
    // ArrowUp in an empty composer edits the last own message, like Discord.
    if (event.key === 'ArrowUp' && !draft.trim() && onEditLast()) event.preventDefault();
  }

  async function onPaste(event: ClipboardEvent): Promise<void> {
    if (!media) return;
    const files = imageFilesFromClipboard(event);
    if (!files.length) return;
    event.preventDefault();
    try {
      await media.addFiles(files);
    } catch (cause) {
      pushToast(cause instanceof Error ? cause.message : 'Не удалось вставить изображение', { variant: 'error' });
    }
  }

  // The field remembers its caret while the picker has focus, so the emoji
  // lands where the person was writing, and the field takes focus back and
  // reports the input as if it were typed.
  function insertEmoji(emoji: string): void {
    input?.insertText(emoji);
  }
</script>

<div class="lobby-dm-compose" onpaste={onPaste}>
  <div class="lobby-dm-compose-row attachment-compose-field">
    {#if replyTarget}
      {@const target = replyTarget}
      <ReplyTargetBar
        target={{
          messageId: target.id,
          deleted: false,
          author: { id: target.senderId, name: target.senderId === selfId ? 'Вы' : peerName },
          text: target.body
        }}
        onjump={onJump}
        oncancel={() => (replyTarget = null)}
      />
    {/if}
    {#if media}<AttachmentComposer store={media} disabled={sending} />{/if}
    <div class="attachment-compose-controls">
      {#if media}<AttachmentUploadControl
          store={media}
          disabled={sending}
          onerror={(message: string) => pushToast(message, { variant: 'error' })}
        />{/if}
      <EmojiComposer
        class="lobby-dm-input lobby-dm-textarea"
        placeholder="Написать сообщение…"
        bind:this={input}
        bind:value={draft}
        onkeydown={onKeydown}
        oninput={onInput}
        disabled={sending}
      />
      <ComposerEmojiPicker
        userId={selfId}
        disabled={sending}
        onpick={insertEmoji}
        onbrowse={() => typingNotifier.notify('emoji')}
      />
    </div>
  </div>
  <TypingIndicator label={typingLabel} />
</div>

<style>
  :global(.lobby-dm-compose) {
    position: relative;
    flex: none;
    padding: 14px 24px 20px;
    --chat-typing-inset: 26px;
  }
</style>
