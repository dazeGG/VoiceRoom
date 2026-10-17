<script lang="ts">
  // Who is in which room's voice right now, refreshed every few seconds, and
  // the finished stays before, the latest first. Names, accounts and times
  // only: nothing said in a room. An account opens its card; a room narrows
  // the history to it.
  import { onMount } from 'svelte';
  import { HeadphoneOff, MicOff, MonitorUp, X } from '@lucide/svelte';
  import {
    fetchLiveRooms,
    fetchRoomHistory,
    type LiveRoom,
    type RoomAccount,
    type RoomHistory,
    type RoomStay
  } from '$lib/api/admin';
  import EmojiText from '$lib/shared/chat/EmojiText.svelte';
  import { AccountBadge, Avatar, Button } from '$lib/shared/ui';
  import AdminNotice from './AdminNotice.svelte';
  import { formatCount, formatDateTime, formatMinutes, formatSince } from './format';
  import { loadFailure, type LoadFailure } from './load-state';

  let { onOpenAccount }: { onOpenAccount: (accountId: string) => void } = $props();

  const REFRESH_MS = 5000;

  let rooms = $state<LiveRoom[] | null>(null);
  let liveFailure = $state<LoadFailure | null>(null);
  let now = $state(Date.now());

  let stays = $state<RoomStay[]>([]);
  let next = $state<string | null>(null);
  let keepDays = $state<number | null>(null);
  let historyLoaded = $state(false);
  let historyFailure = $state<LoadFailure | null>(null);
  let historyLoading = $state(false);
  let historyRoom = $state<{ id: string; name: string | null } | null>(null);
  let historyRequest = 0;

  async function loadLive(): Promise<void> {
    try {
      const loaded = await fetchLiveRooms();
      rooms = loaded.rooms;
      liveFailure = null;
    } catch (cause) {
      liveFailure = loadFailure(cause, 'Не удалось загрузить комнаты');
    }
    now = Date.now();
  }

  async function loadHistory(more = false): Promise<void> {
    historyLoading = true;
    // An answer for a room already left behind is dropped.
    const mine = ++historyRequest;
    try {
      const page: RoomHistory = await fetchRoomHistory({
        roomId: historyRoom?.id,
        after: more ? (next ?? undefined) : undefined
      });
      if (mine !== historyRequest) return;
      stays = more ? [...stays, ...page.stays] : page.stays;
      next = page.next;
      keepDays = page.keepDays;
      historyLoaded = true;
      historyFailure = null;
    } catch (cause) {
      if (mine === historyRequest) historyFailure = loadFailure(cause, 'Не удалось загрузить историю');
    } finally {
      if (mine === historyRequest) historyLoading = false;
    }
  }

  function showRoomHistory(room: { id: string; name: string | null } | null): void {
    historyRoom = room;
    void loadHistory();
  }

  onMount(() => {
    void loadLive();
    void loadHistory();
    // A hidden tab does not ask; it catches up the moment it shows again.
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void loadLive();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  });

  const peopleInVoice = $derived((rooms ?? []).reduce((count, room) => count + room.peers.length, 0));
  const nameOf = (account: RoomAccount) => account.displayName || account.login;
  // Under a minute reads as just now, not as "0 мин".
  const fresh = (at: number) => now - at < 60_000;
</script>

{#snippet accountLink(account: RoomAccount)}
  <button type="button" class="rooms-account" onclick={() => onOpenAccount(account.id)}>
    <EmojiText text={nameOf(account)} /><AccountBadge userId={account.id} />
    <span class="rooms-login">@{account.login}</span>
  </button>
{/snippet}

<section class="rooms-section" aria-labelledby="rooms-live-title">
  <header class="rooms-head">
    <h2 id="rooms-live-title">Сейчас в звонках</h2>
    {#if rooms}
      <span class="rooms-quiet">
        {rooms.length ? `комнат: ${formatCount(rooms.length)}, людей: ${formatCount(peopleInVoice)}` : 'никого'} · обновляется
        каждые 5 с
      </span>
    {/if}
  </header>

  {#if liveFailure && !rooms}
    <AdminNotice failure={liveFailure} onRetry={() => void loadLive()} />
  {:else if !rooms}
    <p class="rooms-quiet" aria-busy="true">Загружаем…</p>
  {:else if rooms.length === 0}
    <p class="rooms-quiet">Сейчас никто не в звонке.</p>
  {:else}
    {#if liveFailure}<p class="rooms-error" role="alert">{liveFailure.message}</p>{/if}
    <ul class="rooms-live">
      {#each rooms as room (room.roomId)}
        <li class="rooms-card">
          <div class="rooms-card-head">
            <strong class="rooms-card-name"><EmojiText text={room.name} /></strong>
            <span class="rooms-chip">{room.isStatic ? 'постоянная' : 'временная'}</span>
            {#if room.since}<span class="rooms-quiet"
                >{fresh(room.since) ? 'только начался' : `идёт ${formatSince(room.since, now)}`}</span
              >{/if}
            <span class="rooms-card-actions">
              {#if room.owner}
                <span class="rooms-quiet">владелец</span>
                {@render accountLink(room.owner)}
              {/if}
              <Button variant="outline" onclick={() => showRoomHistory({ id: room.roomId, name: room.name })}
                >История</Button
              >
            </span>
          </div>
          <ul class="rooms-peers">
            {#each room.peers as peer (peer.peerId)}
              <li class="rooms-peer">
                <Avatar
                  name={peer.name}
                  src={peer.account?.avatarUrl ?? null}
                  colorKey={peer.account?.avatarColorKey ?? peer.avatarColorKey}
                  background={peer.account?.avatarAccent ?? null}
                  size={28}
                />
                {#if peer.account}
                  {@render accountLink(peer.account)}
                {:else}
                  <span class="rooms-guest"><EmojiText text={peer.name} /></span>
                  <span class="rooms-chip">гость</span>
                {/if}
                <span class="rooms-peer-state">
                  {#if peer.muted}<span title="Микрофон выключен" aria-label="Микрофон выключен"
                      ><MicOff size={14} aria-hidden="true" /></span
                    >{/if}
                  {#if peer.deafened}<span title="Звук выключен" aria-label="Звук выключен"
                      ><HeadphoneOff size={14} aria-hidden="true" /></span
                    >{/if}
                  {#if peer.screen}<span title="Показывает экран" aria-label="Показывает экран" data-tone="accent"
                      ><MonitorUp size={14} aria-hidden="true" /></span
                    >{/if}
                  {#if peer.joinedAt}<span class="rooms-quiet"
                      >{fresh(peer.joinedAt) ? 'только что' : formatSince(peer.joinedAt, now)}</span
                    >{/if}
                </span>
              </li>
            {/each}
          </ul>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<section class="rooms-section" aria-labelledby="rooms-history-title">
  <header class="rooms-head">
    <h2 id="rooms-history-title">История звонков</h2>
    {#if historyRoom}
      <button type="button" class="rooms-filter" onclick={() => showRoomHistory(null)}>
        {historyRoom.name ?? historyRoom.id}
        <X size={13} aria-label="Показать все комнаты" />
      </button>
    {/if}
  </header>

  {#if historyFailure && !historyLoaded}
    <AdminNotice failure={historyFailure} onRetry={() => void loadHistory()} />
  {:else if !historyLoaded}
    <p class="rooms-quiet" aria-busy="true">Загружаем…</p>
  {:else if stays.length === 0}
    <p class="rooms-quiet">Завершённых звонков пока нет.</p>
  {:else}
    {#if historyFailure}<p class="rooms-error" role="alert">{historyFailure.message}</p>{/if}
    <div class="rooms-table-wrap">
      <table class="rooms-table">
        <thead>
          <tr>
            <th scope="col">Вошёл</th>
            <th scope="col" class="is-number">Сколько</th>
            <th scope="col">Комната</th>
            <th scope="col">Кто</th>
          </tr>
        </thead>
        <tbody>
          {#each stays as stay (stay.id)}
            <tr>
              <td>{formatDateTime(stay.joinedAt)}</td>
              <td class="is-number">{formatMinutes((stay.leftAt - stay.joinedAt) / 60_000)}</td>
              <td>
                <button
                  type="button"
                  class="rooms-room"
                  onclick={() => showRoomHistory({ id: stay.roomId, name: stay.roomName })}
                >
                  {#if stay.roomName}<EmojiText text={stay.roomName} />{:else}<span class="rooms-quiet"
                      >удалённая комната</span
                    >{/if}
                </button>
              </td>
              <td>
                {#if stay.account}{@render accountLink(stay.account)}{:else}<span class="rooms-quiet">гость</span>{/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#if next}
      <Button variant="outline" disabled={historyLoading} onclick={() => void loadHistory(true)}>Показать ещё</Button>
    {/if}
  {/if}
  {#if keepDays}
    <p class="rooms-quiet">
      Комната у звонка хранится {keepDays} дней, потом остаётся только время для статистики. Имена гостей не сохраняются.
    </p>
  {/if}
</section>

<style>
  .rooms-section {
    display: grid;
    gap: 12px;
    min-width: 0;
  }

  .rooms-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 12px;
  }

  .rooms-head h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
  }

  .rooms-quiet {
    margin: 0;
    color: var(--vr-text-3);
    font-size: 12.5px;
  }

  .rooms-error {
    margin: 0;
    color: var(--vr-danger);
  }

  .rooms-live,
  .rooms-peers {
    display: grid;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .rooms-live {
    gap: 12px;
  }

  .rooms-card {
    display: grid;
    gap: 10px;
    padding: 12px 14px;
    border: 1px solid var(--vr-line);
    border-radius: 14px;
    background: var(--vr-surface);
  }

  .rooms-card-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
  }

  .rooms-card-name {
    min-width: 0;
    overflow: hidden;
    font-size: 14.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rooms-card-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: auto;
  }

  .rooms-chip {
    padding: 1px 7px;
    border-radius: 999px;
    background: var(--vr-surface-3);
    color: var(--vr-text-2);
    font-size: 11px;
    font-weight: 600;
  }

  .rooms-peers {
    gap: 2px;
  }

  .rooms-peer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    min-height: 36px;
    padding: 2px 0;
  }

  .rooms-peer-state {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin-left: auto;
    color: var(--vr-danger);
  }

  .rooms-peer-state [data-tone='accent'] {
    color: var(--vr-accent);
  }

  .rooms-guest {
    color: var(--vr-text);
    font-size: 13.5px;
    font-weight: 600;
  }

  .rooms-account,
  .rooms-room {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    min-width: 0;
    padding: 0;
    border: 0;
    background: none;
    color: var(--vr-text);
    font: inherit;
    font-size: 13.5px;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
  }

  .rooms-account:hover,
  .rooms-room:hover {
    text-decoration: underline;
  }

  .rooms-login {
    color: var(--vr-text-3);
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 400;
  }

  .rooms-filter {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 10px;
    border: 1px solid var(--vr-accent-line);
    border-radius: 999px;
    background: var(--vr-accent-soft);
    color: var(--vr-accent);
    font: inherit;
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
  }

  .rooms-table-wrap {
    overflow-x: auto;
    border: 1px solid var(--vr-line);
    border-radius: 14px;
    background: var(--vr-surface);
  }

  .rooms-table {
    width: 100%;
    min-width: 640px;
    border-collapse: collapse;
    font-size: 13.5px;
  }

  .rooms-table th,
  .rooms-table td {
    padding: 8px 12px;
    border-bottom: 1px solid var(--vr-line);
    color: var(--vr-text-2);
    text-align: left;
    white-space: nowrap;
  }

  .rooms-table th {
    padding-top: 10px;
    padding-bottom: 10px;
    color: var(--vr-text-3);
    font-size: 12px;
    font-weight: 600;
  }

  .rooms-table tbody tr:last-child td {
    border-bottom: 0;
  }

  .rooms-table .is-number {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
</style>
