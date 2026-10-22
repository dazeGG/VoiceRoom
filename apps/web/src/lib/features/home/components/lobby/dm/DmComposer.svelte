<script lang="ts">
  // The compose field of one thread. It is mounted per thread, so the unsent
  // text it brings back and stores belongs to that thread alone.
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import { ArrowUp } from '@lucide/svelte';
  import { iconSm } from '$lib/shared/ui/icons';
  import type { DirectMessage } from '$lib/api/dm';
  import { getAppRealtime } from '$lib/api/realtime';
  import { useLobby } from '$lib/features/home/model/lobby-context';
  import AttachmentComposer from '$lib/shared/chat/AttachmentComposer.svelte';
  import AttachmentUploadControl from '$lib/shared/chat/AttachmentUploadControl.svelte';
  import type { AttachmentComposeStore } from '$lib/shared/chat/attachment-compose.svelte';
  import { ChatDraft } from '$lib/shared/chat/chat-draft.svelte';
  import { pasteImages, sendOrEditLast } from '$lib/shared/chat/composer-input';
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
    /** ArrowUp in an empty field; answers whether a message went into editing. */
    onEditLast: () => boolean;
    onJump: (messageId: string) => void;
  } = $props();

  const lobby = useLobby();

  let input = $state<ComposerHandle | null>(null);
  // The thread is fixed for this component's life.
  const conversation = { type: 'dm' as const, id: untrack(() => peerId) };
  const draft = new ChatDraft(conversation);
  untrack(() => draft.restore(selfId));

  const typingNotifier = createTypingNotifier((activity) => {
    getAppRealtime().send('dm.typing', { userId: conversation.id, activity });
  });

  export function focus(): void {
    input?.focus();
  }

  // Typing and picked emoji both arrive as input, so this is every edit.
  function onInput(): void {
    if (draft.text.trim()) typingNotifier.notify();
    draft.schedule();
  }

  onMount(() => {
    void tick().then(focus);
    window.addEventListener('pagehide', draft.persist);
    return () => window.removeEventListener('pagehide', draft.persist);
  });

  onDestroy(() => {
    draft.persist();
    typingNotifier.reset();
  });

  // The field empties at once and stays writable: the message joins the
  // thread's outbox, which shows it until the server has it, so the next one
  // can be written and sent while the previous is still on its way.
  async function submit(): Promise<void> {
    const text = draft.text.trim();
    if (!text && !media?.canSend) return;
    // Images still uploading would be left behind.
    if (media?.drafts.length && !media.canSend) return;
    lobby.outboxFor(conversation.id).enqueue({
      text,
      attachmentIds: media?.readyIds ?? [],
      replyTo: replyTarget ? { messageId: replyTarget.id } : undefined
    });
    typingNotifier.reset();
    draft.clear();
    // The uploaded images now belong to the message; the field starts afresh.
    media?.clearBound();
    replyTarget = null;
    await tick();
    focus();
  }

  function onKeydown(event: KeyboardEvent): void {
    sendOrEditLast(event, { empty: !draft.text.trim(), send: () => void submit(), editLast: onEditLast });
  }

  const onPaste = (event: ClipboardEvent): Promise<void> =>
    pasteImages(media, event, (message) => pushToast(message, { variant: 'error' }));

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
    {#if media}<AttachmentComposer store={media} />{/if}
    <div class="attachment-compose-controls">
      {#if media}<AttachmentUploadControl
          store={media}
          onerror={(message: string) => pushToast(message, { variant: 'error' })}
        />{/if}
      <EmojiComposer
        class="lobby-dm-input lobby-dm-textarea"
        placeholder="Написать сообщение…"
        bind:this={input}
        bind:value={draft.text}
        onkeydown={onKeydown}
        oninput={onInput}
      />
      <ComposerEmojiPicker userId={selfId} onpick={insertEmoji} onbrowse={() => typingNotifier.notify('emoji')} />
      <button
        class="lobby-dm-send"
        type="submit"
        aria-label="Отправить"
        title="Отправить"
        disabled={!(draft.text.trim() || media?.canSend)}
        onclick={() => void submit()}
      >
        <ArrowUp {...iconSm} aria-hidden="true" />
      </button>
    </div>
  </div>
  <TypingIndicator label={typingLabel} />
</div>

<style>
  :global(.lobby-dm-send) {
    display: grid;
    flex: none;
    place-items: center;
    width: 34px;
    height: 34px;
    margin: 6px 6px 6px 0;
    border: 0;
    border-radius: 10px;
    background: var(--vr-accent);
    color: var(--vr-accent-ink);
    cursor: pointer;
    transition: background 0.15s ease;
  }
  :global(.lobby-dm-send:hover:not(:disabled)) {
    background: var(--vr-accent-hover);
  }
  :global(.lobby-dm-send:disabled) {
    background: var(--vr-surface-3);
    color: var(--vr-text-3);
    cursor: default;
  }
  :global(.lobby-dm-compose) {
    position: relative;
    flex: none;
    padding: 14px 24px 20px;
    --chat-typing-inset: 26px;
  }
</style>
