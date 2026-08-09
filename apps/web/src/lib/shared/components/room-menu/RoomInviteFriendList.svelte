<script lang="ts">
  // Friend picker behind "Пригласить". Inviting no longer requires being in the
  // room, so this works the same from the lobby and from inside the room.
  import { Avatar } from '$lib/shared/ui';
  import { ringRoomFriend } from '$lib/api/rooms';
  import { effectivePresenceStatus } from '$lib/shared/presence';
  import type { Friend } from '$lib/api/friends';

  let {
    friends: supplied,
    roomId,
    /** Account ids already present in the room; those entries render disabled. */
    presentUserIds = new Set<string>(),
    close,
    onToast
  }: {
    friends: Friend[];
    roomId: string;
    presentUserIds?: Set<string>;
    close: () => void;
    onToast?: (message: string) => void;
  } = $props();

  let ringingUserId = $state('');

  // Online first — you are trying to pull someone into a live room, so people
  // who can answer right now belong at the top; then alphabetical.
  const friends = $derived(
    [...supplied].sort(
      (a, b) =>
        Number(b.online) - Number(a.online)
        || (a.user.displayName || a.user.login).localeCompare(b.user.displayName || b.user.login, 'ru')
    )
  );

  async function invite(userId: string, name: string): Promise<void> {
    if (ringingUserId) return;
    ringingUserId = userId;
    try {
      await ringRoomFriend(roomId, userId);
      onToast?.(`${name} приглашён в комнату`);
      close();
    } catch (error) {
      onToast?.(error instanceof Error && error.message ? error.message : 'Не удалось позвать друга');
    } finally {
      ringingUserId = '';
    }
  }
</script>

<div class="room-invite-list">
  {#if friends.length === 0}
    <p class="room-invite-empty">Добавьте друзей, чтобы позвать их</p>
  {:else}
    {#each friends as friend (friend.user.id)}
      {@const name = friend.user.displayName || friend.user.login}
      {@const alreadyInRoom = presentUserIds.has(friend.user.id)}
      {@const presence = effectivePresenceStatus(
        friend.online,
        friend.user.presenceStatus,
        friend.user.doNotDisturb
      )}
      <button
        class="room-invite-friend"
        type="button"
        role="menuitem"
        disabled={Boolean(ringingUserId) || alreadyInRoom}
        title={alreadyInRoom ? 'Уже в комнате' : undefined}
        onclick={() => void invite(friend.user.id, name)}
      >
        <Avatar
          {name}
          src={friend.user.avatarUrl}
          background={friend.user.avatarAccent || undefined}
          colorKey={friend.user.avatarColorKey}
          size={26}
          online={presence === 'online'}
          afk={presence === 'away'}
          dnd={presence === 'dnd'}
          showDot
        />
        <span class="room-invite-friend-name">{name}</span>
        {#if alreadyInRoom}<small class="room-invite-friend-note">В комнате</small>{/if}
      </button>
    {/each}
  {/if}
</div>

<style>
  .room-invite-list {
    display: flex;
    max-height: min(280px, 50vh);
    flex-direction: column;
    gap: 2px;
    overflow-y: auto;
  }

  .room-invite-empty {
    margin: 0;
    padding: 8px 12px;
    color: var(--warm-faint);
    font-size: 13px;
    line-height: 1.45;
  }

  .room-invite-friend {
    display: flex;
    align-items: center;
    gap: 11px;
    width: 100%;
    height: 40px;
    padding: 0 12px;
    border: none;
    border-radius: 12px;
    background: transparent;
    color: var(--warm-ink-dim);
    font-family: var(--font-ui);
    font-size: 14.5px;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
    transition: background 0.14s ease, color 0.14s ease;
  }

  .room-invite-friend:hover:not(:disabled),
  .room-invite-friend:focus-visible:not(:disabled) {
    background: color-mix(in oklch, var(--accent), transparent 88%);
    color: var(--warm-ink);
  }

  .room-invite-friend:disabled {
    cursor: default;
    opacity: 0.55;
  }

  .room-invite-friend-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .room-invite-friend-note {
    flex: none;
    color: var(--warm-faint);
    font-family: var(--font-mono);
    font-size: 11px;
  }
</style>
