<script lang="ts">
  import { onMount } from 'svelte';
  import { Ban, Clock } from '@lucide/svelte';
  import type { ActiveBan } from '@voice-room/shared/moderation';
  import { fetchActiveBans } from '$lib/api/moderation';
  import { Avatar } from '$lib/shared/ui';
  import { iconMd, iconSm } from '$lib/shared/ui/icons';
  import {
    banExpiryLabel,
    banSubjectName,
    liftRoomBan,
    type ModerationNotice
  } from '../../model/room-moderation';

  // Active bans of one room, shown as the «Блокировки» section of the room
  // settings. Bans are placed from a member's menu; this list only lifts them.
  let { roomId, onNotify = () => {} }: {
    roomId: string;
    onNotify?: ModerationNotice;
  } = $props();

  let bans = $state<ActiveBan[]>([]);
  let nextCursor = $state<string>();
  let loading = $state(true);
  let loadingMore = $state(false);
  let error = $state('');
  let liftingId = $state('');

  async function load(reset = false): Promise<void> {
    if (reset) loading = true;
    else loadingMore = true;
    error = '';
    try {
      const page = await fetchActiveBans(roomId, { cursor: reset ? undefined : nextCursor });
      bans = reset ? page.bans : [...bans, ...page.bans.filter((ban) => !bans.some((item) => item.id === ban.id))];
      nextCursor = page.pageInfo.nextCursor;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Не удалось загрузить блокировки';
    } finally {
      loading = false;
      loadingMore = false;
    }
  }

  async function lift(ban: ActiveBan): Promise<void> {
    if (liftingId) return;
    liftingId = ban.id;
    try {
      if (await liftRoomBan(roomId, ban, onNotify)) bans = bans.filter((item) => item.id !== ban.id);
    } finally {
      liftingId = '';
    }
  }

  onMount(() => { void load(true); });
</script>

<section class="room-bans" aria-labelledby="room-bans-title" aria-busy={loading}>
  <header class="room-bans-head">
    <h3 class="room-bans-title" id="room-bans-title">
      Блокировки{#if !loading && !error}<span class="room-bans-count">{bans.length}{nextCursor ? '+' : ''}</span>{/if}
    </h3>
    <p>Заблокированные не могут зайти в комнату. Заблокировать участника можно через меню «⋯» во вкладке «Участники».</p>
  </header>

  {#if error}
    <div class="room-bans-error" role="alert">
      <span>{error}</span>
      <button type="button" onclick={() => load(true)}>Повторить</button>
    </div>
  {/if}

  {#if loading}
    <p class="room-bans-loading" aria-live="polite">Загружаем…</p>
  {:else if bans.length === 0 && !error}
    <div class="room-bans-empty">
      <span class="room-bans-empty-icon" aria-hidden="true"><Ban {...iconMd} /></span>
      <strong>Активных блокировок нет</strong>
      <span>Здесь появятся участники, которых вы заблокируете.</span>
    </div>
  {:else if bans.length > 0}
    <ul class="room-bans-list">
      {#each bans as ban (ban.id)}
        {@const name = banSubjectName(ban)}
        <li class="room-ban">
          <Avatar {name} src={ban.subject.profile?.avatarUrl ?? null} colorKey={ban.subject.profile?.avatarColorKey} size={36} />
          <div class="room-ban-body">
            <div class="room-ban-name">
              <strong>{name}</strong>
              {#if ban.subject.profile}<small>@{ban.subject.profile.login}</small>{/if}
            </div>
            <span class="room-ban-term" data-permanent={ban.expiresAt == null}>
              <Clock {...iconSm} aria-hidden="true" />{banExpiryLabel(ban)}
            </span>
            {#if ban.reason}<p class="room-ban-reason">{ban.reason}</p>{/if}
          </div>
          <button
            class="settings-unblock-button"
            type="button"
            aria-label={`Снять блокировку ${name}`}
            disabled={liftingId === ban.id}
            onclick={() => lift(ban)}
          >{liftingId === ban.id ? 'Снимаем…' : 'Разблокировать'}</button>
        </li>
      {/each}
    </ul>
    {#if nextCursor}
      <button class="room-bans-more" type="button" disabled={loadingMore} onclick={() => load(false)}>
        {loadingMore ? 'Загружаем…' : 'Показать ещё'}
      </button>
    {/if}
  {/if}
</section>

<style>
  .room-bans { display: grid; gap: 16px; color: var(--warm-ink); }
  .room-bans-head { display: grid; gap: 6px; }
  .room-bans-title { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 15px; font-weight: 700; }
  .room-bans-count { padding: 1px 8px; border-radius: var(--radius-pill, 999px); background: var(--control); color: var(--warm-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
  .room-bans-head p { margin: 0; color: var(--warm-faint); font-size: 12.5px; line-height: 1.5; }
  .room-bans-error { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; border-radius: 10px; background: color-mix(in oklch, var(--coral) 12%, transparent); color: var(--coral); font-size: 13px; }
  .room-bans-error button { flex: none; border: 0; background: transparent; color: inherit; font: 700 13px var(--font-ui); cursor: pointer; }
  .room-bans-loading { margin: 0; color: var(--warm-faint); font-size: 13px; }
  .room-bans-empty { display: grid; justify-items: center; gap: 6px; padding: 28px 16px; border: 1px dashed rgba(255, 255, 255, 0.09); border-radius: 14px; color: var(--warm-faint); font-size: 12.5px; text-align: center; }
  .room-bans-empty strong { color: var(--warm-ink-dim); font-size: 14px; }
  .room-bans-empty-icon { display: grid; width: 40px; height: 40px; margin-bottom: 4px; place-items: center; border-radius: 12px; background: var(--control); color: var(--warm-muted); }
  .room-bans-list { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; }
  .room-ban { display: grid; grid-template-columns: 36px minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 10px; border-radius: 12px; }
  .room-ban:hover { background: var(--control); }
  .room-ban-body { display: grid; gap: 3px; min-width: 0; }
  .room-ban-name { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
  .room-ban-name strong, .room-ban-name small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .room-ban-name strong { font-size: 14px; }
  .room-ban-name small { color: var(--warm-faint); font-size: 12px; }
  .room-ban-term { display: inline-flex; align-items: center; gap: 5px; color: var(--warm-muted); font-size: 12px; }
  .room-ban-term[data-permanent='true'] { color: var(--coral); }
  .room-ban-reason { margin: 0; color: var(--warm-faint); font-size: 12px; line-height: 1.4; overflow-wrap: anywhere; }
  .room-bans-more { justify-self: stretch; min-height: 38px; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 10px; background: transparent; color: var(--warm-ink-dim); font: 600 13px var(--font-ui); cursor: pointer; }
  .room-bans-more:hover:not(:disabled) { background: var(--control); }
  .room-bans-more:disabled { cursor: default; opacity: 0.6; }
  @media (max-width: 520px) {
    .room-ban { grid-template-columns: 36px minmax(0, 1fr); }
    .room-ban :global(.settings-unblock-button) { grid-column: 2; justify-self: start; }
  }
</style>
