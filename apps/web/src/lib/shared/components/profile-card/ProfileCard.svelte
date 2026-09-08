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

  // The card itself takes the person's avatar colour, washed into the surface
  // from the top, so it reads as theirs even when they use a photo — where the
  // accent would otherwise be invisible. A separate banner band above the
  // content only added a shape to explain.
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

<div class="profile-card" data-profile-card style:--profile-accent={accent}>
  <div class="profile-card-body">
    <span class="profile-card-avatar">
      <Avatar
        name={person.name}
        src={person.avatarUrl}
        colorKey={person.avatarColorKey}
        background={person.avatarAccent || undefined}
        size={72}
        online={person.presence === 'online'}
        afk={person.presence === 'away'}
        dnd={person.presence === 'dnd'}
        showDot
        ring="var(--profile-surface)"
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
  /* One padding value all round, and one rhythm: lines that belong together sit
     tight, groups are separated by a single larger step. */
  .profile-card {
    --profile-surface: color-mix(in oklch, var(--profile-accent), var(--warm-900) 88%);
    --profile-pad: 20px;
    --profile-group-gap: 18px;
    width: min(320px, calc(100vw - 28px));
    overflow: hidden;
    border-radius: 20px;
    background: linear-gradient(
      180deg,
      color-mix(in oklch, var(--profile-accent), var(--warm-900) 72%),
      var(--profile-surface) 180px
    );
  }

  .profile-card-body {
    display: flex;
    flex-direction: column;
    gap: var(--profile-group-gap);
    padding: var(--profile-pad);
  }

  .profile-card-avatar {
    display: inline-flex;
    align-self: flex-start;
    border-radius: 50%;
    box-shadow: 0 0 0 4px color-mix(in oklch, var(--profile-accent), var(--warm-900) 72%);
  }

  /* The name and the handle are one thing said twice, so they read as a block. */
  .profile-card-identity {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 3px;
    /* Closer to the face than to the next group. */
    margin-top: calc(4px - var(--profile-group-gap));
  }

  :global(.profile-card-name) {
    color: var(--warm-ink);
    font-family: var(--font-display, var(--font-ui));
    font-size: 21px;
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
    gap: 3px;
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
    color: var(--warm-muted-dim);
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
    height: 44px;
    border: 1px solid transparent;
    border-radius: 14px;
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
