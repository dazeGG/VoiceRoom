<script lang="ts">
  import { Check, MessageSquare, UserMinus, UserPlus } from '@lucide/svelte';
  import { Avatar, Ellipsis } from '$lib/shared/ui';
  import { iconMd } from '$lib/shared/ui/icons';
  import { getAvatarColor } from '$lib/visual/tokens';
  import type { ProfileCardProps } from './types';

  let {
    person,
    relationship,
    friendsSince = null,
    busy = false,
    onMessage,
    onAddFriend,
    onAcceptRequest,
    onRemoveFriend
  }: ProfileCardProps = $props();

  // The banner takes the person's avatar colour so the card reads as theirs even
  // when they use a photo, where the accent would otherwise be invisible.
  const accent = $derived(person.avatarAccent || getAvatarColor(person.avatarColorKey).background);
  const friendsSinceLabel = $derived.by(() => {
    if (relationship !== 'friend' || !friendsSince) return '';
    return new Date(friendsSince).toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  });
</script>

<div class="profile-card" data-profile-card>
  <div class="profile-card-cover" style:--profile-accent={accent}></div>

  <div class="profile-card-body">
    <span class="profile-card-avatar">
      <Avatar
        name={person.name}
        src={person.avatarUrl}
        colorKey={person.avatarColorKey}
        background={person.avatarAccent || undefined}
        size={84}
        online={person.presence === 'online'}
        afk={person.presence === 'away'}
        dnd={person.presence === 'dnd'}
        showDot
        ring="var(--warm-800)"
      />
    </span>

    <span class="profile-card-identity">
      <Ellipsis class="profile-card-name" text={person.name} tag="span" />
      {#if person.login}
        <Ellipsis class="profile-card-handle" text={`@${person.login}`} tag="span" />
      {/if}
    </span>

    {#if friendsSinceLabel}
      <span class="profile-card-since">
        <span class="profile-card-since-label">Знакомы с</span>
        <span class="profile-card-since-value">{friendsSinceLabel}</span>
      </span>
    {/if}

    {#if relationship === 'self'}
      <!-- Identity only: social actions against your own account are invalid. -->
    {:else if relationship === 'unavailable'}
      <p class="profile-card-note">Гость комнаты — профиль и дружба недоступны.</p>
    {:else}
      <div class="profile-card-actions">
        {#if relationship === 'friend'}
          <button class="profile-card-action profile-card-action--primary" type="button" disabled={busy} onclick={onMessage}>
            <MessageSquare {...iconMd} aria-hidden="true" />
            Написать
          </button>
          <button class="profile-card-action profile-card-action--danger" type="button" disabled={busy} onclick={onRemoveFriend}>
            <UserMinus {...iconMd} aria-hidden="true" />
            Удалить из друзей
          </button>
        {:else if relationship === 'incoming'}
          <button class="profile-card-action profile-card-action--primary" type="button" disabled={busy} onclick={onAcceptRequest}>
            <Check {...iconMd} aria-hidden="true" />
            Принять заявку
          </button>
        {:else if relationship === 'outgoing'}
          <p class="profile-card-note">Заявка в друзья уже отправлена.</p>
        {:else}
          <button class="profile-card-action profile-card-action--friendly" type="button" disabled={busy} onclick={onAddFriend}>
            <UserPlus {...iconMd} aria-hidden="true" />
            Добавить в друзья
          </button>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .profile-card {
    width: min(320px, calc(100vw - 28px));
    overflow: hidden;
    border-radius: 20px;
  }

  .profile-card-cover {
    height: 88px;
    background: linear-gradient(
      135deg,
      color-mix(in oklch, var(--profile-accent), var(--warm-950) 22%),
      color-mix(in oklch, var(--profile-accent), var(--warm-950) 58%)
    );
  }

  .profile-card-body {
    display: flex;
    flex-direction: column;
    gap: 16px;
    /* Pulls the avatar up so it straddles the cover edge. */
    margin-top: -42px;
    padding: 0 4px 4px;
  }

  .profile-card-avatar {
    display: inline-flex;
    border-radius: 50%;
    box-shadow: 0 0 0 5px var(--warm-800);
  }

  .profile-card-identity {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 2px;
  }

  :global(.profile-card-name) {
    color: var(--warm-ink);
    font-family: var(--font-display, var(--font-ui));
    font-size: 22px;
    font-weight: 700;
    letter-spacing: -0.02em;
  }

  :global(.profile-card-handle) {
    color: var(--warm-muted-dim);
    font-family: var(--font-mono);
    font-size: 12.5px;
  }

  .profile-card-since {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .profile-card-since-label {
    color: var(--warm-faint);
    font-family: var(--font-mono);
    font-size: 10.5px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .profile-card-since-value {
    color: var(--warm-muted);
    font-size: 13.5px;
  }

  .profile-card-note {
    margin: 0;
    color: var(--warm-faint);
    font-size: 13px;
    line-height: 1.5;
  }

  .profile-card-actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .profile-card-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 9px;
    height: 46px;
    border: 1px solid transparent;
    border-radius: 16px;
    background: var(--control);
    color: var(--warm-ink);
    font-family: var(--font-ui);
    font-size: 14.5px;
    font-weight: 800;
    cursor: pointer;
    transition: background 0.14s ease, border-color 0.14s ease;
  }

  .profile-card-action:disabled {
    cursor: default;
    opacity: 0.6;
  }

  .profile-card-action--primary {
    background: var(--accent);
    color: var(--accent-ink);
  }

  .profile-card-action--primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .profile-card-action--friendly {
    background: color-mix(in oklch, var(--green), transparent 84%);
    border-color: color-mix(in oklch, var(--green), transparent 62%);
    color: var(--green);
  }

  .profile-card-action--friendly:hover:not(:disabled) {
    background: color-mix(in oklch, var(--green), transparent 74%);
  }

  .profile-card-action--danger {
    background: color-mix(in oklch, var(--coral), transparent 86%);
    color: var(--coral);
    font-weight: 700;
  }

  .profile-card-action--danger:hover:not(:disabled) {
    background: color-mix(in oklch, var(--coral), transparent 76%);
  }
</style>
