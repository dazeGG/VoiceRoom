<script lang="ts">
  import { Bell, BellOff, Copy, DoorOpen, MessageSquare, Pencil, Trash2, User, UserMinus, X } from '@lucide/svelte';
  import { iconMd, iconSm } from '$lib/shared/ui/icons';
  import { onMount, tick } from 'svelte';
  import type { DirectMessage } from '$lib/api/dm';
  import { Avatar } from '$lib/shared/ui';
  import { effectivePresenceStatus } from '$lib/shared/presence';
  import ChatText from '$lib/shared/components/ChatText.svelte';
  import { friendName, formatDayLabel, formatTime, isSameDay } from '../../model/lobby-format';
  import {
    friendsState,
    closeProfile,
    deleteMessage,
    editMessage as editDmMessage,
    removeFriend,
    respondRoomInvitation,
    sendMessage,
    loadOlderThread,
    toggleProfile
  } from '../../model/friends.svelte';
  import { isPeerNotificationsMuted, updatePeerNotificationsMuted } from '$lib/shared/notifications/preferences.svelte';
  import { copyText } from '$lib/shared/utils/clipboard';
  import { pushToast } from '../../model/toasts.svelte';
  import { markThreadRead } from '$lib/api/dm';
  import { createReadReconciliation } from '$lib/shared/chat/read-reconciliation.svelte';
  import { getCapabilityFeature } from '$lib/platform/capability-state.svelte';
  import { getAppRealtime } from '$lib/api/realtime';
  import { createReactionStore } from '$lib/shared/chat/reaction-store.svelte';
  import ReactionPicker from '$lib/shared/chat/ReactionPicker.svelte';
  import ReactionSummary from '$lib/shared/chat/ReactionSummary.svelte';
  import {
    dataTransferHasImages,
    getAttachmentComposeStore,
    imageFilesFromClipboard,
    imageFilesFromDataTransfer,
    type AttachmentComposeStore
  } from '$lib/shared/chat/attachment-compose.svelte';
  import AttachmentComposer from '$lib/shared/chat/AttachmentComposer.svelte';
  import AttachmentDropOverlay from '$lib/shared/chat/AttachmentDropOverlay.svelte';
  import AttachmentMosaic from '$lib/shared/chat/AttachmentMosaic.svelte';
  import AttachmentUploadControl from '$lib/shared/chat/AttachmentUploadControl.svelte';
  import ReplyPreview from '$lib/shared/chat/ReplyPreview.svelte';

  let { selfId } = $props<{ selfId: string }>();

  let draft = $state('');
  let sending = $state(false);
  let editingMessageId = $state('');
  let editDraft = $state('');
  let editSaving = $state(false);
  let scrollEl = $state<HTMLDivElement | null>(null);
  let inputEl = $state<HTMLTextAreaElement | null>(null);
  let editEl = $state<HTMLTextAreaElement | null>(null);
  let readReconciliation: ReturnType<typeof createReadReconciliation> | null = null;
  let reactionsEnabled = $state(false);
  const reactions = createReactionStore();
  let media = $state<AttachmentComposeStore | null>(null);
  let attachmentDragDepth = $state(0);
  let mediaUploadsEnabled = $state(false);
  let repliesEnabled = $state(false);
  let replyTarget = $state<DirectMessage | null>(null);
  let sendAttemptKey = '';
  let sendAttemptFingerprint = '';

  function idempotencyKeyFor(value: unknown): string {
    const fingerprint = JSON.stringify(value);
    if (!sendAttemptKey || sendAttemptFingerprint !== fingerprint) {
      sendAttemptKey = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      sendAttemptFingerprint = fingerprint;
    }
    return sendAttemptKey;
  }

  function autoResize() {
    if (!inputEl) return;
    inputEl.style.height = 'auto';
    const next = Math.min(inputEl.scrollHeight, 140);
    inputEl.style.height = `${next}px`;
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.isComposing) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
      return;
    }
    // ArrowUp in an empty composer edits the last own message, like Discord.
    if (event.key === 'ArrowUp' && !draft.trim() && !editingMessageId) {
      const lastOwn = findLastOwnMessage();
      if (lastOwn) {
        event.preventDefault();
        startEditing(lastOwn);
      }
      return;
    }
    queueMicrotask(autoResize);
  }

  async function onComposePaste(event: ClipboardEvent): Promise<void> {
    if (!media) return;
    const files = imageFilesFromClipboard(event);
    if (!files.length) return;
    event.preventDefault();
    try {
      await media.addFiles(files);
    } catch (cause) {
      pushToast(cause instanceof Error ? cause.message : 'Не удалось вставить изображение', { variant: 'error' });
    }
  }

  function onAttachmentDragEnter(event: DragEvent): void {
    if (!media || sending || !dataTransferHasImages(event.dataTransfer)) return;
    event.preventDefault();
    attachmentDragDepth += 1;
  }

  function onAttachmentDragOver(event: DragEvent): void {
    if (!media || sending || !dataTransferHasImages(event.dataTransfer)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }

  function onAttachmentDragLeave(event: DragEvent): void {
    if (!attachmentDragDepth) return;
    event.preventDefault();
    attachmentDragDepth = Math.max(0, attachmentDragDepth - 1);
  }

  async function onAttachmentDrop(event: DragEvent): Promise<void> {
    if (!media) return;
    const files = imageFilesFromDataTransfer(event.dataTransfer);
    if (!files.length) return;
    event.preventDefault();
    attachmentDragDepth = 0;
    try {
      await media.addFiles(files);
    } catch (cause) {
      pushToast(cause instanceof Error ? cause.message : 'Не удалось загрузить изображение', { variant: 'error' });
    }
  }

  function showAttachmentError(message: string): void {
    pushToast(message, { variant: 'error' });
  }

  function findLastOwnMessage(): DirectMessage | null {
    for (let index = friendsState.thread.length - 1; index >= 0; index -= 1) {
      const message = friendsState.thread[index];
      if (message.senderId === selfId && !message.invite) return message;
    }
    return null;
  }

  const peer = $derived(friendsState.threadPeer);
  const friendEntry = $derived(
    friendsState.friends.find((entry) => entry.user.id === friendsState.selectedFriendId)
  );
  const online = $derived(friendEntry?.online ?? false);
  const presence = $derived(effectivePresenceStatus(online, peer?.presenceStatus, peer?.doNotDisturb));
  const presenceLabel = $derived(
    presence === 'dnd'
      ? 'не беспокоить'
      : presence === 'away'
        ? 'отошёл'
        : presence === 'online'
          ? 'в сети'
          : 'не в сети'
  );
  const peerMuted = $derived(isPeerNotificationsMuted(peer?.id));
  let muteSaving = $state(false);
  let inviteResponding = $state('');
  const profileAccent = $derived(peer?.avatarAccent || '');

  $effect(() => {
    const peerId = friendsState.selectedFriendId;
    if (!peerId) {
      reactions.reset();
      media = null;
      return;
    }
    reactions.setConversation({ type: 'dm', id: peerId });
    media = mediaUploadsEnabled ? getAttachmentComposeStore('dm', peerId) : null;
  });

  $effect(() => {
    if (!reactionsEnabled) return;
    for (const message of friendsState.thread) {
      if (!message.invite) void reactions.load(message.id);
    }
  });

  onMount(() => {
    void getCapabilityFeature('reactions').then((enabled) => { reactionsEnabled = enabled; });
    void getCapabilityFeature('replies').then((enabled) => { repliesEnabled = enabled; });
    void getCapabilityFeature('mediaUploads').then((enabled) => { mediaUploadsEnabled = enabled; });
    return getAppRealtime().subscribe((event) => {
      if (event.type !== 'reaction.updated' || event.payload.conversation.type !== 'dm') return;
      if (event.payload.conversation.id !== friendsState.selectedFriendId) return;
      reactions.applyServer(event.payload.messageId, event.payload.summary);
    });
  });

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
    for (const message of friendsState.thread) {
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

  let lastAutoScrolledPeer = '';
  let lastAutoScrolledMessage = '';

  // Prepending older history keeps the same newest id, so it must not trigger
  // this latest-message autoscroll and disturb the preserved anchor.
  $effect(() => {
    const peerId = friendsState.selectedFriendId ?? '';
    const newestId = friendsState.thread.at(-1)?.id ?? '';
    if (peerId === lastAutoScrolledPeer && newestId === lastAutoScrolledMessage) return;
    lastAutoScrolledPeer = peerId;
    lastAutoScrolledMessage = newestId;
    void tick().then(() => {
      if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
    });
  });

  $effect(() => {
    const peerId = friendsState.selectedFriendId;
    const cursorEnabled = friendsState.threadReadCursorEnabled;
    readReconciliation?.dispose();
    readReconciliation = null;
    if (friendsState.view !== 'dm' || !peerId) return;
    readReconciliation = createReadReconciliation({
      scope: `dm:${peerId}`,
      legacy: !cursorEnabled,
      commit: async (cursor) => {
        await markThreadRead(peerId, cursor);
      }
    });
    return () => {
      readReconciliation?.dispose();
      readReconciliation = null;
    };
  });

  $effect(() => {
    const revision = friendsState.threadReadRevision;
    const candidate = friendsState.threadReadCandidate;
    if (!revision || !candidate || !readReconciliation) return;
    void tick().then(() => readReconciliation?.advanceAfterRender(candidate === '__legacy__' ? undefined : candidate));
  });

  function onThreadScroll(): void {
    if (!scrollEl || scrollEl.scrollTop > 32) return;
    void loadOlderThread(scrollEl);
  }

  // Focus the compose field when opening or switching DM threads.
  $effect(() => {
    const peerId = friendsState.selectedFriendId;
    cancelEditing();
    if (friendsState.view !== 'dm' || !peerId) return;
    void tick().then(() => inputEl?.focus());
  });

  async function submit(): Promise<void> {
    const text = draft.trim();
    if ((!text && !media?.canSend) || sending) return;
    if (media?.drafts.length && !media.canSend) return;
    sending = true;
    let sent = false;
    try {
      const attachmentIds = media?.readyIds ?? [];
      const replyTo = replyTarget ? { messageId: replyTarget.id } : undefined;
      await sendMessage(text, attachmentIds, replyTo, idempotencyKeyFor({ text, attachmentIds, replyTo }));
      draft = '';
      media?.clearBound();
      replyTarget = null;
      sendAttemptKey = '';
      sendAttemptFingerprint = '';
      sent = true;
    } catch {
      // Keep the draft intact so the message can be retried.
    } finally {
      sending = false;
    }
    if (!sent) return;
    await tick();
    if (inputEl) inputEl.style.height = '';
    inputEl?.focus();
  }



  async function togglePeerMute(): Promise<void> {
    if (!peer || muteSaving) return;
    muteSaving = true;
    try {
      await updatePeerNotificationsMuted(peer.id, !peerMuted);
    } finally {
      muteSaving = false;
    }
  }

  async function handleRemove(): Promise<void> {
    if (peer) await removeFriend(peer.id);
  }

  async function onDelete(mid: string): Promise<void> {
    try {
      await deleteMessage(mid);
      reactions.markDeleted(mid);
    } catch {}
  }

  async function copyMessageText(message: DirectMessage): Promise<void> {
    try {
      await copyText(message.body);
      pushToast('Сообщение скопировано');
    } catch {
      pushToast('Не удалось скопировать');
    }
  }

  function inviteTitle(message: DirectMessage, fromMe: boolean): string {
    const invite = message.invite;
    if (!invite) return '';
    if (invite.status === 'accepted') return 'Принял приглашение';
    if (invite.status === 'declined') return 'Отклонил предложение';
    if (invite.expiresAt && invite.expiresAt <= Date.now()) return 'Приглашение истекло';
    return fromMe ? 'Приглашение отправлено' : 'Приглашение в комнату';
  }

  function inviteActionable(message: DirectMessage, fromMe: boolean): boolean {
    const invite = message.invite;
    if (!invite || fromMe) return false;
    return invite.status === 'pending' && (!invite.expiresAt || invite.expiresAt > Date.now());
  }

  async function onInviteRespond(message: DirectMessage, action: 'accept' | 'decline'): Promise<void> {
    if (inviteResponding) return;
    inviteResponding = message.id;
    try {
      await respondRoomInvitation(message, action);
    } catch {
      pushToast('Не удалось ответить на приглашение');
    } finally {
      inviteResponding = '';
    }
  }

  function startEditing(message: DirectMessage): void {
    editingMessageId = message.id;
    editDraft = message.body;
    void tick().then(() => {
      editEl?.focus();
      editEl?.setSelectionRange(editEl.value.length, editEl.value.length);
    });
  }

  function cancelEditing(): void {
    editingMessageId = '';
    editDraft = '';
    editSaving = false;
  }

  function onEditKeydown(event: KeyboardEvent): void {
    if (event.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelEditing();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void saveEdit();
    }
  }

  async function saveEdit(): Promise<void> {
    const messageId = editingMessageId;
    const text = editDraft.trim();
    if (!messageId || !text || editSaving) return;
    editSaving = true;
    try {
      await editDmMessage(messageId, text);
      cancelEditing();
    } catch {
      editSaving = false;
    }
  }
</script>

<div
  class="lobby-dm"
  role="region"
  aria-label="Личные сообщения"
  ondragenter={onAttachmentDragEnter}
  ondragover={onAttachmentDragOver}
  ondragleave={onAttachmentDragLeave}
  ondrop={onAttachmentDrop}
>
  {#if attachmentDragDepth > 0}<AttachmentDropOverlay />{/if}
  <div class="lobby-dm-col">
    {#if peer}
      <button class="lobby-dm-head" type="button" onclick={toggleProfile}>
        <Avatar
          name={friendName(peer)}
          src={peer.avatarUrl}
          colorKey={peer.avatarColorKey}
          background={peer.avatarAccent || undefined}
          size={38}
          online={presence === 'online'}
          afk={presence === 'away'}
          dnd={presence === 'dnd'}
          showDot
          ring="var(--paper-deep)"
        />
        <div style="flex:1;min-width:0;">
          <div class="lobby-dm-head-name">{friendName(peer)}</div>
          <div class="lobby-dm-head-status" data-presence={presence}>{presenceLabel}</div>
        </div>
        <span style="flex:none;width:34px;height:34px;display:flex;align-items:center;justify-content:center;color:#9a9484;">
          <User {...iconMd} aria-hidden="true" />
        </span>
      </button>
    {/if}

    <div class="lobby-dm-scroll lobby-scroll" bind:this={scrollEl} onscroll={onThreadScroll}>
      {#if friendsState.threadLoading}
        <div class="lobby-dm-empty">Загружаем переписку…</div>
      {:else if friendsState.threadHistoryError && groups.length === 0}
        <div class="lobby-dm-empty">{friendsState.threadHistoryError}</div>
      {:else if groups.length === 0}
        <div class="lobby-dm-empty">Здесь пока пусто. Напишите первым!</div>
      {:else}
        <div class="lobby-dm-thread">
          {#if friendsState.threadHistoryError}
            <div class="lobby-dm-empty">{friendsState.threadHistoryError}</div>
          {/if}
          {#if friendsState.threadHistoryEnabled && (friendsState.threadLoadingOlder || friendsState.threadHasMoreBefore)}
            <button type="button" class="lobby-dm-empty" disabled={friendsState.threadLoadingOlder} onclick={() => void loadOlderThread(scrollEl)}>
              {friendsState.threadLoadingOlder ? 'Загружаем…' : 'Показать предыдущие'}
            </button>
          {/if}
          {#each groups as group (group.key)}
            {#if group.dayLabel}
              <div class="lobby-dm-day">
                <span class="lobby-dm-day-label">{group.dayLabel}</span>
              </div>
            {/if}
            <div class="lobby-dm-group" class:lobby-dm-group--me={group.fromMe}>
              {#if !group.fromMe && peer}
                <Avatar name={friendName(peer)} src={peer.avatarUrl} colorKey={peer.avatarColorKey} background={peer.avatarAccent || undefined} size={32} />
              {/if}
              <div class="lobby-dm-bubbles">
                {#each group.bubbles as bubble (bubble.id)}
                  {#if bubble.invite}
                    <article class="lobby-room-invitation" data-status={bubble.invite.status}>
                      <span class="lobby-room-invitation-icon"><DoorOpen {...iconMd} aria-hidden="true" /></span>
                      <div class="lobby-room-invitation-copy">
                        <strong>{inviteTitle(bubble, group.fromMe)}</strong>
                        <span>{bubble.invite.roomName || bubble.invite.roomId}</span>
                      </div>
                      {#if inviteActionable(bubble, group.fromMe)}
                        <div class="lobby-room-invitation-actions">
                          <button type="button" class="lobby-room-invitation-dismiss" disabled={inviteResponding === bubble.id} onclick={() => void onInviteRespond(bubble, 'decline')}>Не сейчас</button>
                          <button type="button" class="lobby-room-invitation-join" disabled={inviteResponding === bubble.id} onclick={() => void onInviteRespond(bubble, 'accept')}>Войти</button>
                        </div>
                      {/if}
                    </article>
                  {:else}
                  <div class="lobby-dm-bubble" class:lobby-dm-bubble--me={group.fromMe} class:lobby-dm-bubble--them={!group.fromMe}>
                    {#if editingMessageId === bubble.id}
                      <div class="dm-msg-edit">
                        <textarea
                          class="dm-msg-edit-input"
                          bind:this={editEl}
                          bind:value={editDraft}
                          rows="2"
                          maxlength="2000"
                          aria-label="Текст сообщения"
                          onkeydown={onEditKeydown}
                          disabled={editSaving}
                        ></textarea>
                        <div class="dm-msg-edit-actions">
                          <button type="button" onclick={cancelEditing} disabled={editSaving}>Отмена</button>
                          <button type="button" onclick={saveEdit} disabled={editSaving || !editDraft.trim()}>Сохранить</button>
                        </div>
                      </div>
                    {:else}
                      {#if bubble.replyPreview}<ReplyPreview preview={bubble.replyPreview} />{/if}
                      <span class="dm-msg-content"><ChatText text={bubble.body} />{#if bubble.editedAt}<span class="dm-msg-edited">(изменено)</span>{/if}</span>
                      {#if bubble.attachments?.length}<AttachmentMosaic attachments={bubble.attachments} />{/if}
                      <div class="dm-msg-actions" role="toolbar" aria-label="Действия с сообщением">
                        {#if repliesEnabled}<button type="button" aria-label="Ответить" title="Ответить" onclick={() => { replyTarget = bubble; inputEl?.focus(); }}><MessageSquare {...iconSm} /></button>{/if}
                        {#if reactionsEnabled}<ReactionPicker store={reactions} messageId={bubble.id} />{/if}
                        <button type="button" aria-label="Копировать текст" title="Копировать текст" onclick={() => void copyMessageText(bubble)}><Copy {...iconSm} aria-hidden="true" /></button>
                        {#if group.fromMe}
                          <button type="button" aria-label="Редактировать" title="Редактировать" onclick={() => startEditing(bubble)}><Pencil {...iconSm} aria-hidden="true" /></button>
                          <button type="button" class="dm-msg-action-danger" aria-label="Удалить" title="Удалить" onclick={() => void onDelete(bubble.id)}><Trash2 {...iconSm} aria-hidden="true" /></button>
                        {/if}
                      </div>
                      {#if reactionsEnabled}<ReactionSummary store={reactions} messageId={bubble.id} />{/if}
                    {/if}
                  </div>
                  {/if}
                {/each}
                <div class="lobby-dm-time">{formatTime(group.bubbles[group.bubbles.length - 1].createdAt)}</div>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <div class="lobby-dm-compose" onpaste={onComposePaste}>
      {#if replyTarget}<div class="dm-reply-target"><ReplyPreview preview={{ messageId: replyTarget.id, deleted: false, author: { id: replyTarget.senderId, name: replyTarget.senderId === selfId ? 'Вы' : friendName(peer!) }, text: replyTarget.body }} /><button type="button" onclick={() => (replyTarget = null)}>Отмена</button></div>{/if}
      {#if media}<AttachmentComposer store={media} disabled={sending} />{/if}
      <div class="lobby-dm-compose-row attachment-compose-field">
        {#if media}<AttachmentUploadControl store={media} disabled={sending} onerror={showAttachmentError} />{/if}
        <textarea
          class="lobby-dm-input lobby-dm-textarea"
          placeholder="Написать сообщение…"
          bind:this={inputEl}
          bind:value={draft}
          rows="1"
          onkeydown={onKeydown}
          oninput={autoResize}
          disabled={sending}
        ></textarea>
      </div>
    </div>
  </div>

  {#if friendsState.profileOpen && peer}
    <div class="lobby-profile-panel lobby-scroll">
      <div class="lobby-profile-cover" style:--profile-cover-accent={profileAccent || undefined}>
        <button class="lobby-profile-close" type="button" aria-label="Закрыть" onclick={closeProfile}>
          <X {...iconSm} aria-hidden="true" />
        </button>
      </div>
      <div class="lobby-profile-body">
        <Avatar
          name={friendName(peer)}
          src={peer.avatarUrl}
          colorKey={peer.avatarColorKey}
          background={peer.avatarAccent || undefined}
          size={76}
          online={presence === 'online'}
          afk={presence === 'away'}
          dnd={presence === 'dnd'}
          showDot
          ring="var(--paper-deep)"
        />
        <div class="lobby-profile-panel-name">{friendName(peer)}</div>
        <div class="lobby-profile-panel-handle">@{peer.login}</div>

        <div class="lobby-profile-stats">
          <div class="lobby-profile-stat">
            <div class="lobby-profile-stat-num">{friendsState.thread.length}</div>
            <div class="lobby-profile-stat-label">сообщений</div>
          </div>
          <div class="lobby-profile-stat">
            <div class="lobby-profile-stat-num">{online ? 'в сети' : '—'}</div>
            <div class="lobby-profile-stat-label">статус</div>
          </div>
        </div>

        <button
          class="lobby-profile-action"
          class:is-muted={peerMuted}
          type="button"
          onclick={togglePeerMute}
          disabled={muteSaving}
          data-notification-mute="dm"
        >
          {#if peerMuted}<BellOff {...iconMd} aria-hidden="true" />{:else}<Bell {...iconMd} aria-hidden="true" />{/if}
          <span>{peerMuted ? 'Уведомления выключены' : 'Выключить уведомления'}</span>
        </button>
        <button class="lobby-profile-action lobby-profile-action--danger" type="button" onclick={handleRemove}>
          <UserMinus {...iconMd} aria-hidden="true" />
          <span>Удалить из друзей</span>
        </button>
      </div>
    </div>
  {/if}
</div>
