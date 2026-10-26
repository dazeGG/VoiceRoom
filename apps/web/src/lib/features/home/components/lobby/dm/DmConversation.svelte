<script lang="ts">
  // One open thread: its messages and its compose field. The DM view mounts it
  // per peer, so opening another thread starts from a clean slate — no editing,
  // reply or menu carried over, the thread's own draft and reactions loaded.
  import EmojiText from '$lib/shared/chat/EmojiText.svelte';
  import { onMount, untrack } from 'svelte';
  import type { AuthUser } from '$lib/api/auth';
  import type { DirectMessage } from '$lib/api/dm';
  import type { PublicUser } from '$lib/api/friends';
  import { getAppRealtime } from '$lib/api/realtime';
  import { useLobby } from '$lib/features/home/model/lobby-context';
  import type { AttachmentComposeStore } from '$lib/shared/chat/attachment-compose.svelte';
  import MessageBubble from '$lib/shared/chat/MessageBubble.svelte';
  import MessageContextMenu from '$lib/shared/chat/MessageContextMenu.svelte';
  import { MessageMenuState } from '$lib/shared/chat/message-menu-state.svelte';
  import ReportMessageDialog from '$lib/shared/chat/ReportMessageDialog.svelte';
  import { createReactionStore } from '$lib/shared/chat/reaction-store.svelte';
  import { formatTypingLabel } from '$lib/shared/chat/typing.svelte';
  import ChatText from '$lib/shared/components/ChatText.svelte';
  import type { ProfileCardPerson } from '$lib/shared/components/profile-card';
  import type { PresenceStatus } from '$lib/shared/presence';
  import { AccountBadge, Avatar } from '$lib/shared/ui';
  import { downloadAttachment } from '$lib/shared/chat/attachment-actions';
  import { ChatScroll, copyMessageImage, copyMessageText } from '$lib/shared/chat/chat-scroll.svelte';
  import { openProfileCardFor } from '../../../../../entities/profile-card/profile-card-ui.svelte';
  import { clockTime } from '$lib/shared/utils/date-format';
  import { displayNameOf } from '$lib/shared/utils/display-name';
  import { formatChatDayLabel, isSameDay } from '$lib/shared/utils/chat-date';
  import { pushToast } from '../../../model/toasts.svelte';
  import DmComposer from './DmComposer.svelte';
  import DmInviteCard from './DmInviteCard.svelte';
  import OutgoingMessages from '$lib/shared/chat/OutgoingMessages.svelte';
  import type { OutgoingDirectMessage } from '$lib/features/home/model/lobby.svelte';

  let {
    peerId,
    self,
    peer,
    presence,
    media,
    quickReactions
  }: {
    peerId: string;
    self: AuthUser;
    peer: PublicUser | null;
    presence: PresenceStatus;
    media: AttachmentComposeStore | null;
    quickReactions: string[];
  } = $props();

  const lobby = useLobby();
  // The view is mounted per peer, like the reaction store below.
  const outbox = lobby.outboxFor(untrack(() => peerId));
  const selfId = $derived(self.id);
  const selfName = $derived(displayNameOf(self));
  const peerName = $derived(peer ? displayNameOf(peer) : '');

  const scroll = new ChatScroll();
  let inviteResponding = $state('');

  const reactions = createReactionStore();
  reactions.setConversation({ type: 'dm', id: untrack(() => peerId) });

  const peerTypingActivity = $derived(peer ? lobby.dmTyping.activityOf(peer.id) : null);
  const typingLabel = $derived(
    peer && peerTypingActivity ? formatTypingLabel([{ name: peerName, activity: peerTypingActivity }]) : ''
  );

  interface Group {
    key: string;
    fromMe: boolean;
    dayLabel: string | null;
    bubbles: [DirectMessage, ...DirectMessage[]];
  }

  // Group consecutive messages by sender, inserting a day separator when the
  // calendar day changes.
  const groups = $derived.by<Group[]>(() => {
    const result: Group[] = [];
    let prev: DirectMessage | null = null;
    for (const message of lobby.thread.messages) {
      const fromMe = message.senderId === selfId;
      const newDay = !prev || !isSameDay(prev.createdAt, message.createdAt);
      const lastGroup = result.at(-1);
      if (lastGroup && prev && !newDay && prev.senderId === message.senderId) {
        lastGroup.bubbles.push(message);
      } else {
        result.push({
          key: message.id,
          fromMe,
          dayLabel: newDay ? formatChatDayLabel(message.createdAt) : null,
          bubbles: [message]
        });
      }
      prev = message;
    }
    return result;
  });

  onMount(() =>
    getAppRealtime().subscribe((event) => {
      if (event.type !== 'reaction.updated' || event.payload.conversation.type !== 'dm') return;
      if (event.payload.conversation.id !== peerId) return;
      reactions.applyServer(event.payload.messageId, event.payload.summary);
    })
  );

  // Read receipts follow the conversation on screen: unmounting stops them.
  $effect(() => {
    const id = peerId;
    return untrack(() => lobby.thread.attachReader(id));
  });

  // Invitations carry no reactions.
  const menu = new MessageMenuState<DirectMessage>({
    reactions,
    messages: () => lobby.thread.messages.filter((message) => !message.invite)
  });

  // A new attachment grows the composer; a reader at the bottom stays there.
  $effect(() => scroll.followComposer(media?.drafts.length ?? 0));

  // Prepending older history keeps the same newest id, so it must not trigger
  // this latest-message autoscroll and disturb the preserved anchor.
  // A message just sent shows at the foot of the thread: the view goes there.
  let outgoingCount = 0;
  $effect(() => {
    const count = outbox.items.length;
    const grew = count > outgoingCount;
    outgoingCount = count;
    if (!grew) return;
    void scroll.settle();
  });

  let lastAutoScrolledMessage: string | null = null;
  $effect(() => {
    const newestId = lobby.thread.messages.at(-1)?.id ?? '';
    if (newestId === lastAutoScrolledMessage) return;
    lastAutoScrolledMessage = newestId;
    void scroll.settle();
  });

  const loadOlder = (element: HTMLElement): void => void lobby.loadOlderThread(element);

  function jumpToMessage(messageId: string): void {
    scroll.jumpTo(messageId, () => pushToast('Сообщение не загружено — прокрутите историю выше'));
  }

  function openProfile(event: MouseEvent, fromMe: boolean): void {
    const person: ProfileCardPerson | null = fromMe
      ? {
          userId: selfId,
          name: selfName,
          login: self.login,
          avatarUrl: self.avatarUrl,
          avatarColorKey: self.avatarColorKey,
          avatarAccent: self.avatarAccent,
          presence: 'online'
        }
      : peer && {
          userId: peer.id,
          name: peerName,
          login: peer.login,
          avatarUrl: peer.avatarUrl,
          avatarColorKey: peer.avatarColorKey,
          avatarAccent: peer.avatarAccent,
          presence
        };
    if (!person) return;
    event.preventDefault();
    event.stopPropagation();
    openProfileCardFor(person, event.currentTarget);
  }

  function editLastOwnMessage(): boolean {
    return menu.editLast(lobby.thread.messages.findLast((message) => message.senderId === selfId && !message.invite));
  }

  async function deleteMessage(messageId: string): Promise<void> {
    try {
      await lobby.deleteMessage(messageId);
      reactions.markDeleted(messageId);
      pushToast('Сообщение удалено');
    } catch (cause) {
      pushToast(cause instanceof Error && cause.message ? cause.message : 'Не удалось удалить сообщение', {
        variant: 'error'
      });
    }
  }

  // Invitations are interactive cards with their own buttons; a context menu on
  // top of them would offer actions that do not apply.
  function openMessageMenu(message: DirectMessage, event: MouseEvent): void {
    if (!message.invite) menu.open(message, event);
  }

  async function respondToInvite(message: DirectMessage, action: 'accept' | 'decline'): Promise<void> {
    if (inviteResponding) return;
    inviteResponding = message.id;
    try {
      await lobby.respondRoomInvitation(message, action);
    } catch {
      pushToast('Не удалось ответить на приглашение');
    } finally {
      inviteResponding = '';
    }
  }
</script>

{#snippet authorAvatar(fromMe: boolean)}
  <button
    class="chat-avatar-button chat-msg-trigger"
    type="button"
    aria-haspopup="dialog"
    aria-label={fromMe ? 'Ваш профиль' : `Профиль ${peerName}`}
    onclick={(event) => openProfile(event, fromMe)}
  >
    <Avatar
      class="chat-msg-avatar"
      name={fromMe ? selfName : peerName}
      src={fromMe ? self.avatarUrl : peer?.avatarUrl}
      colorKey={fromMe ? self.avatarColorKey : peer?.avatarColorKey}
      background={(fromMe ? self.avatarAccent : peer?.avatarAccent) || undefined}
      size={32}
    />
  </button>
{/snippet}

<div class="lobby-dm-scroll lobby-scroll" {@attach scroll.body} onscroll={() => scroll.onScroll(loadOlder)}>
  {#if lobby.thread.loading}
    <div class="lobby-dm-loading" role="status">Загружаем переписку…</div>
  {/if}
  {#if lobby.thread.historyError && groups.length === 0}
    <div class="lobby-dm-empty">{lobby.thread.historyError}</div>
  {:else if groups.length === 0 && !lobby.thread.loading && !outbox.items.length}
    <div class="lobby-dm-empty">Здесь пока пусто. Напишите первым!</div>
  {:else}
    <div class="lobby-dm-thread" {@attach scroll.keepsNewestInView}>
      {#if lobby.thread.historyError}
        <div class="lobby-dm-empty">{lobby.thread.historyError}</div>
      {/if}
      {#if lobby.thread.loadingOlder || lobby.thread.hasMoreBefore}
        <button
          type="button"
          class="lobby-dm-empty"
          disabled={lobby.thread.loadingOlder}
          onclick={() => void lobby.loadOlderThread(scroll.element)}
        >
          {lobby.thread.loadingOlder ? 'Загружаем…' : 'Показать предыдущие'}
        </button>
      {/if}
      {#each groups as group (group.key)}
        {#if group.dayLabel}
          <div class="chat-day-divider"><span>{group.dayLabel}</span></div>
        {/if}
        <div class="chat-msg dm-chat-group" data-self={group.fromMe}>
          {@render authorAvatar(group.fromMe)}
          <div class="chat-msg-main">
            <div class="chat-msg-meta">
              <button
                class="chat-msg-author chat-msg-trigger"
                type="button"
                aria-haspopup="dialog"
                aria-label={group.fromMe ? 'Ваш профиль' : `Профиль ${peerName}`}
                onclick={(event) => openProfile(event, group.fromMe)}
                ><EmojiText text={group.fromMe ? selfName : peerName} /><AccountBadge
                  userId={group.fromMe ? selfId : peerId}
                /></button
              >
              <time class="chat-msg-time" datetime={new Date(group.bubbles[0].createdAt).toISOString()}
                >{clockTime(group.bubbles[0].createdAt)}</time
              >
            </div>
            {#each group.bubbles as bubble (bubble.id)}
              {#snippet inviteCard()}
                {#if bubble.invite}
                  <DmInviteCard
                    invite={bubble.invite}
                    fromMe={group.fromMe}
                    busy={inviteResponding === bubble.id}
                    onRespond={(action: 'accept' | 'decline') => void respondToInvite(bubble, action)}
                  />
                {/if}
              {/snippet}
              <MessageBubble
                message={bubble}
                text={bubble.body}
                variant="dm-msg"
                maxlength={2000}
                first={bubble.id === group.bubbles[0].id}
                editing={menu.editingId === bubble.id}
                menuOpen={menu.opened?.message.id === bubble.id}
                {reactions}
                userId={selfId}
                card={bubble.invite ? inviteCard : undefined}
                onMenu={(event: MouseEvent) => openMessageMenu(bubble, event)}
                onJump={jumpToMessage}
                onReply={() => menu.replyTo(bubble)}
                onCopy={() => void copyMessageText(bubble.body, pushToast)}
                onSaveEdit={async (text: string) => {
                  await lobby.editMessage(bubble.id, text);
                }}
                onCloseEdit={() => menu.stopEditing()}
              >
                {#snippet content()}
                  {#if bubble.body.trim()}<span class="chat-msg-content dm-msg-content"
                      ><ChatText text={bubble.body} />{#if bubble.editedAt}<span class="dm-msg-edited">(изменено)</span
                        >{/if}</span
                    >{/if}
                {/snippet}
              </MessageBubble>
            {/each}
          </div>
        </div>
      {/each}
      <OutgoingMessages
        items={outbox.items}
        textOf={(outgoing: OutgoingDirectMessage) => outgoing.text}
        attachmentsOf={(outgoing: OutgoingDirectMessage) => outgoing.attachmentIds.length}
        onRetry={(localId: string) => outbox.retry(localId)}
        onDiscard={(localId: string) => outbox.discard(localId)}
      />
    </div>
  {/if}
</div>

<DmComposer
  bind:this={menu.composer}
  bind:replyTarget={menu.replyTarget}
  {peerId}
  {selfId}
  {peerName}
  {media}
  {typingLabel}
  onEditLast={editLastOwnMessage}
  onJump={jumpToMessage}
/>

{#if menu.opened}
  {@const target = menu.opened.message}
  {@const image = menu.opened.image}
  {@const fromMe = target.senderId === selfId}
  <MessageContextMenu
    open
    x={menu.opened.x}
    y={menu.opened.y}
    {quickReactions}
    activeReactions={menu.activeReactions}
    canReact={Boolean(selfId)}
    canEdit={fromMe}
    canDelete={fromMe}
    onClose={() => menu.close()}
    onReact={(emoji: string) => void reactions.toggle(target.id, emoji)}
    onOpenReactionPicker={() => scroll.openReactionPicker(target.id)}
    onReply={() => menu.replyTo(target)}
    onCopy={() => void copyMessageText(target.body, pushToast)}
    onCopyImage={image ? () => void copyMessageImage(image, pushToast) : undefined}
    onDownloadImage={image ? () => downloadAttachment(image) : undefined}
    onEdit={() => menu.edit(target.id)}
    onDelete={() => void deleteMessage(target.id)}
    onReport={fromMe ? undefined : () => menu.report(target.id)}
  />
{/if}

{#if menu.reportedId}
  <ReportMessageDialog
    target={{ kind: 'direct_message', messageId: menu.reportedId }}
    onClose={() => menu.closeReport()}
    onReported={(message: string) => pushToast(message)}
  />
{/if}

<style>
  :global(.lobby-dm-loading) {
    position: sticky;
    z-index: 2;
    top: 0;
    display: flex;
    height: 100%;
    min-height: 100%;
    align-items: center;
    justify-content: center;
    margin-bottom: -100%;
    background: var(--vr-bg, var(--vr-bg));
    color: var(--vr-text-3);
    font-size: 13.5px;
  }
  :global(.lobby-dm-thread) {
    margin-top: auto;
    display: flex;
    flex-direction: column;
    gap: 15px;
    padding: 22px 24px;
  }
  :global(.dm-msg-edited) {
    margin-left: 5px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--vr-text-3);
    white-space: nowrap;
  }
  :global(.lobby-dm-empty) {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--vr-text-3);
    font-size: 13.5px;
  }
</style>
