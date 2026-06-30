<script lang="ts">
  import { tick } from 'svelte';
  import type { DirectMessage } from '$lib/api/dm';
  import { friendName, formatDayLabel, formatTime, isSameDay } from '../../model/lobby-format';
  import {
    friendsState,
    closeProfile,
    removeFriend,
    sendMessage,
    toggleProfile
  } from '../../model/friends.svelte';
  import Avatar from './Avatar.svelte';

  let { selfId } = $props<{ selfId: string }>();

  let draft = $state('');
  let sending = $state(false);
  let scrollEl = $state<HTMLDivElement | null>(null);
  let inputEl = $state<HTMLInputElement | null>(null);

  const peer = $derived(friendsState.threadPeer);
  const friendEntry = $derived(
    friendsState.friends.find((entry) => entry.user.id === friendsState.selectedFriendId)
  );
  const online = $derived(friendEntry?.online ?? false);

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
    if (friendsState.view !== 'dm' || !peerId) return;
    void tick().then(() => inputEl?.focus());
  });

  async function submit(): Promise<void> {
    const text = draft.trim();
    if (!text || sending) return;
    sending = true;
    const pending = text;
    draft = '';
    try {
      await sendMessage(pending);
    } catch {
      draft = pending;
    } finally {
      sending = false;
    }
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }

  async function handleRemove(): Promise<void> {
    if (peer) await removeFriend(peer.id);
  }
</script>

<div class="lobby-dm">
  <div class="lobby-dm-col">
    {#if peer}
      <button class="lobby-dm-head" type="button" onclick={toggleProfile}>
        <Avatar name={friendName(peer)} colorKey={peer.avatarColorKey} size={38} {online} showDot ring="#0e0d0a" />
        <div style="flex:1;min-width:0;">
          <div class="lobby-dm-head-name">{friendName(peer)}</div>
          <div class="lobby-dm-head-status" style={`color:${online ? '#8fa888' : '#8a8475'}`}>
            {online ? 'в сети' : 'не в сети'}
          </div>
        </div>
        <span style="flex:none;width:34px;height:34px;display:flex;align-items:center;justify-content:center;color:#9a9484;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"></circle><path d="M4 21a8 8 0 0 1 16 0"></path></svg>
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
                <span></span>
                <span class="lobby-dm-day-label">{group.dayLabel}</span>
                <span></span>
              </div>
            {/if}
            <div class="lobby-dm-group" class:lobby-dm-group--me={group.fromMe}>
              {#if !group.fromMe && peer}
                <Avatar name={friendName(peer)} colorKey={peer.avatarColorKey} size={32} />
              {/if}
              <div class="lobby-dm-bubbles">
                {#each group.bubbles as bubble (bubble.id)}
                  <div class="lobby-dm-bubble" class:lobby-dm-bubble--me={group.fromMe} class:lobby-dm-bubble--them={!group.fromMe}>
                    {bubble.body}
                  </div>
                {/each}
                <div class="lobby-dm-time">{formatTime(group.bubbles[group.bubbles.length - 1].createdAt)}</div>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <div class="lobby-dm-compose">
      <input
        class="lobby-dm-input"
        placeholder="Написать сообщение…"
        bind:this={inputEl}
        bind:value={draft}
        onkeydown={onKeydown}
        disabled={sending}
      />
    </div>
  </div>

  {#if friendsState.profileOpen && peer}
    <div class="lobby-profile-panel lobby-scroll">
      <div class="lobby-profile-cover">
        <button class="lobby-profile-close" type="button" aria-label="Закрыть" onclick={closeProfile}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="6" x2="18" y2="18"></line><line x1="18" y1="6" x2="6" y2="18"></line></svg>
        </button>
      </div>
      <div class="lobby-profile-body">
        <Avatar name={friendName(peer)} colorKey={peer.avatarColorKey} size={76} {online} showDot ring="#0c0b08" />
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

        <button class="lobby-profile-remove" type="button" onclick={handleRemove}>Удалить из друзей</button>
      </div>
    </div>
  {/if}
</div>
