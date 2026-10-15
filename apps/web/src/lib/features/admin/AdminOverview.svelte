<script lang="ts">
  // What is happening now and today, the totals, and how the server is doing.
  // Refreshes itself every half minute while it is on screen.
  import { onMount } from 'svelte';
  import { fetchAdminOverview, type AdminOverview } from '$lib/api/admin';
  import AdminNotice from './AdminNotice.svelte';
  import { formatBytes, formatCount, formatMs, formatPercent, formatSince } from './format';
  import { loadFailure, type LoadFailure } from './load-state';

  let { onOpenReports }: { onOpenReports?: () => void } = $props();

  const REFRESH_MS = 30_000;

  let overview = $state<AdminOverview | null>(null);
  let failure = $state<LoadFailure | null>(null);
  let now = $state(Date.now());

  async function load(): Promise<void> {
    try {
      overview = await fetchAdminOverview();
      failure = null;
    } catch (cause) {
      failure = loadFailure(cause, 'Не удалось загрузить обзор');
    }
    now = Date.now();
  }

  onMount(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  });

  const system = $derived(overview?.system ?? null);
  const memoryPct = $derived(
    system && system.memTotalBytes > 0 ? (system.memUsedBytes / system.memTotalBytes) * 100 : null
  );
  const diskPct = $derived(
    system && system.diskTotalBytes && system.diskUsedBytes !== null
      ? (system.diskUsedBytes / system.diskTotalBytes) * 100
      : null
  );
</script>

{#snippet stat(label: string, value: string, hint = '')}
  <div class="admin-stat">
    <span class="admin-stat-value">{value}</span>
    <span class="admin-stat-label">{label}</span>
    {#if hint}<span class="admin-stat-hint">{hint}</span>{/if}
  </div>
{/snippet}

{#if failure && !overview}
  <AdminNotice {failure} onRetry={() => void load()} />
{:else if !overview}
  <p class="admin-loading" aria-busy="true">Загружаем…</p>
{:else}
  <section class="admin-block" aria-label="Сейчас">
    <h2>Сейчас</h2>
    <div class="admin-stats">
      {@render stat('аккаунтов онлайн', formatCount(overview.live.onlineAccounts))}
      {@render stat('гостевых подключений', formatCount(overview.live.guestConnections))}
      {@render stat('людей в войсе', formatCount(overview.live.voicePeers))}
      {@render stat('комнат с войсом', formatCount(overview.live.voiceRooms))}
    </div>
  </section>

  <section class="admin-block" aria-label="Сегодня">
    <h2>Сегодня</h2>
    <div class="admin-stats">
      {@render stat('активных аккаунтов', formatCount(overview.today.activeAccounts))}
      {@render stat('новых аккаунтов', formatCount(overview.today.newAccounts))}
      {@render stat('сообщений', formatCount(overview.today.messages))}
      {@render stat('заходов в войс', formatCount(overview.today.voiceJoins))}
      {@render stat('минут в войсе', formatCount(overview.today.voiceMinutes))}
    </div>
  </section>

  <section class="admin-block" aria-label="Всего">
    <h2>Всего</h2>
    <div class="admin-stats">
      {@render stat('аккаунтов', formatCount(overview.totals.accounts))}
      {@render stat('активны за 7 дней', formatCount(overview.totals.weeklyActive))}
      {@render stat('активны за 30 дней', formatCount(overview.totals.monthlyActive))}
      {@render stat('постоянных комнат', formatCount(overview.totals.staticRooms))}
      {@render stat('временных комнат', formatCount(overview.totals.temporaryRooms))}
      {@render stat('сообщений', formatCount(overview.totals.messages))}
    </div>
    {#if overview.openReports > 0}
      <p class="admin-reports">
        Открытых жалоб: <strong>{overview.openReports}</strong>
        {#if onOpenReports}<button type="button" class="admin-link" onclick={onOpenReports}>Посмотреть</button>{/if}
      </p>
    {/if}
  </section>

  <section class="admin-block" aria-label="Сервер">
    <h2>Сервер</h2>
    <div class="admin-stats">
      {@render stat(
        'процессор',
        formatPercent(system?.cpuPct ?? null),
        system ? `нагрузка ${system.load1.toFixed(2)}` : ''
      )}
      {@render stat(
        'память',
        formatPercent(memoryPct),
        system ? `${formatBytes(system.memUsedBytes)} из ${formatBytes(system.memTotalBytes)}` : ''
      )}
      {@render stat(
        'диск',
        formatPercent(diskPct),
        system ? `${formatBytes(system.diskUsedBytes)} из ${formatBytes(system.diskTotalBytes)}` : ''
      )}
      {@render stat('база данных', formatBytes(system?.dbBytes ?? null))}
      {@render stat(
        'память API',
        formatBytes(system?.apiRssBytes ?? null),
        system ? `задержка цикла ${formatMs(system.eventLoopP99Ms)}` : ''
      )}
      {@render stat('LiveKit', overview.livekit ? 'включён' : 'выключен')}
    </div>
    <p class="admin-meta">
      Версия {overview.version}, работает {formatSince(overview.startedAt, now)}{#if system}, замер {formatSince(
          system.at,
          now
        )} назад{:else}, замеров сервера ещё нет{/if}.
    </p>
  </section>
{/if}

<style>
  .admin-block {
    display: grid;
    gap: 10px;
  }

  .admin-block h2 {
    margin: 0;
    color: var(--vr-text-2);
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .admin-stats {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 10px;
  }

  .admin-stat {
    display: grid;
    gap: 2px;
    padding: 12px 14px;
    border: 1px solid var(--vr-line);
    border-radius: 12px;
    background: var(--vr-surface);
  }

  .admin-stat-value {
    color: var(--vr-text);
    font-size: 22px;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
  }

  .admin-stat-label {
    color: var(--vr-text-2);
    font-size: 12.5px;
  }

  .admin-stat-hint {
    color: var(--vr-text-3);
    font-size: 11.5px;
  }

  .admin-reports,
  .admin-meta,
  .admin-loading {
    margin: 0;
    color: var(--vr-text-2);
    font-size: 13px;
  }

  .admin-link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--vr-accent);
    font: inherit;
    cursor: pointer;
  }
</style>
