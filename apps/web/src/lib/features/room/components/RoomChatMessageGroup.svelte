<script lang="ts">
  // One author's run of messages in the room chat: the avatar and name (which
  // open the author's profile), then each message with its reply quote,
  // content, previews, attachments, reactions and hover actions, or its editor.
  import type { ChatMessage } from '$lib/api/rooms';
  import { session } from '$lib/features/auth/session.svelte';
  import EmojiText from '$lib/shared/chat/EmojiText.svelte';
  import ChatText from '$lib/shared/components/ChatText.svelte';
  import { Avatar } from '$lib/shared/ui';
  import MessageEditor from '$lib/shared/chat/MessageEditor.svelte';
  import MessageHoverActions from '$lib/shared/chat/MessageHoverActions.svelte';
  import ReactionSummary from '$lib/shared/chat/ReactionSummary.svelte';
  import type { createReactionStore } from '$lib/shared/chat/reaction-store.svelte';
  import AttachmentMosaic from '$lib/shared/chat/AttachmentMosaic.svelte';
  import ReplyPreview from '$lib/shared/chat/ReplyPreview.svelte';
  import LinkPreviewCard from '$lib/shared/chat/LinkPreviewCard.svelte';
  import StructuredMessageContent from '$lib/shared/chat/StructuredMessageContent.svelte';
  import { mentionsUser, type ChatGroup } from '../room-chat-view';

  let {
    group,
    canOpenProfile,
    editingMessageId,
    menuMessageId,
    reactions,
    onOpenProfile,
    onAuthorMenu,
    onMessageMenu,
    onSaveEdit,
    onCloseEdit,
    onJump,
    onMention,
    onReply,
    onCopy
  }: {
    group: ChatGroup;
    canOpenProfile: boolean;
    editingMessageId: string;
    menuMessageId: string;
    reactions: ReturnType<typeof createReactionStore>;
    onOpenProfile: (event: MouseEvent) => void;
    onAuthorMenu: (event: MouseEvent) => void;
    onMessageMenu: (message: ChatMessage, event: MouseEvent) => void;
    onSaveEdit: (messageId: string, text: string) => Promise<void>;
    onCloseEdit: () => void;
    onJump: (messageId: string) => void;
    onMention: (userId: string, label: string, event: MouseEvent) => void;
    onReply: (message: ChatMessage) => void;
    onCopy: (message: ChatMessage) => void;
  } = $props();

  const profileLabel = $derived(group.self ? 'Ваш профиль' : `Профиль ${group.name}`);

  function formatTime(createdAt: number): string {
    return new Date(createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
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
        size={34}
      />
    </button>
  {:else}
    <Avatar
      class="chat-msg-avatar"
      name={group.name}
      src={group.avatarUrl}
      background={group.avatarBackground}
      size={34}
    />
  {/if}
  <div class="chat-msg-main">
    <div class="chat-msg-meta">
      {#if canOpenProfile}
        <button
          class="chat-msg-author chat-msg-trigger"
          type="button"
          style={`color:${group.avatarBackground}`}
          aria-haspopup="dialog"
          aria-label={profileLabel}
          onclick={onOpenProfile}
          oncontextmenu={onAuthorMenu}><EmojiText text={group.name} /></button
        >
      {:else}
        <span class="chat-msg-author" style={`color:${group.avatarBackground}`}><EmojiText text={group.name} /></span>
      {/if}
      <time class="chat-msg-time" datetime={new Date(group.messages[0].createdAt).toISOString()}
        >{formatTime(group.createdAt)}</time
      >
    </div>
    {#each group.messages as message (message.id)}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="chat-msg-text"
        class:is-context={menuMessageId === message.id}
        class:mentions-me={mentionsUser(message, session.user?.id)}
        data-message-id={message.id}
        data-group-first={message.id === group.messages[0].id}
        oncontextmenu={(event) => onMessageMenu(message, event)}
      >
        {#if editingMessageId === message.id}
          <MessageEditor
            text={message.text}
            variant="chat-msg"
            maxlength={500}
            onSave={(text: string) => onSaveEdit(message.id, text)}
            onClose={onCloseEdit}
          />
        {:else}
          <div class="chat-msg-body">
            {#if message.replyPreview}<ReplyPreview preview={message.replyPreview} interactive onjump={onJump} />{/if}
            <span class="chat-msg-content"
              >{#if message.content}<StructuredMessageContent
                  content={message.content}
                  fallback={message.text}
                  onmention={onMention}
                />{:else}<ChatText text={message.text} />{/if}{#if message.editedAt}<span class="chat-msg-edited"
                  >(изменено)</span
                >{/if}</span
            >
            {#if message.linkPreview}<LinkPreviewCard preview={message.linkPreview} />{/if}
            {#if message.attachments?.length}<AttachmentMosaic attachments={message.attachments} />{/if}
            <ReactionSummary store={reactions} messageId={message.id} canMutate={Boolean(session.user?.id)} />
          </div>
          <MessageHoverActions
            reactionStore={session.user?.id ? reactions : undefined}
            messageId={message.id}
            userId={session.user?.id}
            onReply={() => onReply(message)}
            onCopy={() => onCopy(message)}
            onMore={(event: MouseEvent) => onMessageMenu(message, event)}
          />
        {/if}
      </div>
    {/each}
  </div>
</div>
