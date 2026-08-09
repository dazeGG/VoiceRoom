<script lang="ts">
  import { untrack } from 'svelte';
  import Avatar from '$lib/shared/ui/Avatar/Avatar.svelte';
  import {
    getRoomMembership,
    loadRoomMembership,
    roomMembershipState
  } from '../../model/room-membership.svelte';
  import type { MembershipMember } from '$lib/api/memberships';

  let { roomId }: { roomId: string } = $props();
  const roster = $derived(roomMembershipState.byRoomId[roomId] ?? null);
  const onlineMembers = $derived((roster?.members ?? []).filter((member) => member.presenceStatus !== 'offline'));
  const offlineMembers = $derived((roster?.members ?? []).filter((member) => member.presenceStatus === 'offline'));

  $effect(() => {
    const currentRoomId = roomId;
    untrack(() => {
      getRoomMembership(currentRoomId);
      void loadRoomMembership(currentRoomId);
    });
  });

  function nameFor(member: MembershipMember): string {
    return member.displayName || member.login;
  }
</script>

<section class="room-member-list" aria-label="Участники комнаты">
  <div aria-live="polite" aria-atomic="true" class="sr-only">
    {#if roster?.loading}Загрузка участников{/if}
    {#if roster?.error}{roster.error}{/if}
  </div>

  {#if roster?.error && roster.members.length === 0}
    <div class="room-member-list__notice" role="alert">
      <p>{roster.error}</p>
      <button type="button" onclick={() => loadRoomMembership(roomId)}>Повторить</button>
    </div>
  {:else}
    <h3>В сети — {onlineMembers.length}</h3>
    <ul aria-label="Участники в сети">
      {#each onlineMembers as member (member.userId)}
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
          <span><strong>{nameFor(member)}</strong><small>@{member.login}</small></span>
        </li>
      {/each}
    </ul>

    <h3>Не в сети — {offlineMembers.length}</h3>
    <ul aria-label="Участники не в сети">
      {#each offlineMembers as member (member.userId)}
        <li>
          <Avatar name={nameFor(member)} src={member.avatarUrl} colorKey={member.avatarColorKey} size={32} showDot />
          <span><strong>{nameFor(member)}</strong><small>@{member.login}</small></span>
        </li>
      {/each}
    </ul>

    {#if roster?.hasMore}
      <button
        class="room-member-list__more"
        type="button"
        disabled={roster.loading}
        onclick={() => loadRoomMembership(roomId, { append: true })}
      >
        {roster.loading ? 'Загрузка…' : 'Показать ещё'}
      </button>
    {:else if roster?.loaded && roster.members.length === 0}
      <p class="room-member-list__empty">Никого не найдено</p>
    {/if}
  {/if}
</section>

<style>
  .room-member-list { display: grid; gap: 12px; min-width: 240px; }
  h3, p { margin: 0; }
  h3 { color: var(--ink-muted); font-size: 12px; font-weight: 700; text-transform: uppercase; }
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
