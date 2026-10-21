<script lang="ts">
  // The room chat's compose form: text with @mentions, emoji, attachments and a
  // reply target. Sending itself belongs to the panel, which owns the messages.
  import { onDestroy, onMount, tick } from 'svelte';
  import { ArrowUp } from '@lucide/svelte';
  import { iconSm } from '$lib/shared/ui/icons';
  import type { MembershipMember } from '@voice-room/shared/contracts/membership';
  import { contentFromPlainText } from '@voice-room/shared/room-message-content';
  import type { ChatMessage } from '$lib/api/rooms';
  import { getAppRealtime } from '$lib/api/realtime';
  import { getRoomMembership, loadRoomMembership } from '$lib/entities/room/room-membership.svelte';
  import { session } from '$lib/features/auth/session.svelte';
  import AttachmentComposer from '$lib/shared/chat/AttachmentComposer.svelte';
  import AttachmentUploadControl from '$lib/shared/chat/AttachmentUploadControl.svelte';
  import type { AttachmentComposeStore } from '$lib/shared/chat/attachment-compose.svelte';
  import type { ChatDraft } from '$lib/shared/chat/chat-draft.svelte';
  import { pasteImages, sendOrEditLast } from '$lib/shared/chat/composer-input';
  import type { ComposerHandle } from '$lib/shared/chat/composer-handle';
  import ComposerEmojiPicker from '$lib/shared/chat/ComposerEmojiPicker.svelte';
  import EmojiComposer from '$lib/shared/chat/EmojiComposer.svelte';
  import MentionAutocomplete from '$lib/shared/chat/MentionAutocomplete.svelte';
  import ReplyTargetBar from '$lib/shared/chat/ReplyTargetBar.svelte';
  import TypingIndicator from '$lib/shared/chat/TypingIndicator.svelte';
  import { createTypingNotifier } from '$lib/shared/chat/typing.svelte';
  import type { OutgoingRoomMessage } from '../room-chat-session.svelte';

  let {
    roomId,
    draft,
    media,
    typingLabel,
    replyTarget = $bindable(null),
    send,
    onEditLast,
    onJump,
    onToast
  }: {
    roomId: string;
    draft: ChatDraft;
    media: AttachmentComposeStore | null;
    /** Mentions are offered and sent as structured content. */
    typingLabel: string;
    replyTarget?: ChatMessage | null;
    /** Puts the message on its way; the panel shows it until the server has it. */
    send: (message: OutgoingRoomMessage) => void;
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

  // The field empties at once and stays writable: the message joins the
  // panel's outbox, which shows it in the chat until the server has it, so the
  // next one can be written and sent while the previous is still on its way.
  async function submit(event?: SubmitEvent): Promise<void> {
    event?.preventDefault();
    if (!roomId) return;
    // Do not collapse whitespace; newlines are intentional.
    const text = draft.text.trim();
    const withMedia = Boolean(media?.canSend);
    if (!text && !withMedia) return;
    // Images still uploading would be left behind.
    if (media?.drafts.length && !media.canSend) return;

    send({
      text,
      content: mentions.selected.length ? mentions.toContent(text) : (contentFromPlainText(text) ?? undefined),
      attachmentIds: withMedia ? (media?.readyIds ?? []) : [],
      replyTo: replyTarget ? { messageId: replyTarget.id } : undefined
    });
    draft.clear();
    replyTarget = null;
    // The uploaded images now belong to the message; the field starts afresh.
    if (withMedia) media?.clearBound();
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
    sendOrEditLast(event, { empty: !draft.text.trim(), send: () => void submit(), editLast: onEditLast });
  }

  const onPaste = (event: ClipboardEvent): Promise<void> =>
    pasteImages(media, event, (message) => onToast(message, { variant: 'error' }));
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
    {#if media}<AttachmentComposer store={media} />{/if}
    <div class="attachment-compose-controls">
      {#if media}<AttachmentUploadControl
          store={media}
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
      />
      <ComposerEmojiPicker
        userId={session.user?.id ?? ''}
        onpick={(emoji: string) => input?.insertText(emoji)}
        onbrowse={() => typingNotifier.notify('emoji')}
      />
      <button
        class="chat-rail-send"
        type="submit"
        aria-label="Отправить"
        title="Отправить"
        disabled={!(draft.text.trim() || media?.canSend)}
      >
        <ArrowUp {...iconSm} aria-hidden="true" />
      </button>
    </div>
  </div>
  {#if mentions.isOpen}
    <MentionAutocomplete candidates={mentions.candidates} activeIndex={mentions.activeIndex} onselect={chooseMention} />
  {/if}
  <TypingIndicator label={typingLabel} />
</form>
