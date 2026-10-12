<script lang="ts">
  // One open thread: its messages and its compose field. The DM view mounts it
  // per peer, so opening another thread starts from a clean slate — no editing,
  // reply or menu carried over, the thread's own draft and reactions loaded.
  import EmojiText from '$lib/shared/chat/EmojiText.svelte';
  import { onMount, tick, untrack } from 'svelte';
  import type { AuthUser } from '$lib/api/auth';
  import { markThreadRead, type DirectMessage } from '$lib/api/dm';
  import type { PublicUser } from '$lib/api/friends';
  import { getAppRealtime } from '$lib/api/realtime';
  import { useLobby } from '$lib/features/home/model/lobby-context';
  import AttachmentMosaic from '$lib/shared/chat/AttachmentMosaic.svelte';
  import type { AttachmentComposeStore } from '$lib/shared/chat/attachment-compose.svelte';
  import LinkPreviewCard from '$lib/shared/chat/LinkPreviewCard.svelte';
  import MessageEditor from '$lib/shared/chat/MessageEditor.svelte';
  import MessageContextMenu from '$lib/shared/chat/MessageContextMenu.svelte';
  import MessageHoverActions from '$lib/shared/chat/MessageHoverActions.svelte';
  import ReactionSummary from '$lib/shared/chat/ReactionSummary.svelte';
  import { createReactionStore } from '$lib/shared/chat/reaction-store.svelte';
  import { createReadReconciliation } from '$lib/shared/chat/read-reconciliation.svelte';
  import ReplyPreview from '$lib/shared/chat/ReplyPreview.svelte';
  import { formatTypingLabel } from '$lib/shared/chat/typing.svelte';
  import ChatText from '$lib/shared/components/ChatText.svelte';
  import type { ProfileCardPerson } from '$lib/shared/components/profile-card';
  import type { PresenceStatus } from '$lib/shared/presence';
  import { Avatar } from '$lib/shared/ui';
  import { copyText } from '$lib/shared/utils/clipboard';
  import { openProfileCardFor } from '../../../../../entities/profile-card/profile-card-ui.svelte';
  import { formatDayLabel, formatTime, friendName, isSameDay } from '../../../model/lobby-format';
  import { pushToast } from '../../../model/toasts.svelte';
  import DmComposer from './DmComposer.svelte';
  import DmInviteCard from './DmInviteCard.svelte';

  let {
    peerId,
    self,
    peer,
    presence,
    media,
    quickReactions,
    sending = $bindable(false)
  }: {
    peerId: string;
    self: AuthUser;
    peer: PublicUser | null;
    presence: PresenceStatus;
    media: AttachmentComposeStore | null;
    quickReactions: string[];
    sending?: boolean;
  } = $props();

  const lobby = useLobby();
  const selfId = $derived(self.id);
  const selfName = $derived(self.displayName?.trim() || self.login);
  const peerName = $derived(peer ? friendName(peer) : '');

  let scrollEl = $state<HTMLDivElement | null>(null);
  let composer = $state<{ focus(): void } | null>(null);
  let threadPinnedToBottom = true;
  let editingMessageId = $state('');
  let replyTarget = $state<DirectMessage | null>(null);
  let menu = $state<{ message: DirectMessage; fromMe: boolean; x: number; y: number } | null>(null);
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
    bubbles: DirectMessage[];
  }

  // Group consecutive messages by sender, inserting a day separator when the
  // calendar day changes.
  const groups = $derived.by<Group[]>(() => {
    const result: Group[] = [];
    let prev: DirectMessage | null = null;
    for (const message of lobby.thread.messages) {
      const fromMe = message.senderId === selfId;
      const newDay = !prev || !isSameDay(prev.createdAt, message.createdAt);
      const sameGroup = prev && !newDay && prev.senderId === message.senderId && result.length > 0;
      if (sameGroup) {
        result[result.length - 1].bubbles.push(message);
      } else {
        result.push({
          key: message.id,
          fromMe,
          dayLabel: newDay ? formatDayLabel(message.createdAt) : null,
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

  $effect(() => {
    for (const message of lobby.thread.messages) {
      if (!message.invite) void reactions.load(message.id);
    }
  });

  function scrollToBottom(): void {
    if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
  }

  // A new attachment grows the composer; a reader at the bottom stays there.
  let composerAttachmentCount = 0;
  $effect(() => {
    const attachmentCount = media?.drafts.length ?? 0;
    if (attachmentCount === composerAttachmentCount) return;
    composerAttachmentCount = attachmentCount;
    if (threadPinnedToBottom) void tick().then(scrollToBottom);
  });

  // A thread is not ready the moment its messages arrive: images and emoji are
  // still resolving, and every one that lands changes the height, so a scroll
  // to the bottom taken too early stops short. The placeholder therefore stays
  // up while the thread renders behind it, and comes down once the artwork has
  // settled and the view is actually at the newest message.
  const SETTLE_TIMEOUT_MS = 2000;
  let threadSettling = $state(false);
  let settleToken = 0;

  function pendingArtwork(root: HTMLElement): Promise<unknown> {
    const images = [...root.querySelectorAll('img')].filter((image) => !image.complete);
    if (!images.length) return Promise.resolve();
    return Promise.all(
      images.map(
        (image) =>
          new Promise<void>((resolve) => {
            const done = (): void => {
              image.removeEventListener('load', done);
              image.removeEventListener('error', done);
              resolve();
            };
            image.addEventListener('load', done);
            image.addEventListener('error', done);
          })
      )
    );
  }

  async function settleThread(token: number): Promise<void> {
    await tick();
    if (token !== settleToken) return;
    if (scrollEl) {
      // A slow or dead image must not hold the thread hostage.
      await Promise.race([pendingArtwork(scrollEl), new Promise((resolve) => setTimeout(resolve, SETTLE_TIMEOUT_MS))]);
    }
    if (token !== settleToken) return;
    await tick();
    if (token !== settleToken) return;
    scrollToBottom();
    threadSettling = false;
  }

  $effect(() => {
    if (lobby.thread.loading) {
      settleToken += 1;
      threadSettling = true;
      return;
    }
    void settleThread((settleToken += 1));
  });

  // Prepending older history keeps the same newest id, so it must not trigger
  // this latest-message autoscroll and disturb the preserved anchor.
  let lastAutoScrolledMessage: string | null = null;
  $effect(() => {
    const newestId = lobby.thread.messages.at(-1)?.id ?? '';
    if (newestId === lastAutoScrolledMessage) return;
    lastAutoScrolledMessage = newestId;
    void tick().then(scrollToBottom);
  });

  // Read receipts: what has been on screen is reported once it has rendered.
  let readReconciliation: ReturnType<typeof createReadReconciliation> | null = null;
  $effect(() => {
    const reconciliation = createReadReconciliation({
      scope: `dm:${peerId}`,
      commit: async (cursor) => {
        await markThreadRead(peerId, cursor);
      }
    });
    readReconciliation = reconciliation;
    return () => {
      reconciliation.dispose();
      if (readReconciliation === reconciliation) readReconciliation = null;
    };
  });

  $effect(() => {
    const revision = lobby.thread.readRevision;
    const candidate = lobby.thread.readCandidate;
    if (!revision || !candidate) return;
    void tick().then(() => readReconciliation?.advanceAfterRender(candidate));
  });

  function onThreadScroll(): void {
    if (!scrollEl) return;
    threadPinnedToBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight <= 48;
    if (scrollEl.scrollTop > 32) return;
    void lobby.loadOlderThread(scrollEl);
  }

  function messageRow(messageId: string): HTMLElement | null {
    return scrollEl?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(messageId)}"]`) ?? null;
  }

  function jumpToMessage(messageId: string): void {
    const row = messageRow(messageId);
    if (!row) {
      pushToast('Сообщение не загружено — прокрутите историю выше');
      return;
    }
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.classList.add('is-highlighted');
    setTimeout(() => row.classList.remove('is-highlighted'), 1600);
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
    if (editingMessageId) return false;
    const lastOwn = lobby.thread.messages.findLast((message) => message.senderId === selfId && !message.invite);
    if (!lastOwn) return false;
    editingMessageId = lastOwn.id;
    return true;
  }

  function replyTo(message: DirectMessage): void {
    replyTarget = message;
    composer?.focus();
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
  function openMessageMenu(message: DirectMessage, fromMe: boolean, event: MouseEvent): void {
    if (message.invite || editingMessageId === message.id) return;
    event.preventDefault();
    menu = { message, fromMe, x: event.clientX, y: event.clientY };
  }

  // The picker lives in each bubble's hover toolbar; the menu entry drives it
  // rather than mounting a second popover.
  function openReactionPickerFor(messageId: string): void {
    queueMicrotask(() => messageRow(messageId)?.querySelector<HTMLButtonElement>('.reaction-picker-trigger')?.click());
  }

  async function copyMessageText(message: DirectMessage): Promise<void> {
    try {
      await copyText(message.body);
      pushToast('Сообщение скопировано');
    } catch {
      pushToast('Не удалось скопировать');
    }
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

<div class="lobby-dm-scroll lobby-scroll" bind:this={scrollEl} onscroll={onThreadScroll}>
  {#if lobby.thread.loading || threadSettling}
    <div class="lobby-dm-loading" role="status">Загружаем переписку…</div>
  {/if}
  {#if lobby.thread.historyError && groups.length === 0}
    <div class="lobby-dm-empty">{lobby.thread.historyError}</div>
  {:else if groups.length === 0 && !lobby.thread.loading && !threadSettling}
    <div class="lobby-dm-empty">Здесь пока пусто. Напишите первым!</div>
  {:else}
    <div class="lobby-dm-thread" class:is-settling={threadSettling}>
      {#if lobby.thread.historyError}
        <div class="lobby-dm-empty">{lobby.thread.historyError}</div>
      {/if}
      {#if lobby.thread.loadingOlder || lobby.thread.hasMoreBefore}
        <button
          type="button"
          class="lobby-dm-empty"
          disabled={lobby.thread.loadingOlder}
          onclick={() => void lobby.loadOlderThread(scrollEl)}
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
                ><EmojiText text={group.fromMe ? selfName : peerName} /></button
              >
              <time class="chat-msg-time" datetime={new Date(group.bubbles[0].createdAt).toISOString()}
                >{formatTime(group.bubbles[0].createdAt)}</time
              >
            </div>
            {#each group.bubbles as bubble (bubble.id)}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="chat-msg-text dm-chat-message"
                class:is-context={menu?.message.id === bubble.id}
                data-message-id={bubble.id}
                data-group-first={bubble.id === group.bubbles[0].id}
                oncontextmenu={(event) => openMessageMenu(bubble, group.fromMe, event)}
              >
                {#if bubble.invite}
                  <DmInviteCard
                    invite={bubble.invite}
                    fromMe={group.fromMe}
                    busy={inviteResponding === bubble.id}
                    onRespond={(action: 'accept' | 'decline') => void respondToInvite(bubble, action)}
                  />
                {:else if editingMessageId === bubble.id}
                  <MessageEditor
                    text={bubble.body}
                    variant="dm-msg"
                    maxlength={2000}
                    onSave={async (text: string) => {
                      await lobby.editMessage(bubble.id, text);
                    }}
                    onClose={() => (editingMessageId = '')}
                  />
                {:else}
                  <div class="dm-chat-content">
                    {#if bubble.replyPreview}<ReplyPreview
                        preview={bubble.replyPreview}
                        interactive
                        onjump={jumpToMessage}
                      />{/if}
                    {#if bubble.attachments?.length}<AttachmentMosaic attachments={bubble.attachments} />{/if}
                    {#if bubble.body.trim()}<span class="chat-msg-content dm-msg-content"
                        ><ChatText text={bubble.body} />{#if bubble.editedAt}<span class="dm-msg-edited"
                            >(изменено)</span
                          >{/if}</span
                      >{/if}
                    {#if bubble.linkPreview}<LinkPreviewCard preview={bubble.linkPreview} />{/if}
                    <ReactionSummary store={reactions} messageId={bubble.id} />
                  </div>
                  <MessageHoverActions
                    reactionStore={reactions}
                    messageId={bubble.id}
                    userId={selfId}
                    onReply={() => replyTo(bubble)}
                    onCopy={() => void copyMessageText(bubble)}
                    onMore={(event: MouseEvent) => openMessageMenu(bubble, group.fromMe, event)}
                  />
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<DmComposer
  bind:this={composer}
  bind:replyTarget
  bind:sending
  {peerId}
  {selfId}
  {peerName}
  {media}
  {typingLabel}
  onEditLast={editLastOwnMessage}
  onJump={jumpToMessage}
/>

{#if menu}
  {@const target = menu.message}
  <MessageContextMenu
    open
    x={menu.x}
    y={menu.y}
    {quickReactions}
    activeReactions={new Set(
      reactions
        .forMessage(target.id)
        .filter((summary) => summary.reactedByMe)
        .map((summary) => summary.emoji)
    )}
    canReact={Boolean(selfId)}
    canEdit={menu.fromMe}
    canDelete={menu.fromMe}
    onClose={() => (menu = null)}
    onReact={(emoji: string) => void reactions.toggle(target.id, emoji)}
    onOpenReactionPicker={() => openReactionPickerFor(target.id)}
    onReply={() => replyTo(target)}
    onCopy={() => void copyMessageText(target)}
    onEdit={() => (editingMessageId = target.id)}
    onDelete={() => void deleteMessage(target.id)}
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
  :where(.lobby-dm-thread).is-settling {
    visibility: hidden;
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
