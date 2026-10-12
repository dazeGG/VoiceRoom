<script lang="ts">
  import { untrack } from 'svelte';
  import { Ban, Ellipsis, User, UserX } from '@lucide/svelte';
  import Avatar from '$lib/shared/ui/Avatar/Avatar.svelte';
  import { Popover, PopoverDivider, PopoverMenuItem, PopoverSubmenu } from '$lib/shared/ui';
  import type { PopoverContentState, PopoverTriggerState } from '$lib/shared/ui/Popover';
  import { iconMd } from '$lib/shared/ui/icons';
  import { session } from '$lib/features/auth/session.svelte';
  import { getRoomMembership, loadRoomMembership, roomMembershipState } from '../room-membership.svelte';
  import { BAN_DURATIONS, banRoomMember, kickRoomMember, type ModerationNotice } from '../room-moderation';
  import { roomPresence } from '../room-presence.svelte';
  import type { MembershipMember } from '$lib/api/memberships';
  import type { ModerationDuration } from '$lib/api/moderation';
  import { openProfileCardFor } from '../../profile-card/profile-card-ui.svelte';
  import type { ProfileCardPerson } from '$lib/shared/components/profile-card';

  let {
    roomId,
    canModerate = false,
    onNotify = () => {}
  }: {
    roomId: string;
    /** Owner view: members other than the owner get a moderation menu. */
    canModerate?: boolean;
    onNotify?: ModerationNotice;
  } = $props();
  const roster = $derived(roomMembershipState.byRoomId[roomId] ?? null);
  const onlineMembers = $derived((roster?.members ?? []).filter((member) => member.presenceStatus !== 'offline'));
  const offlineMembers = $derived((roster?.members ?? []).filter((member) => member.presenceStatus === 'offline'));

  let banningUserId = $state('');
  // The menu trigger that opened the current member menu; the profile card
  // anchors to it because the menu item itself is gone once the menu closes.
  let menuAnchor: HTMLElement | null = null;

  // The roster is account-only: the API answers a guest with 401.
  const signedIn = $derived(Boolean(session.user?.id));

  $effect(() => {
    const currentRoomId = roomId;
    if (!signedIn) return;
    untrack(() => {
      getRoomMembership(currentRoomId);
      void loadRoomMembership(currentRoomId);
    });
  });

  function nameFor(member: MembershipMember): string {
    return member.displayName || member.login;
  }

  function canModerateMember(member: MembershipMember): boolean {
    return canModerate && member.role !== 'owner' && member.userId !== session.user?.id;
  }

  function profilePerson(member: MembershipMember): ProfileCardPerson {
    return {
      userId: member.userId,
      name: nameFor(member),
      login: member.login,
      avatarUrl: member.avatarUrl,
      avatarColorKey: member.avatarColorKey,
      avatarAccent: member.avatarAccent,
      presence: member.presenceStatus === 'afk' ? 'away' : member.presenceStatus
    };
  }

  function openMemberProfile(member: MembershipMember, event: MouseEvent): void {
    openProfileCardFor(profilePerson(member), event.currentTarget);
  }

  function showProfileFromMenu(member: MembershipMember, close: (restoreFocus?: boolean) => void): void {
    const anchor = menuAnchor;
    close(false);
    // Deferred so the closing menu does not swallow the card's own outside-click
    // listener during the same pointer event.
    queueMicrotask(() => openProfileCardFor(profilePerson(member), anchor));
  }

  // Only someone in the call has a live peer to take out of it.
  function livePeerId(member: MembershipMember): string {
    const peers = roomPresence.peersByRoomId[roomId] ?? [];
    return peers.find((peer) => peer.accountUserId === member.userId)?.id ?? '';
  }

  async function kick(member: MembershipMember): Promise<void> {
    const peerId = livePeerId(member);
    if (banningUserId || !peerId) return;
    banningUserId = member.userId;
    try {
      await kickRoomMember(roomId, { peerId, name: nameFor(member) }, onNotify);
    } finally {
      banningUserId = '';
    }
  }

  async function ban(member: MembershipMember, duration: ModerationDuration): Promise<void> {
    if (banningUserId) return;
    banningUserId = member.userId;
    try {
      await banRoomMember(roomId, { userId: member.userId, name: nameFor(member) }, duration, onNotify);
    } finally {
      banningUserId = '';
    }
  }
</script>

{#snippet memberRow(member: MembershipMember)}
  <div class="room-member-list__row">
    <button
      class="room-member-list__member"
      type="button"
      aria-haspopup="dialog"
      aria-label={`Профиль ${nameFor(member)}`}
      onclick={(event) => openMemberProfile(member, event)}
    >
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
      <span
        ><strong
          >{nameFor(member)}{#if member.userId === session.user?.id}<em class="room-member-list__you">вы</em
            >{/if}</strong
        ><small>@{member.login}</small></span
      >
    </button>

    {#if canModerateMember(member)}
      <Popover
        placement="bottom-end"
        flip
        floating
        role="menu"
        ariaLabel={`Действия с ${nameFor(member)}`}
        rootClass="room-member-list__menu-root"
      >
        {#snippet trigger({ open, toggle, panelId }: PopoverTriggerState)}
          <button
            class="room-member-list__menu-trigger"
            type="button"
            aria-label={`Действия с ${nameFor(member)}`}
            title="Действия"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-controls={panelId}
            data-open={open}
            disabled={banningUserId === member.userId}
            onclick={(event) => {
              menuAnchor = event.currentTarget;
              toggle();
            }}
          >
            <Ellipsis {...iconMd} aria-hidden="true" />
          </button>
        {/snippet}

        {#snippet content({ close }: PopoverContentState)}
          <div class="room-member-list__menu">
            <PopoverMenuItem label="Профиль" onclick={() => showProfileFromMenu(member, close)}>
              {#snippet icon()}<User {...iconMd} aria-hidden="true" />{/snippet}
            </PopoverMenuItem>
            <PopoverDivider />
            <PopoverMenuItem
              label="Выгнать"
              variant="danger"
              disabled={!livePeerId(member)}
              onclick={() => {
                close();
                void kick(member);
              }}
            >
              {#snippet icon()}<UserX {...iconMd} aria-hidden="true" />{/snippet}
            </PopoverMenuItem>
            <PopoverSubmenu label="Заблокировать" ariaLabel={`Срок блокировки ${nameFor(member)}`}>
              {#snippet icon()}<Ban {...iconMd} aria-hidden="true" />{/snippet}
              {#snippet content({ close: closeSubmenu }: { close: () => void })}
                {#each BAN_DURATIONS as option (option.value)}
                  <PopoverMenuItem
                    label={option.label}
                    variant="danger"
                    onclick={() => {
                      closeSubmenu();
                      close();
                      void ban(member, option.value);
                    }}
                  />
                {/each}
              {/snippet}
            </PopoverSubmenu>
          </div>
        {/snippet}
      </Popover>
    {/if}
  </div>
{/snippet}

<section class="room-member-list" aria-label="Участники комнаты">
  <div aria-live="polite" aria-atomic="true" class="sr-only">
    {#if roster?.loading}Загрузка участников{/if}
    {#if roster?.error}{roster.error}{/if}
  </div>

  {#if !signedIn}
    <div class="room-member-list__notice">
      <p>Список участников виден после входа в аккаунт.</p>
    </div>
  {:else if roster?.error && roster.members.length === 0}
    <div class="room-member-list__notice" role="alert">
      <p>{roster.error}</p>
      <button type="button" onclick={() => loadRoomMembership(roomId)}>Повторить</button>
    </div>
  {:else}
    <h3>В сети <span class="room-member-list__count">{onlineMembers.length}</span></h3>
    <ul aria-label="Участники в сети">
      {#each onlineMembers as member (member.userId)}
        <li>{@render memberRow(member)}</li>
      {/each}
    </ul>

    <h3>Не в сети <span class="room-member-list__count">{offlineMembers.length}</span></h3>
    <ul aria-label="Участники не в сети">
      {#each offlineMembers as member (member.userId)}
        <li>{@render memberRow(member)}</li>
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
  .room-member-list {
    display: grid;
    gap: 4px;
    min-width: 240px;
  }
  h3,
  p {
    margin: 0;
  }
  h3 {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px 8px;
    color: var(--vr-text-2);
    font-size: 12.5px;
    font-weight: 500;
  }
  h3:not(:first-child) {
    margin-top: 14px;
  }
  .room-member-list__count {
    color: var(--vr-text-3);
    font-family: var(--font-mono);
    font-size: 11.5px;
    font-weight: 400;
  }
  ul {
    display: grid;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    min-width: 0;
  }
  .room-member-list__row {
    position: relative;
    display: flex;
    align-items: center;
    min-width: 0;
    border-radius: 10px;
    transition: background 120ms ease;
  }
  .room-member-list__row:hover,
  .room-member-list__row:focus-within {
    background: var(--vr-hover);
  }
  .room-member-list__member {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 10px;
    min-width: 0;
    padding: 8px 10px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .room-member-list__member:focus-visible {
    outline: 2px solid var(--vr-accent);
    outline-offset: -2px;
  }
  .room-member-list__member > span {
    display: grid;
    min-width: 0;
  }
  strong,
  small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  strong {
    font-size: 14px;
    font-weight: 500;
  }
  .room-member-list__you {
    margin-left: 6px;
    color: var(--vr-text-3);
    font-size: 13px;
    font-style: normal;
    font-weight: 400;
  }
  small {
    color: var(--vr-text-3);
    font-family: var(--font-mono);
    font-size: 11.5px;
  }
  .room-member-list__row :global(.room-member-list__menu-root) {
    margin-right: 6px;
  }
  .room-member-list__menu-trigger {
    display: grid;
    width: 32px;
    height: 32px;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 9px;
    background: transparent;
    color: var(--vr-text-3);
    cursor: pointer;
    transition:
      background 120ms ease,
      color 120ms ease;
  }
  .room-member-list__menu-trigger:hover:not(:disabled),
  .room-member-list__menu-trigger[data-open='true'] {
    background: var(--vr-hover);
    color: var(--vr-text);
  }
  .room-member-list__menu-trigger:focus-visible {
    outline: 2px solid var(--vr-accent);
    outline-offset: -2px;
  }
  .room-member-list__menu-trigger:disabled {
    cursor: default;
    opacity: 0.55;
  }
  .room-member-list__menu {
    display: flex;
    width: min(232px, calc(100vw - 28px));
    flex-direction: column;
    gap: 2px;
  }
  .room-member-list__notice,
  .room-member-list__empty {
    color: var(--vr-text-2);
    font-size: 13px;
  }
  .room-member-list__more {
    justify-self: stretch;
    min-height: 38px;
    border: 1px solid var(--vr-line-strong);
    border-radius: 10px;
    background: transparent;
    color: var(--vr-text);
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
