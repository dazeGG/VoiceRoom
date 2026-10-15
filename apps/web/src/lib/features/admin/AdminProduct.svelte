<script lang="ts">
  // How the product changes day by day: people, messages, rooms, voice, peaks,
  // and whether newly registered accounts come back.
  import { onMount } from 'svelte';
  import { fetchProductStats, type ProductStats } from '$lib/api/admin';
  import AdminNotice from './AdminNotice.svelte';
  import TimeChart from './charts/TimeChart.svelte';
  import { formatDay, formatHours } from './format';
  import { loadFailure, type LoadFailure } from './load-state';
  import TimeRangePicker from './TimeRangePicker.svelte';
  import { PRODUCT_PRESETS, productQuery, type TimeRange } from './time-range';

  let range = $state<TimeRange>({ kind: 'preset', id: '30d' });
  let stats = $state<ProductStats | null>(null);
  let failure = $state<LoadFailure | null>(null);
  let loading = $state(false);
  let request = 0;

  async function load(next: TimeRange): Promise<void> {
    range = next;
    loading = true;
    // A slower answer for a range already left behind is dropped.
    const mine = ++request;
    try {
      const loaded = await fetchProductStats(productQuery(next, PRODUCT_PRESETS, Date.now()));
      if (mine !== request) return;
      stats = loaded;
      failure = null;
    } catch (cause) {
      if (mine === request) failure = loadFailure(cause, 'Не удалось загрузить статистику');
    } finally {
      if (mine === request) loading = false;
    }
  }

  function changeRange(next: TimeRange): void {
    void load(next);
  }

  const resolved = $derived(
    stats ? { from: Date.parse(`${stats.from}T12:00`), to: Date.parse(`${stats.to}T12:00`) } : null
  );

  onMount(() => {
    void load(range);
  });

  const days = $derived(stats?.days ?? []);
  const labels = $derived(days.map((day) => formatDay(day.day)));
  const pick = (key: keyof Omit<ProductStats['days'][number], 'day'>) => days.map((day) => day[key]);
  const totalAccounts = $derived.by(() => {
    let total = stats?.accountsBefore ?? 0;
    return days.map((day) => (total += day.newAccounts));
  });
  const trackingNote = $derived(
    stats ? `Учёт идёт с ${formatDay(stats.trackingSince)}.${stats.trackingSince.slice(0, 4)}.` : ''
  );
</script>

<div class="admin-toolbar">
  <TimeRangePicker value={range} presets={PRODUCT_PRESETS} withTime={false} onChange={changeRange} {resolved} />
  {#if loading && stats}<span class="admin-refreshing">Обновляем…</span>{/if}
</div>

{#if failure && !stats}
  <AdminNotice {failure} onRetry={() => void load(range)} />
{:else if !stats}
  <p class="admin-loading" aria-busy="true">Загружаем…</p>
{:else}
  <div class="admin-charts">
    <TimeChart
      title="Активные аккаунты"
      {labels}
      series={[
        { name: 'Всего', values: pick('activeAccounts'), color: 'var(--vr-accent)' },
        { name: 'Приложение', values: pick('desktopApp'), color: 'var(--vr-success)' },
        { name: 'Браузер', values: pick('browser'), color: 'var(--vr-info)' },
        { name: 'Телефон', values: pick('mobile'), color: 'var(--vr-warning)' }
      ]}
      note="Один аккаунт за день может зайти с нескольких клиентов. {trackingNote}"
    />
    <TimeChart
      title="Аккаунты"
      {labels}
      series={[{ name: 'Всего аккаунтов', values: totalAccounts, color: 'var(--vr-accent)' }]}
      note="Нарастающим итогом, включая позже удалённые."
    />
    <TimeChart
      title="Регистрации"
      kind="bar"
      {labels}
      series={[{ name: 'Новых аккаунтов', values: pick('newAccounts'), color: 'var(--vr-accent)' }]}
    />
    <TimeChart
      title="Сообщения"
      kind="bar"
      {labels}
      series={[
        { name: 'В комнатах', values: pick('roomMessages'), color: 'var(--vr-accent)' },
        { name: 'В личке', values: pick('directMessages'), color: 'var(--vr-info)' }
      ]}
      note="Включая удалённые позже. Гости пишут без аккаунта."
    />
    <TimeChart
      title="Созданные комнаты"
      kind="bar"
      {labels}
      series={[
        { name: 'Постоянные', values: pick('staticRoomsCreated'), color: 'var(--vr-accent)' },
        { name: 'Временные', values: pick('temporaryRoomsCreated'), color: 'var(--vr-warning)' }
      ]}
    />
    <TimeChart
      title="Часы в войсе"
      kind="bar"
      {labels}
      format={formatHours}
      series={[
        { name: 'Аккаунты', values: pick('voiceAccountHours'), color: 'var(--vr-success)' },
        { name: 'Гости', values: pick('voiceGuestHours'), color: 'var(--vr-warning)' }
      ]}
      note="Заход относится к дню, в который начался. {trackingNote}"
    />
    <TimeChart
      title="Заходы в войс"
      {labels}
      series={[
        { name: 'Заходов', values: pick('voiceJoins'), color: 'var(--vr-accent)' },
        { name: 'Аккаунтов в войсе', values: pick('voiceAccounts'), color: 'var(--vr-success)' }
      ]}
    />
    <TimeChart
      title="Пики онлайна за день"
      {labels}
      series={[
        { name: 'Аккаунтов', values: pick('peakOnline'), color: 'var(--vr-accent)' },
        { name: 'Гостей', values: pick('peakGuests'), color: 'var(--vr-warning)' },
        { name: 'В войсе', values: pick('peakVoicePeers'), color: 'var(--vr-success)' }
      ]}
      note="Наибольшее число одновременно за день, по замерам каждые 15 минут. {trackingNote}"
    />
  </div>

  <section class="admin-retention" aria-label="Возвращаемость">
    <h2>Возвращаемость по неделе регистрации</h2>
    {#if stats.retention.length === 0}
      <p class="admin-loading">Пока нет аккаунтов.</p>
    {:else}
      <div class="admin-table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Неделя</th>
              <th scope="col">Аккаунтов</th>
              <th scope="col">Вернулись на 1–7 день</th>
              <th scope="col">На 8–14 день</th>
              <th scope="col">На 15–30 день</th>
            </tr>
          </thead>
          <tbody>
            {#each stats.retention as week (week.week)}
              <tr>
                <td>с {formatDay(week.week)}</td>
                <td>{week.accounts}</td>
                <td>{week.returnedWeek1Pct}%</td>
                <td>{week.returnedWeek2Pct}%</td>
                <td>{week.returnedMonth1Pct}%</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
    <p class="admin-loading">
      Доля аккаунтов недели, которые снова заходили в этот промежуток после регистрации. {trackingNote} У более ранних недель
      проценты занижены.
    </p>
  </section>
{/if}

<style>
  .admin-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
  }

  .admin-refreshing,
  .admin-loading {
    margin: 0;
    color: var(--vr-text-3);
    font-size: 12.5px;
  }

  .admin-charts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr));
    gap: 12px;
  }

  .admin-retention {
    display: grid;
    gap: 10px;
  }

  .admin-retention h2 {
    margin: 0;
    color: var(--vr-text);
    font-size: 14px;
    font-weight: 600;
  }

  .admin-table-wrap {
    overflow-x: auto;
    border: 1px solid var(--vr-line);
    border-radius: 12px;
    background: var(--vr-surface);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }

  th,
  td {
    padding: 8px 12px;
    border-bottom: 1px solid var(--vr-line);
    text-align: right;
    white-space: nowrap;
  }

  th:first-child,
  td:first-child {
    text-align: left;
  }

  th {
    color: var(--vr-text-2);
    font-weight: 500;
  }

  tbody tr:last-child td {
    border-bottom: 0;
  }
</style>
