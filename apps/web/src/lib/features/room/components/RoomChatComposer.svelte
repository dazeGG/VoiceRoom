<script lang="ts">
  // The room chat's compose form: text with @mentions, emoji, attachments and a
  // reply target. Sending itself belongs to the panel, which owns the messages.
  import { onDestroy, onMount, tick } from 'svelte';
  import type { MembershipMember } from '@voice-room/shared/membership';
  import { contentFromPlainText } from '@voice-room/shared/room-message-content';
  import type { ChatMessage } from '$lib/api/rooms';
  import { getAppRealtime } from '$lib/api/realtime';
  import { getRoomMembership, loadRoomMembership } from '$lib/entities/room/room-membership.svelte';
  import { session } from '$lib/features/auth/session.svelte';
  import AttachmentComposer from '$lib/shared/chat/AttachmentComposer.svelte';
  import AttachmentUploadControl from '$lib/shared/chat/AttachmentUploadControl.svelte';
  import { imageFilesFromClipboard, type AttachmentComposeStore } from '$lib/shared/chat/attachment-compose.svelte';
  import type { ComposerHandle } from '$lib/shared/chat/composer-handle';
  import ComposerEmojiPicker from '$lib/shared/chat/ComposerEmojiPicker.svelte';
  import EmojiComposer from '$lib/shared/chat/EmojiComposer.svelte';
  import MentionAutocomplete from '$lib/shared/chat/MentionAutocomplete.svelte';
  import ReplyTargetBar from '$lib/shared/chat/ReplyTargetBar.svelte';
  import TypingIndicator from '$lib/shared/chat/TypingIndicator.svelte';
  import { createTypingNotifier } from '$lib/shared/chat/typing.svelte';
  import type { OutgoingRoomMessage, RoomChatDraft } from '../room-chat-draft.svelte';

  let {
    roomId,
    draft,
    media,
    typingLabel,
    replyTarget = $bindable(null),
    sending = $bindable(false),
    send,
    onEditLast,
    onJump,
    onToast
  }: {
    roomId: string;
    draft: RoomChatDraft;
    media: AttachmentComposeStore | null;
    /** Mentions are offered and sent as structured content. */
    typingLabel: string;
    replyTarget?: ChatMessage | null;
    sending?: boolean;
    /** Posts the message; answers whether it went out. */
    send: (message: OutgoingRoomMessage) => Promise<boolean>;
    /** ArrowUp in an empty field; answers whether a message went into editing. */
    onEditLast: () => boolean;
    onJump: (messageId: string) => void;
    onToast: (message: string, options?: { variant?: 'error' }) => void;
  } = $props();

  let input = $state<ComposerHandle | null>(null);
  const mentions = $derived(draft.mentions);

  const typingNotifier = createTypingNotifier((activity) => {
    if (roomId) getAppRealtime().send('room.chat.typing', { roomId, activity });
  });

  export function focus(): void {
    input?.focus();
  }

  onMount(() => {
    window.addEventListener('pagehide', draft.persist);
    return () => window.removeEventListener('pagehide', draft.persist);
  });
  onDestroy(() => draft.persist());

  async function updateMentionCandidates(): Promise<void> {
    const selfId = session.user?.id;
    if (!selfId || !input) {
      mentions.close();
      return;
    }
    const caret = input.getSelection().start;
    const query = mentions.update(draft.text, caret);
    if (!query && !draft.text.slice(0, caret).endsWith('@')) return;
    await loadRoomMembership(roomId, { query });
    if (mentions.query !== query) return;
    mentions.setCandidates(getRoomMembership(roomId).members.filter((member) => member.userId !== selfId));
  }

  function chooseMention(member: MembershipMember): void {
    if (!input) return;
    const selected = mentions.choose(draft.text, input.getSelection().start, member);
    if (!selected) return;
    draft.text = selected.text;
    draft.schedule();
    void tick().then(() => {
      input?.focus();
      input?.setSelection(selected.caret);
    });
  }

  // Typing, a pasted or picked emoji (both arrive as input) all come through here.
  function onInput(): void {
    void updateMentionCandidates();
    if (draft.text.trim()) typingNotifier.notify();
    draft.schedule();
  }

  async function submit(event?: SubmitEvent): Promise<void> {
    event?.preventDefault();
    if (!roomId || sending) return;
    // Do not collapse whitespace; newlines are intentional.
    const text = draft.text.trim();
    if (!text && !media?.canSend) return;
    if (media?.drafts.length && !media.canSend) return;

    sending = true;
    let sent: boolean;
    try {
      sent = await send({
        text,
        content: mentions.selected.length ? mentions.toContent(text) : (contentFromPlainText(text) ?? undefined),
        attachmentIds: media?.readyIds ?? [],
        replyTo: replyTarget ? { messageId: replyTarget.id } : undefined
      });
    } finally {
      sending = false;
    }
    if (!sent) return;
    draft.clear();
    media?.clearBound();
    replyTarget = null;
    typingNotifier.reset();
    await tick();
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
        chooseMention(mentions.candidates[mentions.activeIndex]);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        mentions.close();
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
      return;
    }
    // ArrowUp in an empty composer edits the last own message, like Discord.
    if (event.key === 'ArrowUp' && !draft.text.trim() && onEditLast()) event.preventDefault();
  }

  async function onPaste(event: ClipboardEvent): Promise<void> {
    if (!media) return;
    const files = imageFilesFromClipboard(event);
    if (!files.length) return;
    event.preventDefault();
    try {
      await media.addFiles(files);
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : 'Не удалось вставить изображение', { variant: 'error' });
    }
  }
</script>

<form class="chat-rail-compose" onsubmit={submit} onpaste={onPaste}>
  <div class="chat-compose-row attachment-compose-field">
    {#if replyTarget}
      {@const target = replyTarget}
      <ReplyTargetBar
        target={{
          messageId: target.id,
          deleted: false,
          author: { id: target.authorUserId || target.peerId, name: target.name },
          text: target.text
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
          onerror={(message: string) => onToast(message, { variant: 'error' })}
        />{/if}
      <EmojiComposer
        class="chat-rail-input chat-rail-textarea"
        bind:this={input}
        bind:value={draft.text}
        maxlength={500}
        placeholder="Написать в комнату…"
        onkeydown={onKeydown}
        oninput={onInput}
        oncompositionstart={() => mentions.setComposing(true)}
        oncompositionend={() => {
          mentions.setComposing(false);
          void updateMentionCandidates();
        }}
        disabled={sending}
      />
      <ComposerEmojiPicker
        userId={session.user?.id ?? ''}
        disabled={sending}
        onpick={(emoji: string) => input?.insertText(emoji)}
        onbrowse={() => typingNotifier.notify('emoji')}
      />
    </div>
  </div>
  {#if mentions.isOpen}
    <MentionAutocomplete candidates={mentions.candidates} activeIndex={mentions.activeIndex} onselect={chooseMention} />
  {/if}
  <TypingIndicator label={typingLabel} />
</form>
