<script lang="ts">
  // One message of a chat thread: the row that takes the context menu, and in
  // it the reply quote, attachments, text, link preview, reactions and hover
  // actions, or the editor while the message is being edited. Shared by the
  // room and direct chats; `variant` picks the surrounding chat's class names
  // and part order (a direct message shows its pictures above its text), the
  // `content` snippet renders the text, and `card` replaces every part for a
  // message that is a card of its own (a direct-message invitation).
  import type { Snippet } from 'svelte';
  import type { Attachment } from '@voice-room/shared/contracts/messages';
  import type { LinkPreview } from '@voice-room/shared/link-preview';
  import AttachmentMosaic from './AttachmentMosaic.svelte';
  import LinkPreviewCard from './LinkPreviewCard.svelte';
  import MessageEditor from './MessageEditor.svelte';
  import MessageHoverActions from './MessageHoverActions.svelte';
  import ReactionSummary from './ReactionSummary.svelte';
  import type { ReactionStore } from './reaction-store.svelte';
  import ReplyPreview from './ReplyPreview.svelte';
  import type { ReplyTarget } from './reply-store.svelte';

  let {
    message,
    text,
    variant,
    maxlength,
    first,
    editing,
    menuOpen,
    mentionsMe = false,
    reactions,
    userId,
    content,
    card,
    onMenu,
    onJump,
    onReply,
    onCopy,
    onSaveEdit,
    onCloseEdit
  }: {
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
    content: Snippet;
    card?: Snippet | undefined;
    onMenu: (event: MouseEvent) => void;
    onJump: (messageId: string) => void;
    onReply: () => void;
    onCopy: () => void;
    onSaveEdit: (text: string) => Promise<void>;
    onCloseEdit: () => void;
  } = $props();

  const dm = $derived(variant === 'dm-msg');
</script>

{#snippet attachments()}
  {#if message.attachments?.length}<AttachmentMosaic attachments={message.attachments} />{/if}
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class={['chat-msg-text', { 'dm-chat-message': dm, 'is-context': menuOpen, 'mentions-me': mentionsMe }]}
  data-message-id={message.id}
  data-group-first={first}
  oncontextmenu={onMenu}
>
  {#if card}
    {@render card()}
  {:else if editing}
    <MessageEditor {text} {variant} {maxlength} onSave={onSaveEdit} onClose={onCloseEdit} />
  {:else}
    <div class={dm ? 'dm-chat-content' : 'chat-msg-body'}>
      {#if message.replyPreview}<ReplyPreview preview={message.replyPreview} interactive onjump={onJump} />{/if}
      {#if dm}{@render attachments()}{/if}
      {@render content()}
      {#if message.linkPreview}<LinkPreviewCard preview={message.linkPreview} />{/if}
      {#if !dm}{@render attachments()}{/if}
      <ReactionSummary store={reactions} messageId={message.id} canMutate={Boolean(userId)} />
    </div>
    <MessageHoverActions
      reactionStore={userId ? reactions : undefined}
      messageId={message.id}
      {userId}
      {onReply}
      {onCopy}
      onMore={onMenu}
    />
  {/if}
</div>
