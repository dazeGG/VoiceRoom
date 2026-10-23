<script lang="ts">
  import type { Attachment } from '@voice-room/shared/contracts/messages';
  import MessageBubble from '../../../src/lib/shared/chat/MessageBubble.svelte';
  import type { ReactionStore } from '../../../src/lib/shared/chat/reaction-store.svelte';
  import type { ReplyTarget } from '../../../src/lib/shared/chat/reply-store.svelte';

  // Renders one bubble with its text as the content snippet and, when given,
  // a card in place of every part.
  let {
    message,
    variant,
    reactions,
    userId,
    editing = false,
    menuOpen = false,
    mentionsMe = false,
    cardText = '',
    onMenu,
    onReply,
    onCopy
  }: {
    message: { id: string; text: string; replyPreview?: ReplyTarget; attachments?: Attachment[] };
    variant: 'chat-msg' | 'dm-msg';
    reactions: ReactionStore;
    userId: string | undefined;
    editing?: boolean;
    menuOpen?: boolean;
    mentionsMe?: boolean;
    cardText?: string;
    onMenu: (event: MouseEvent) => void;
    onReply: () => void;
    onCopy: () => void;
  } = $props();
</script>

{#snippet card()}
  <p>{cardText}</p>
{/snippet}

<MessageBubble
  {message}
  text={message.text}
  {variant}
  maxlength={500}
  first
  {editing}
  {menuOpen}
  {mentionsMe}
  {reactions}
  {userId}
  card={cardText ? card : undefined}
  {onMenu}
  onJump={() => {}}
  {onReply}
  {onCopy}
  onSaveEdit={async () => {}}
  onCloseEdit={() => {}}
>
  {#snippet content()}
    <span class="chat-msg-content">{message.text}</span>
  {/snippet}
</MessageBubble>
