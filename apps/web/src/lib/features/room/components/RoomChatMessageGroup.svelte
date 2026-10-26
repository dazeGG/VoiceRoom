<script lang="ts">
  // One author's run of messages in the room chat: the avatar and name (which
  // open the author's profile), then each message as a MessageBubble.
  import type { ChatMessage } from '$lib/api/rooms';
  import { session } from '$lib/features/auth/session.svelte';
  import EmojiText from '$lib/shared/chat/EmojiText.svelte';
  import ChatText from '$lib/shared/components/ChatText.svelte';
  import { AccountBadge, Avatar } from '$lib/shared/ui';
  import MessageBubble from '$lib/shared/chat/MessageBubble.svelte';
  import type { MessageMenuState } from '$lib/shared/chat/message-menu-state.svelte';
  import type { ReactionStore } from '$lib/shared/chat/reaction-store.svelte';
  import StructuredMessageContent from '$lib/shared/chat/StructuredMessageContent.svelte';
  import { clockTime } from '$lib/shared/utils/date-format';
  import { mentionsUser, type ChatGroup } from '../room-chat-view';

  let {
    group,
    canOpenProfile,
    menu,
    reactions,
    onOpenProfile,
    onAuthorMenu,
    onSaveEdit,
    onJump,
    onMention,
    onCopy
  }: {
    group: ChatGroup;
    canOpenProfile: boolean;
    menu: MessageMenuState<ChatMessage>;
    reactions: ReactionStore;
    onOpenProfile: (event: MouseEvent) => void;
    onAuthorMenu: (event: MouseEvent) => void;
    onSaveEdit: (messageId: string, text: string) => Promise<void>;
    onJump: (messageId: string) => void;
    onMention: (userId: string, label: string, event: MouseEvent) => void;
    onCopy: (message: ChatMessage) => void;
  } = $props();

  const profileLabel = $derived(group.self ? 'Ваш профиль' : `Профиль ${group.name}`);
</script>

<div class="chat-msg" data-self={group.self}>
  {#if canOpenProfile}
    <button
      class="chat-avatar-button chat-msg-trigger"
      type="button"
      aria-haspopup="dialog"
      aria-label={profileLabel}
      title={profileLabel}
      onclick={onOpenProfile}
      oncontextmenu={onAuthorMenu}
    >
      <Avatar
        class="chat-msg-avatar"
        name={group.name}
        src={group.avatarUrl}
        background={group.avatarBackground}
        foreground={group.avatarForeground}
        size={32}
      />
    </button>
  {:else}
    <Avatar
      class="chat-msg-avatar"
      name={group.name}
      src={group.avatarUrl}
      background={group.avatarBackground}
      foreground={group.avatarForeground}
      size={32}
    />
  {/if}
  <div class="chat-msg-main">
    <div class="chat-msg-meta">
      {#if canOpenProfile}
        <button
          class="chat-msg-author chat-msg-trigger"
          type="button"
          aria-haspopup="dialog"
          aria-label={profileLabel}
          onclick={onOpenProfile}
          oncontextmenu={onAuthorMenu}
          ><EmojiText text={group.name} /><AccountBadge userId={group.authorUserId} /></button
        >
      {:else}
        <span class="chat-msg-author"><EmojiText text={group.name} /><AccountBadge userId={group.authorUserId} /></span>
      {/if}
      <time class="chat-msg-time" datetime={new Date(group.messages[0].createdAt).toISOString()}
        >{clockTime(group.createdAt)}</time
      >
    </div>
    {#each group.messages as message (message.id)}
      <MessageBubble
        {message}
        text={message.text}
        variant="chat-msg"
        maxlength={500}
        first={message.id === group.messages[0].id}
        editing={menu.editingId === message.id}
        menuOpen={menu.opened?.message.id === message.id}
        mentionsMe={mentionsUser(message, session.user?.id)}
        {reactions}
        userId={session.user?.id}
        onMenu={(event: MouseEvent) => menu.open(message, event)}
        {onJump}
        onReply={() => menu.replyTo(message)}
        onCopy={() => onCopy(message)}
        onSaveEdit={(text: string) => onSaveEdit(message.id, text)}
        onCloseEdit={() => menu.stopEditing()}
      >
        {#snippet content()}
          <span class="chat-msg-content"
            >{#if message.content}<StructuredMessageContent
                content={message.content}
                fallback={message.text}
                onmention={onMention}
              />{:else}<ChatText text={message.text} />{/if}{#if message.editedAt}<span class="chat-msg-edited"
                >(изменено)</span
              >{/if}</span
          >
        {/snippet}
      </MessageBubble>
    {/each}
  </div>
</div>
