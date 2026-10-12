<script lang="ts">
  import { Check, MessageSquare, UserMinus, UserPlus } from '@lucide/svelte';
  import { Avatar, Button, Ellipsis } from '$lib/shared/ui';
  import { iconSm } from '$lib/shared/ui/icons';
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
  // accent would otherwise be invisible.
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
        showDot={relationship !== 'unavailable'}
        ring="var(--vr-surface-2)"
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
    {:else if relationship === 'outgoing'}
      <p class="profile-card-note">Заявка в друзья уже отправлена.</p>
    {:else}
      <div class="profile-card-actions">
        {#if relationship === 'friend'}
          <Button variant="primary" disabled={busy} onclick={onMessage}>
            {#snippet icon()}<MessageSquare {...iconSm} aria-hidden="true" />{/snippet}
            Написать
          </Button>
          <Button variant="danger-ghost" disabled={busy} onclick={onRemoveFriend}>
            {#snippet icon()}<UserMinus {...iconSm} aria-hidden="true" />{/snippet}
            Удалить из друзей
          </Button>
        {:else if relationship === 'incoming'}
          <Button variant="primary" disabled={busy} onclick={onAcceptRequest}>
            {#snippet icon()}<Check {...iconSm} aria-hidden="true" />{/snippet}
            Принять заявку
          </Button>
        {:else}
          <Button variant="soft" disabled={busy} onclick={onAddFriend}>
            {#snippet icon()}<UserPlus {...iconSm} aria-hidden="true" />{/snippet}
            Добавить в друзья
          </Button>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .profile-card {
    width: min(300px, calc(100vw - 28px));
    overflow: hidden;
    background: linear-gradient(
      180deg,
      color-mix(in oklch, var(--profile-accent) 30%, var(--vr-surface-2)) 0%,
      var(--vr-surface-2) 58%
    );
  }

  .profile-card-body {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 20px;
  }

  .profile-card-avatar {
    display: inline-flex;
    align-self: flex-start;
  }

  .profile-card-identity {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 2px;
  }

  :global(.profile-card-name) {
    color: var(--vr-text);
    font-size: 19px;
    font-weight: 600;
    letter-spacing: -0.02em;
  }

  :global(.profile-card-handle) {
    color: var(--vr-text-2);
    font-family: var(--font-mono);
    font-size: 12.5px;
  }

  .profile-card-since {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding-top: 14px;
    border-top: 1px solid var(--vr-line);
  }

  .profile-card-since-label {
    color: var(--vr-text-3);
    font-size: 12px;
  }

  .profile-card-since-value {
    color: var(--vr-text);
    font-size: 13.5px;
  }

  .profile-card-note {
    margin: 0;
    padding: 10px 12px;
    border-radius: 11px;
    background: var(--vr-hover);
    color: var(--vr-text-2);
    font-size: 13px;
    line-height: 1.45;
  }

  .profile-card-actions {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .profile-card-actions :global(.ui-button) {
    width: 100%;
  }
</style>
