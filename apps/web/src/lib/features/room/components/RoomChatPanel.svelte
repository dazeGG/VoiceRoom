<script lang="ts">
  import type { Snippet } from 'svelte';
  import { getDesktopBoundaryPolicy } from '$lib/platform/desktop-boundary';
  import { onMount, untrack } from 'svelte';
  import type { ChatMessage } from '$lib/api/rooms';
  import { session } from '$lib/features/auth/session.svelte';
  import { downloadAttachment } from '$lib/shared/chat/attachment-actions';
  import { MessageMenuState } from '$lib/shared/chat/message-menu-state.svelte';
  import { copyMessageImage, copyMessageText } from '$lib/shared/chat/chat-scroll.svelte';
  import { applyRoomDeleted, applyRoomNotFound, applyRoomUpdated } from '../client/room/lifecycle';
  import { openProfileCardFor } from '$lib/entities/profile-card/profile-card-ui.svelte';
  import { getParticipantById } from '../client/room/participants';
  import { state as roomState } from '../client/core/state.svelte';
  import { mentionProfilePerson, participantProfilePerson, roomMessageProfilePerson } from '../profile-card-adapter';
  import { useRoomSocial } from '../social';
  import MessageContextMenu from '$lib/shared/chat/MessageContextMenu.svelte';
  import ReportMessageDialog from '$lib/shared/chat/ReportMessageDialog.svelte';
  import { DEFAULT_FREQUENT_REACTIONS, loadFrequentReactions } from '$lib/shared/chat/frequent-reactions';
  import PinnedMessagesBar from './PinnedMessagesBar.svelte';
  import RoomChatComposer from './RoomChatComposer.svelte';
  import RoomPanelHeader from './RoomPanelHeader.svelte';
  import RoomChatMessageGroup from './RoomChatMessageGroup.svelte';
  import { buildChatDays, type ChatGroup } from '../room-chat-view';
  import { ChatDraft } from '$lib/shared/chat/chat-draft.svelte';
  import { RoomChatSession, type OutgoingRoomMessage } from '../room-chat-session.svelte';
  import { isMessagePinned } from '../pins.svelte';
  import type { AttachmentComposeStore } from '$lib/shared/chat/attachment-compose.svelte';
  import { getAttachmentComposeStore } from '$lib/shared/chat/attachment-compose-stores';
  import { AttachmentDrop } from '$lib/shared/chat/attachment-drop.svelte';
  import OutgoingMessages from '$lib/shared/chat/OutgoingMessages.svelte';
  import AttachmentDropOverlay from '$lib/shared/chat/AttachmentDropOverlay.svelte';
  import { getRoomMembership } from '$lib/entities/room/room-membership.svelte';

  const social = useRoomSocial();

  // The one room chat. The in-room rail and the lobby preview differ only in how
  // the viewer is identified and in who owns the surrounding panel chrome, so
  // both render this component instead of keeping parallel implementations.
  let {
    roomId,
    peerId = '',
    sessionToken = '',
    resolveDisplayName,
    rootClass = 'room-chat-rail',
    ariaLabel = 'Панель комнаты',
    hidden = false,
    activeTab = 'chat',
    visible = true,
    unread = 0,
    participantCount = 0,
    chatTabId = undefined,
    participantsTabId = undefined,
    chatPanelId = undefined,
    participantsPanelId = undefined,
    onSelectChat,
    onSelectParticipants,
    onCollapse,
    onRead,
    onUnreadMessage,
    onToast,
    onAuthorContextMenu,
    canModerate = false,
    aroundMessageId = undefined,
    participants
  }: {
    roomId: string;
    peerId?: string;
    sessionToken?: string;
    resolveDisplayName: () => string;
    rootClass?: string;
    ariaLabel?: string;
    hidden?: boolean;
    activeTab?: 'chat' | 'participants';
    visible?: boolean;
    unread?: number;
    participantCount?: number;
    chatTabId?: string;
    participantsTabId?: string;
    chatPanelId?: string;
    participantsPanelId?: string;
    onSelectChat?: () => void;
    onSelectParticipants?: () => void;
    onCollapse?: () => void;
    onRead?: () => void;
    onUnreadMessage?: () => void;
    onToast?: (message: string, options?: { variant?: 'error' }) => void;
    onAuthorContextMenu?: (peerId: string, event: MouseEvent) => void;
    /** The room owner may delete anyone's message, not only their own. */
    canModerate?: boolean;
    /**
     * Open the history around this message and scroll to it. Passed explicitly
     * by hosts that route there themselves; the `around` query parameter is
     * still honoured for links that land on the room page directly.
     */
    aroundMessageId?: string;
    participants?: Snippet;
  } = $props();

  const chatVisible = $derived(visible && activeTab === 'chat');

  function toast(message: string, options?: { variant?: 'error' }): void {
    onToast?.(message, options);
  }

  const chat = new RoomChatSession({
    roomId: () => roomId,
    peerId: () => peerId,
    sessionToken: () => sessionToken,
    displayName: () => resolveDisplayName(),
    visible: () => chatVisible,
    aroundMessageId: () => aroundMessageId || new URL(window.location.href).searchParams.get('around') || undefined,
    onRead: () => onRead?.(),
    onUnreadMessage: () => onUnreadMessage?.(),
    toast,
    lifecycle: { updated: applyRoomUpdated, notFound: applyRoomNotFound, deleted: applyRoomDeleted }
  });
  const { timeline, scroll, reactions, outbox, isOwnMessage } = chat;

  // On a phone the panel is the whole screen rather than a rail beside the
  // stage, so it closes with a cross instead of collapsing to the right.
  let mobile = $state(false);
  const media = $derived<AttachmentComposeStore | null>(roomId ? getAttachmentComposeStore('room', roomId) : null);
  let quickReactions = $state<string[]>([...DEFAULT_FREQUENT_REACTIONS]);
  const draft = new ChatDraft({ type: 'room', id: untrack(() => roomId) });
  $effect(() => draft.restore(session.user?.id ?? ''));

  $effect(() => scroll.followComposer(media?.drafts.length ?? 0));

  const drop = new AttachmentDrop({
    media: () => media,
    onError: (message) => toast(message, { variant: 'error' })
  });

  const days = $derived(buildChatDays(timeline.messages, isOwnMessage));

  // Starting an edit clears the last send or edit error under the thread.
  const menu = new MessageMenuState<ChatMessage>({
    reactions,
    messages: () => timeline.messages,
    onEdit: () => {
      timeline.error = '';
    }
  });

  // Showing the chat marks it read and parks the view on the newest message.
  $effect(() => {
    if (!chatVisible || !roomId) return;
    return chat.show();
  });

  onMount(() => {
    mobile = !getDesktopBoundaryPolicy().desktopAllowed;
    const stop = chat.start();

    if (roomId && session.user?.id) {
      void loadFrequentReactions('chat', session.user.id).then((emoji) => {
        if (emoji.length > 0) quickReactions = emoji;
      });
    }

    return stop;
  });

  // Left click on another author (avatar or name) shows their profile card.
  // Realtime participant data enriches it when available; message identity is
  // the stable fallback after that person has left the room.
  // Own rows open your own card; the host renders it in self mode, without
  // friend actions.
  const canOpenProfile = (group: ChatGroup): boolean => !group.self || Boolean(session.user?.id);

  function openUserProfile(group: ChatGroup, event: MouseEvent): void {
    if (!canOpenProfile(group)) return;
    const participant = getParticipantById(group.peerId);
    event.preventDefault();
    event.stopPropagation();
    const anchor = event.currentTarget;
    const person = participant
      ? participantProfilePerson(social, participant)
      : roomMessageProfilePerson(social, group.messages[0]);
    queueMicrotask(() => openProfileCardFor(person, anchor));
  }

  // A mention opens the same card the author's avatar opens, so "who is this"
  // has one answer everywhere in the message.
  function openMentionProfile(userId: string, label: string, event: MouseEvent): void {
    if (!userId) return;
    event.preventDefault();
    event.stopPropagation();
    const anchor = event.currentTarget;
    const person = mentionProfilePerson(social, userId, label, getRoomMembership(roomId).members, [
      ...roomState.peers.values()
    ]);
    queueMicrotask(() => openProfileCardFor(person, anchor));
  }

  function openUserMenu(group: ChatGroup, event: MouseEvent): void {
    if (group.self || !onAuthorContextMenu) return;
    event.preventDefault();
    event.stopPropagation();
    onAuthorContextMenu(group.peerId, event);
  }
</script>

<aside
  class={rootClass}
  aria-label={ariaLabel}
  data-open={!hidden}
  {hidden}
  ondragenter={drop.enter}
  ondragover={drop.over}
  ondragleave={drop.leave}
  ondrop={drop.drop}
>
  {#if chatVisible && drop.active}<AttachmentDropOverlay />{/if}
  <RoomPanelHeader
    {activeTab}
    {unread}
    {participantCount}
    {mobile}
    {chatTabId}
    {participantsTabId}
    {chatPanelId}
    {participantsPanelId}
    {onSelectChat}
    {onSelectParticipants}
    {onCollapse}
  />

  {#if activeTab === 'chat'}
    <PinnedMessagesBar
      onJump={chat.jumpTo}
      onUnpin={(messageId: string) => void chat.togglePinned(messageId)}
      canUnpin={Boolean(session.user?.id)}
    />
    <div
      class="chat-rail-body"
      id={chatPanelId}
      role="tabpanel"
      aria-labelledby={chatTabId}
      {@attach scroll.body}
      onscroll={() => scroll.onScroll(chat.loadOlder)}
    >
      {#if timeline.loading}
        <p class="chat-rail-note">Загружаем сообщения…</p>
      {:else if days.length}
        {#if timeline.paged && (timeline.loadingOlder || timeline.hasMoreBefore)}
          <button
            class="chat-rail-note"
            type="button"
            disabled={timeline.loadingOlder}
            onclick={() => chat.loadOlder(scroll.element)}
          >
            {timeline.loadingOlder ? 'Загружаем…' : 'Показать предыдущие'}
          </button>
        {/if}
        {#each days as day (day.key)}
          <section class="chat-day-section" aria-label={day.label} {@attach scroll.keepsNewestInView}>
            <div class="chat-day-divider" role="separator" aria-label={day.label}>
              <span>{day.label}</span>
            </div>
            {#each day.groups as group (group.key)}
              <RoomChatMessageGroup
                {group}
                canOpenProfile={canOpenProfile(group)}
                {menu}
                {reactions}
                onOpenProfile={(event: MouseEvent) => openUserProfile(group, event)}
                onAuthorMenu={(event: MouseEvent) => openUserMenu(group, event)}
                onSaveEdit={(messageId: string, text: string) => chat.saveEdit(messageId, text)}
                onJump={chat.jumpTo}
                onMention={openMentionProfile}
                onCopy={(message: ChatMessage) => void copyMessageText(message.text, toast)}
              />
            {/each}
          </section>
        {/each}
      {:else if !outbox.items.length}
        <p class="chat-rail-note">Пока пусто. Напишите первое сообщение.</p>
      {/if}
      <OutgoingMessages
        items={outbox.items}
        textOf={(outgoing: OutgoingRoomMessage) => outgoing.text}
        attachmentsOf={(outgoing: OutgoingRoomMessage) => outgoing.attachmentIds?.length ?? 0}
        onRetry={(localId: string) => outbox.retry(localId)}
        onDiscard={(localId: string) => outbox.discard(localId)}
      />
    </div>

    {#if timeline.error}
      <p class="chat-rail-error">{timeline.error}</p>
    {/if}

    <RoomChatComposer
      bind:this={menu.composer}
      bind:replyTarget={menu.replyTarget}
      {roomId}
      {draft}
      {media}
      typingLabel={chat.typingLabel}
      send={(message: OutgoingRoomMessage) => chat.send(message)}
      onEditLast={() => menu.editLast(chat.lastOwnMessage())}
      onJump={chat.jumpTo}
      onToast={toast}
    />
  {:else if participants}
    <div class="room-panel-members" id={participantsPanelId} role="tabpanel" aria-labelledby={participantsTabId}>
      {@render participants()}
    </div>
  {/if}
</aside>

{#if menu.opened}
  {@const target = menu.opened.message}
  {@const image = menu.opened.image}
  <MessageContextMenu
    open
    x={menu.opened.x}
    y={menu.opened.y}
    {quickReactions}
    activeReactions={menu.activeReactions}
    canReact={Boolean(session.user?.id)}
    canPin={Boolean(session.user?.id)}
    pinned={isMessagePinned(target.id)}
    canEdit={isOwnMessage(target)}
    canDelete={isOwnMessage(target) || canModerate}
    onClose={() => menu.close()}
    onReact={(emoji: string) => void reactions.toggle(target.id, emoji)}
    onOpenReactionPicker={() => scroll.openReactionPicker(target.id)}
    onReply={() => menu.replyTo(target)}
    onCopy={() => void copyMessageText(target.text, toast)}
    onCopyImage={image ? () => void copyMessageImage(image, toast) : undefined}
    onDownloadImage={image ? () => downloadAttachment(image) : undefined}
    onTogglePin={() => void chat.togglePinned(target.id)}
    onEdit={() => menu.edit(target.id)}
    onDelete={() => void chat.deleteMessage(target.id)}
    onReport={session.user?.id && !isOwnMessage(target) ? () => menu.report(target.id) : undefined}
  />
{/if}

{#if menu.reportedId && roomId}
  <ReportMessageDialog
    target={{ kind: 'room_message', roomId, messageId: menu.reportedId }}
    onClose={() => menu.closeReport()}
    onReported={(message: string) => toast(message)}
  />
{/if}

<style>
  :global(.chat-rail-body) {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 15px;
    padding: 18px 20px;
  }
  :global(.room-panel-members) {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding: 18px 16px 24px;
  }
  :where(.chat-rail-body) > :first-child {
    margin-top: auto;
  }
  :global(.chat-day-section) {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 15px;
  }
  :global(.chat-msg-body) {
    display: grid;
    min-width: 0;
    flex: 1;
    gap: 4px;
    justify-items: start;
  }
  :where(.chat-msg-body) > * {
    max-width: 100%;
  }
  :global(.chat-msg-edited) {
    margin-left: 5px;
    color: var(--vr-text-3);
    font-family: var(--font-mono);
    font-size: 10.5px;
    white-space: nowrap;
  }
  :global(.chat-rail-note),
  :global(.chat-rail-error) {
    margin: auto 0 0;
    color: var(--vr-text-3);
    font-size: 12.5px;
    line-height: 1.45;
  }
  :global(.chat-rail-error) {
    margin: 0;
    padding: 0 20px 8px;
    color: var(--vr-danger);
  }
</style>
