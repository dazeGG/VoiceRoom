<script lang="ts">
  // Who is in which room's voice right now, a card per room, refreshed every
  // few seconds, and the finished stays before, the latest first. Names,
  // accounts, times and the kind of client only: nothing said in a room. An
  // account opens its card; a room's name narrows the history to it.
  import { onMount } from 'svelte';
  import {
    AppWindow,
    ChevronLeft,
    ChevronRight,
    Globe,
    HeadphoneOff,
    MicOff,
    MonitorUp,
    Smartphone,
    X
  } from '@lucide/svelte';
  import {
    fetchLiveRooms,
    fetchRoomHistory,
    type LiveRoom,
    type LiveRoomPeer,
    type RoomAccount,
    type RoomHistory,
    type RoomStay
  } from '$lib/api/admin';
  import EmojiText from '$lib/shared/chat/EmojiText.svelte';
  import { AccountBadge, Avatar, Button } from '$lib/shared/ui';
  import AdminNotice from './AdminNotice.svelte';
  import { formatCount, formatDuration, formatSince, formatTimeSpan } from './format';
  import { loadFailure, type LoadFailure } from './load-state';
  import { deviceLabel, shortGuestId, shortIpKey } from './origin';

  let { onOpenAccount }: { onOpenAccount: (accountId: string) => void } = $props();

  const REFRESH_MS = 5000;

  let rooms = $state<LiveRoom[] | null>(null);
  let liveFailure = $state<LoadFailure | null>(null);
  let now = $state(Date.now());

  let stays = $state<RoomStay[]>([]);
  // The cursor each page opens with, the first one's empty; the API pages by
  // cursor, so a page already passed is only reached again through its own.
  let pageCursors = $state<(string | undefined)[]>([undefined]);
  let pageIndex = $state(0);
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

  async function loadHistory(index = 0): Promise<void> {
    historyLoading = true;
    // An answer for a room or page already left behind is dropped.
    const mine = ++historyRequest;
    try {
      const page: RoomHistory = await fetchRoomHistory({
        roomId: historyRoom?.id,
        after: index > 0 ? pageCursors[index] : undefined
      });
      if (mine !== historyRequest) return;
      stays = page.stays;
      pageIndex = index;
      pageCursors = [...pageCursors.slice(0, index + 1), ...(page.next ? [page.next] : [])];
      keepDays = page.keepDays;
      historyLoaded = true;
      historyFailure = null;
    } catch (cause) {
      if (mine === historyRequest) historyFailure = loadFailure(cause, 'Не удалось загрузить историю');
    } finally {
      if (mine === historyRequest) historyLoading = false;
    }
  }

  let historySection = $state<HTMLElement | null>(null);

  // A live room's name brings its history into view; a room already in the
  // history is narrowed in place.
  function showRoomHistory(room: { id: string; name: string | null } | null, scroll = false): void {
    historyRoom = room;
    pageCursors = [undefined];
    pageIndex = 0;
    void loadHistory();
    if (scroll) historySection?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }

  const CLIENTS: Record<NonNullable<LiveRoomPeer['client']>, { label: string; icon: typeof Globe }> = {
    desktop_app: { label: 'приложение', icon: AppWindow },
    browser: { label: 'браузер', icon: Globe },
    mobile: { label: 'телефон', icon: Smartphone }
  };

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
  const hasNextPage = $derived(pageCursors.length > pageIndex + 1);
</script>

{#snippet accountLink(account: RoomAccount)}
  <button type="button" class="rooms-account" onclick={() => onOpenAccount(account.id)}>
    <EmojiText text={nameOf(account)} /><AccountBadge userId={account.id} />
    <span class="rooms-login">@{account.login}</span>
  </button>
{/snippet}

<!-- The device and the place, never the address: equal ip· keys are the same address. -->
{#snippet origin(seat: Pick<RoomStay, 'client' | 'os' | 'browser' | 'guestId' | 'ipKey' | 'location'>)}
  {@const device = deviceLabel(seat)}
  {#if device || seat.location || seat.ipKey || seat.guestId}
    <span class="rooms-origin">
      {#if device}<span>{device}</span>{/if}
      {#if seat.location}<span>{seat.location}</span>{/if}
      {#if seat.ipKey}<span class="rooms-code" title={`Ключ адреса ${seat.ipKey}`}>{shortIpKey(seat.ipKey)}</span>{/if}
      {#if seat.guestId}<span class="rooms-code" title={`Браузер гостя ${seat.guestId}`}
          >{shortGuestId(seat.guestId)}</span
        >{/if}
    </span>
  {/if}
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
    <ul class="rooms-live" aria-labelledby="rooms-live-title">
      {#each rooms as room (room.roomId)}
        <li class="rooms-card">
          <div class="rooms-card-head">
            <button
              type="button"
              class="rooms-card-name"
              title="Показать историю звонков этой комнаты"
              onclick={() => showRoomHistory({ id: room.roomId, name: room.name }, true)}
            >
              <EmojiText text={room.name} />
            </button>
            <span class="rooms-chip">{room.isStatic ? 'постоянная' : 'временная'}</span>
          </div>
          <div class="rooms-card-meta">
            <span>{formatCount(room.peers.length)} в звонке</span>
            {#if room.since}<span>{fresh(room.since) ? 'только начался' : `идёт ${formatSince(room.since, now)}`}</span
              >{/if}
            {#if room.owner}
              <span class="rooms-card-owner">владелец {@render accountLink(room.owner)}</span>
            {/if}
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
                {#if peer.client}
                  {@const client = CLIENTS[peer.client]}
                  <span class="rooms-client"><client.icon size={13} aria-hidden="true" />{client.label}</span>
                {/if}
                {@render origin(peer)}
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

<section class="rooms-section" aria-labelledby="rooms-history-title" bind:this={historySection}>
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
            <th scope="col">Вошёл — вышел</th>
            <th scope="col" class="is-number">Сколько</th>
            <th scope="col">Комната</th>
            <th scope="col">Кто</th>
            <th scope="col">Откуда</th>
          </tr>
        </thead>
        <tbody>
          {#each stays as stay (stay.id)}
            <tr>
              <td>{formatTimeSpan(stay.joinedAt, stay.leftAt)}</td>
              <td class="is-number">{formatDuration(stay.leftAt - stay.joinedAt)}</td>
              <td>
                <button
                  type="button"
                  class="rooms-room"
                  onclick={() => showRoomHistory({ id: stay.roomId, name: stay.roomName || null })}
                >
                  <!-- An unnamed temporary room goes by its code, and so does one that is gone. -->
                  {#if stay.roomName}<EmojiText text={stay.roomName} />{:else}<span class="rooms-code"
                      >{stay.roomId}</span
                    >{/if}
                </button>
                {#if stay.roomName === null}<span class="rooms-chip">удалена</span>{/if}
              </td>
              <td>
                {#if stay.account}{@render accountLink(stay.account)}{:else if stay.guestName}<span class="rooms-guest"
                    ><EmojiText text={stay.guestName} /></span
                  >
                  <span class="rooms-chip">гость</span>{:else}<span class="rooms-quiet">гость</span>{/if}
              </td>
              <td>{@render origin(stay)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#if pageIndex > 0 || hasNextPage}
      <nav class="rooms-pager" aria-label="Страницы истории">
        <Button
          variant="outline"
          disabled={historyLoading || pageIndex === 0}
          onclick={() => void loadHistory(pageIndex - 1)}
        >
          <ChevronLeft size={14} aria-hidden="true" />Назад
        </Button>
        <span class="rooms-quiet" aria-current="page">Страница {pageIndex + 1}</span>
        <Button
          variant="outline"
          disabled={historyLoading || !hasNextPage}
          onclick={() => void loadHistory(pageIndex + 1)}
        >
          Дальше<ChevronRight size={14} aria-hidden="true" />
        </Button>
      </nav>
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
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr));
    align-items: start;
    gap: 12px;
  }

  .rooms-card {
    display: grid;
    gap: 8px;
    min-width: 0;
    padding: 14px 16px;
    border: 1px solid var(--vr-line);
    border-radius: 14px;
    background: var(--vr-surface);
  }

  .rooms-card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    min-width: 0;
  }

  .rooms-card-name {
    min-width: 0;
    padding: 0;
    overflow: hidden;
    border: 0;
    background: none;
    color: var(--vr-text);
    font: inherit;
    font-size: 15px;
    font-weight: 700;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }

  .rooms-card-name:hover {
    color: var(--vr-accent);
  }

  .rooms-card-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 2px 12px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--vr-line);
    color: var(--vr-text-3);
    font-size: 12.5px;
  }

  .rooms-card-owner {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
  }

  .rooms-client {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--vr-text-3);
    font-size: 12px;
  }

  .rooms-code {
    font-family: var(--font-mono);
    font-weight: 400;
  }

  .rooms-origin {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 8px;
    color: var(--vr-text-3);
    font-size: 12px;
  }

  .rooms-chip {
    flex: none;
    padding: 1px 7px;
    border-radius: 999px;
    background: var(--vr-surface-3);
    color: var(--vr-text-2);
    font-size: 11px;
    font-weight: 600;
  }

  .rooms-table .rooms-chip {
    margin-left: 8px;
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

  .rooms-pager {
    display: flex;
    align-items: center;
    gap: 12px;
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
