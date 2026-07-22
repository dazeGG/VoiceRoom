<script lang="ts">
  import { Search } from '@lucide/svelte';
  import Avatar from '$lib/shared/ui/Avatar/Avatar.svelte';
  import { iconSm } from '$lib/shared/ui/icons';
  import {
    getRoomMembership,
    loadRoomMembership
  } from '../../model/room-membership.svelte';

  let { roomId }: { roomId: string } = $props();
  let query = $state('');
  const roster = $derived(getRoomMembership(roomId));
  const voiceMembers = $derived(roster.members.filter((member) => member.inVoice));
  const otherMembers = $derived(roster.members.filter((member) => !member.inVoice));

  $effect(() => {
    roomId;
    query = '';
    void loadRoomMembership(roomId);
  });

  $effect(() => {
    const room = roomId;
    const search = query.trim();
    const timer = window.setTimeout(() => void loadRoomMembership(room, { query: search }), 250);
    return () => window.clearTimeout(timer);
  });

  function nameFor(member: (typeof roster.members)[number]): string {
    return member.displayName || member.login;
  }
</script>

<section class="room-member-list" aria-labelledby="room-members-title">
  <div class="room-member-list__heading">
    <h2 id="room-members-title">Участники</h2>
    <label class="room-member-list__search">
      <span class="sr-only">Найти участника</span>
      <Search {...iconSm} aria-hidden="true" />
      <input bind:value={query} type="search" placeholder="Найти участника" autocomplete="off" />
    </label>
  </div>

  <div aria-live="polite" aria-atomic="true" class="sr-only">
    {#if roster.loading}Загрузка участников{/if}
    {#if roster.error}{roster.error}{/if}
  </div>

  {#if roster.error && roster.members.length === 0}
    <div class="room-member-list__notice" role="alert">
      <p>{roster.error}</p>
      <button type="button" onclick={() => loadRoomMembership(roomId, { query })}>Повторить</button>
    </div>
  {:else}
    {#if voiceMembers.length > 0}
      <h3>В голосовом канале — {voiceMembers.length}</h3>
      <ul aria-label="В голосовом канале">
        {#each voiceMembers as member (member.userId)}
          <li>
            <Avatar name={nameFor(member)} src={member.avatarUrl} colorKey={member.avatarColorKey} size={32} showDot online />
            <span><strong>{nameFor(member)}</strong><small>@{member.login}{member.role === 'owner' ? ' · Создатель' : ''}</small></span>
          </li>
        {/each}
      </ul>
    {/if}

    <h3>Остальные — {otherMembers.length}</h3>
    <ul aria-label="Остальные участники">
      {#each otherMembers as member (member.userId)}
        <li>
          <Avatar
            name={nameFor(member)}
            src={member.avatarUrl}
            colorKey={member.avatarColorKey}
            size={32}
            showDot
            online={member.presenceStatus !== 'offline'}
            dnd={member.presenceStatus === 'dnd'}
            afk={member.presenceStatus === 'afk'}
          />
          <span><strong>{nameFor(member)}</strong><small>@{member.login}{member.role === 'owner' ? ' · Создатель' : ''}</small></span>
        </li>
      {/each}
    </ul>

    {#if roster.hasMore}
      <button
        class="room-member-list__more"
        type="button"
        disabled={roster.loading}
        onclick={() => loadRoomMembership(roomId, { append: true, query: roster.query })}
      >
        {roster.loading ? 'Загрузка…' : 'Показать ещё'}
      </button>
    {:else if roster.loaded && roster.members.length === 0}
      <p class="room-member-list__empty">Никого не найдено</p>
    {/if}
  {/if}
</section>

<style>
  .room-member-list { display: grid; gap: 12px; min-width: 240px; }
  .room-member-list__heading { display: grid; gap: 10px; }
  h2, h3, p { margin: 0; }
  h2 { font-size: 18px; }
  h3 { color: var(--ink-muted); font-size: 12px; font-weight: 700; text-transform: uppercase; }
  .room-member-list__search { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 10px; }
  .room-member-list__search input { min-width: 0; width: 100%; border: 0; outline: 0; background: transparent; color: inherit; font: inherit; }
  ul { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; }
  li { display: flex; align-items: center; gap: 10px; min-width: 0; padding: 6px; border-radius: 10px; }
  li > span { display: grid; min-width: 0; }
  strong, small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  strong { font-size: 14px; }
  small { color: var(--ink-muted); font-size: 12px; }
  .room-member-list__notice, .room-member-list__empty { color: var(--ink-muted); font-size: 13px; }
  .room-member-list__more { justify-self: stretch; min-height: 38px; border: 1px solid var(--line); border-radius: 10px; background: var(--paper); color: inherit; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
</style>
