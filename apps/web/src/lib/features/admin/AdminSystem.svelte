<script lang="ts">
  // The server minute by minute, as the API recorded it: processor, memory,
  // disk, database, the API process, live connections and requests.
  import { onMount } from 'svelte';
  import { fetchSystemStats, type SystemRange, type SystemSample, type SystemStats } from '$lib/api/admin';
  import { SegmentControl } from '$lib/shared/ui';
  import AdminNotice from './AdminNotice.svelte';
  import TimeChart from './charts/TimeChart.svelte';
  import { formatBytes, formatMs, formatPercent, formatSampleTime } from './format';
  import { loadFailure, type LoadFailure } from './load-state';

  const RANGES: { value: SystemRange; label: string }[] = [
    { value: '6h', label: '6 часов' },
    { value: '24h', label: 'Сутки' },
    { value: '7d', label: 'Неделя' },
    { value: '30d', label: '30 дней' }
  ];
  const GB = 1024 ** 3;
  const MB = 1024 ** 2;

  let range = $state<SystemRange>('24h');
  let stats = $state<SystemStats | null>(null);
  let failure = $state<LoadFailure | null>(null);
  let loading = $state(false);

  async function load(next: SystemRange): Promise<void> {
    range = next;
    loading = true;
    try {
      const loaded = await fetchSystemStats(next);
      if (range !== next) return;
      stats = loaded;
      failure = null;
    } catch (cause) {
      if (range === next) failure = loadFailure(cause, 'Не удалось загрузить данные сервера');
    } finally {
      if (range === next) loading = false;
    }
  }

  function changeRange(next: SystemRange): void {
    void load(next);
  }

  onMount(() => {
    void load(range);
  });

  const samples = $derived(stats?.samples ?? []);
  const withDate = $derived(range === '7d' || range === '30d');
  const labels = $derived(samples.map((sample) => formatSampleTime(sample.at, withDate)));
  const scaled = (pick: (sample: SystemSample) => number | null, unit: number) =>
    samples.map((sample) => {
      const value = pick(sample);
      return value === null ? null : value / unit;
    });
  const gb = (value: number) => `${value.toFixed(1)} ГБ`;
  const mb = (value: number) => `${Math.round(value)} МБ`;
  const wholePercent = (value: number) => `${Math.round(value)}%`;
  const milliseconds = (value: number) => formatMs(value);
  const bucketNote = $derived(
    stats
      ? `Точка — ${stats.bucketSeconds >= 3600 ? `${stats.bucketSeconds / 3600} ч` : `${stats.bucketSeconds / 60} мин`}, показан максимум за этот отрезок.`
      : ''
  );
  const latest = $derived(samples.at(-1) ?? null);
</script>

<div class="admin-toolbar">
  <SegmentControl options={RANGES} value={range} onChange={changeRange} ariaLabel="Период" size="sm" />
  {#if loading && stats}<span class="admin-quiet">Обновляем…</span>{/if}
</div>

{#if failure && !stats}
  <AdminNotice {failure} onRetry={() => void load(range)} />
{:else if !stats}
  <p class="admin-quiet" aria-busy="true">Загружаем…</p>
{:else if samples.length === 0}
  <p class="admin-quiet">Замеров за этот период нет: сервер записывает их раз в минуту.</p>
{:else}
  {#if latest}
    <p class="admin-quiet">
      Сейчас: процессор {formatPercent(latest.cpuPct)}, память {formatBytes(latest.memUsedBytes)} из {formatBytes(
        latest.memTotalBytes
      )}, диск {formatBytes(latest.diskUsedBytes)} из {formatBytes(latest.diskTotalBytes)}, база {formatBytes(
        latest.dbBytes
      )}.
      {bucketNote}
    </p>
  {/if}
  <div class="admin-charts">
    <TimeChart
      title="Процессор"
      {labels}
      format={wholePercent}
      series={[{ name: 'Загрузка', values: samples.map((sample) => sample.cpuPct), color: 'var(--vr-accent)' }]}
      note="Весь сервер, все ядра."
    />
    <TimeChart
      title="Память сервера"
      {labels}
      format={gb}
      series={[
        { name: 'Занято', values: scaled((sample) => sample.memUsedBytes, GB), color: 'var(--vr-accent)' },
        { name: 'Всего', values: scaled((sample) => sample.memTotalBytes, GB), color: 'var(--vr-text-3)' }
      ]}
    />
    <TimeChart
      title="Диск"
      {labels}
      format={gb}
      series={[
        { name: 'Занято', values: scaled((sample) => sample.diskUsedBytes, GB), color: 'var(--vr-warning)' },
        { name: 'Всего', values: scaled((sample) => sample.diskTotalBytes, GB), color: 'var(--vr-text-3)' }
      ]}
    />
    <TimeChart
      title="База данных"
      {labels}
      format={mb}
      series={[{ name: 'Размер', values: scaled((sample) => sample.dbBytes, MB), color: 'var(--vr-info)' }]}
    />
    <TimeChart
      title="Процесс API"
      {labels}
      format={mb}
      series={[{ name: 'Память', values: scaled((sample) => sample.apiRssBytes, MB), color: 'var(--vr-accent)' }]}
    />
    <TimeChart
      title="Задержка API"
      {labels}
      format={milliseconds}
      series={[
        { name: 'Средний ответ', values: samples.map((sample) => sample.httpAvgMs), color: 'var(--vr-accent)' },
        {
          name: 'Задержка цикла (p99)',
          values: samples.map((sample) => sample.eventLoopP99Ms),
          color: 'var(--vr-warning)'
        }
      ]}
    />
    <TimeChart
      title="Подключения"
      {labels}
      series={[
        {
          name: 'Вкладки и приложения',
          values: samples.map((sample) => sample.wsConnections),
          color: 'var(--vr-accent)'
        },
        { name: 'Из них гостей', values: samples.map((sample) => sample.guestConnections), color: 'var(--vr-warning)' },
        { name: 'В войсе', values: samples.map((sample) => sample.voicePeers), color: 'var(--vr-success)' }
      ]}
    />
    <TimeChart
      title="Запросы"
      kind="bar"
      {labels}
      series={[
        {
          name: 'Успешные',
          values: samples.map((sample) => sample.httpRequests - sample.http5xx),
          color: 'var(--vr-accent)'
        },
        { name: 'Ошибки сервера (5xx)', values: samples.map((sample) => sample.http5xx), color: 'var(--vr-danger)' }
      ]}
    />
  </div>
{/if}

<style>
  .admin-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
  }

  .admin-quiet {
    margin: 0;
    color: var(--vr-text-2);
    font-size: 13px;
  }

  .admin-charts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr));
    gap: 12px;
  }
</style>
