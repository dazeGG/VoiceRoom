<script lang="ts">
  import { Bell, BellOff, Copy, DoorOpen, Pencil, Trash2, User, X } from '@lucide/svelte';
  import { iconMd, iconSm } from '$lib/shared/ui/icons';
  import { tick } from 'svelte';
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
    toggleProfile
  } from '../../model/friends.svelte';
  import { isPeerNotificationsMuted, updatePeerNotificationsMuted } from '$lib/shared/notifications/preferences.svelte';
  import { copyText } from '$lib/shared/utils/clipboard';
  import { pushToast } from '../../model/toasts.svelte';

  let { selfId } = $props<{ selfId: string }>();

  let draft = $state('');
  let sending = $state(false);
  let editingMessageId = $state('');
  let editDraft = $state('');
  let editSaving = $state(false);
  let scrollEl = $state<HTMLDivElement | null>(null);
  let inputEl = $state<HTMLTextAreaElement | null>(null);
  let editEl = $state<HTMLTextAreaElement | null>(null);

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

  // Autoscroll to the newest message whenever the thread grows.
  $effect(() => {
    void friendsState.thread.length;
    void tick().then(() => {
      if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
    });
  });

  // Focus the compose field when opening or switching DM threads.
  $effect(() => {
    const peerId = friendsState.selectedFriendId;
    cancelEditing();
    if (friendsState.view !== 'dm' || !peerId) return;
    void tick().then(() => inputEl?.focus());
  });

  async function submit(): Promise<void> {
    const text = draft.trim();
    if (!text || sending) return;
    sending = true;
    let sent = false;
    try {
      await sendMessage(text);
      draft = '';
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

<div class="lobby-dm">
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

    <div class="lobby-dm-scroll lobby-scroll" bind:this={scrollEl}>
      {#if friendsState.threadLoading}
        <div class="lobby-dm-empty">Загружаем переписку…</div>
      {:else if groups.length === 0}
        <div class="lobby-dm-empty">Здесь пока пусто. Напишите первым!</div>
      {:else}
        <div class="lobby-dm-thread">
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
                      <span class="dm-msg-content"><ChatText text={bubble.body} />{#if bubble.editedAt}<span class="dm-msg-edited">(изменено)</span>{/if}</span>
                      <div class="dm-msg-actions" role="toolbar" aria-label="Действия с сообщением">
                        <button type="button" aria-label="Копировать текст" title="Копировать текст" onclick={() => void copyMessageText(bubble)}><Copy {...iconSm} aria-hidden="true" /></button>
                        {#if group.fromMe}
                          <button type="button" aria-label="Редактировать" title="Редактировать" onclick={() => startEditing(bubble)}><Pencil {...iconSm} aria-hidden="true" /></button>
                          <button type="button" class="dm-msg-action-danger" aria-label="Удалить" title="Удалить" onclick={() => void onDelete(bubble.id)}><Trash2 {...iconSm} aria-hidden="true" /></button>
                        {/if}
                      </div>
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

    <div class="lobby-dm-compose">
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

        <button class="lobby-profile-remove" type="button" onclick={togglePeerMute} disabled={muteSaving} data-notification-mute="dm">
          {#if peerMuted}<BellOff {...iconSm} aria-hidden="true" /> Уведомления выключены{:else}<Bell {...iconSm} aria-hidden="true" /> Выключить уведомления{/if}
        </button>
        <button class="lobby-profile-remove" type="button" onclick={handleRemove}>Удалить из друзей</button>
      </div>
    </div>
  {/if}
</div>
