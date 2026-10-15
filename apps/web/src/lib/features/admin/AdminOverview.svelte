<script lang="ts">
  // The dashboard of the whole panel: the headline numbers with how they moved,
  // two weeks of activity, the last day online, and how the server is doing.
  // Refreshes itself every half minute while it is on screen.
  import { onMount } from 'svelte';
  import { ArrowDownRight, ArrowUpRight, Flag } from '@lucide/svelte';
  import {
    fetchAdminOverview,
    fetchProductStats,
    fetchSystemStats,
    type AdminOverview,
    type ProductStats,
    type SystemStats
  } from '$lib/api/admin';
  import { iconSm } from '$lib/shared/ui/icons';
  import AdminNotice from './AdminNotice.svelte';
  import Sparkline from './charts/Sparkline.svelte';
  import TimeChart from './charts/TimeChart.svelte';
  import {
    formatBytes,
    formatCount,
    formatDay,
    formatHours,
    formatPercent,
    formatSampleTime,
    formatSince
  } from './format';
  import { loadFailure, type LoadFailure } from './load-state';
  import { PRODUCT_PRESETS, productQuery } from './time-range';

  let { onOpenReports }: { onOpenReports?: () => void } = $props();

  const REFRESH_MS = 30_000;
  const DAY = 24 * 60 * 60 * 1000;

  let overview = $state<AdminOverview | null>(null);
  let product = $state<ProductStats | null>(null);
  let system = $state<SystemStats | null>(null);
  let failure = $state<LoadFailure | null>(null);
  let now = $state(Date.now());

  async function load(): Promise<void> {
    const at = Date.now();
    try {
      const [nextOverview, nextProduct, nextSystem] = await Promise.all([
        fetchAdminOverview(),
        fetchProductStats(productQuery({ kind: 'preset', id: '14d' }, PRODUCT_PRESETS, at)),
        fetchSystemStats({ from: String(at - DAY), to: String(at) })
      ]);
      overview = nextOverview;
      product = nextProduct;
      system = nextSystem;
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

  const days = $derived(product?.days ?? []);
  const samples = $derived(system?.samples ?? []);
  const dayLabels = $derived(days.map((day) => formatDay(day.day)));
  const sampleLabels = $derived(samples.map((sample) => formatSampleTime(sample.at, false)));
  const today = $derived(days.at(-1) ?? null);
  const yesterday = $derived(days.at(-2) ?? null);
  const sum = (from: number, to: number, pick: (day: ProductStats['days'][number]) => number) =>
    days.slice(Math.max(0, from), Math.max(0, to)).reduce((total, day) => total + pick(day), 0);
  const newThisWeek = $derived(sum(days.length - 7, days.length, (day) => day.newAccounts));
  const newLastWeek = $derived(sum(days.length - 14, days.length - 7, (day) => day.newAccounts));
  const messages = (day: ProductStats['days'][number] | null) => (day ? day.roomMessages + day.directMessages : 0);
  const voiceHours = (day: ProductStats['days'][number] | null) =>
    day ? day.voiceAccountHours + day.voiceGuestHours : 0;

  const latest = $derived(overview?.system ?? null);
  const percent = (used: number | null, total: number | null) => (used !== null && total ? (used / total) * 100 : null);
  const gauges = $derived(
    latest
      ? [
          { label: 'Процессор', value: latest.cpuPct, detail: `нагрузка ${latest.load1.toFixed(2)}` },
          {
            label: 'Память',
            value: percent(latest.memUsedBytes, latest.memTotalBytes),
            detail: `${formatBytes(latest.memUsedBytes)} из ${formatBytes(latest.memTotalBytes)}`
          },
          {
            label: 'Диск',
            value: percent(latest.diskUsedBytes, latest.diskTotalBytes),
            detail: `${formatBytes(latest.diskUsedBytes)} из ${formatBytes(latest.diskTotalBytes)}`
          }
        ]
      : []
  );
  const level = (value: number | null) =>
    value === null ? 'unknown' : value >= 90 ? 'bad' : value >= 70 ? 'warn' : 'ok';
  const wholePercent = (value: number) => `${Math.round(value)}%`;
</script>

{#snippet delta(current: number, previous: number, unit: string)}
  {@const change = Math.round((current - previous) * 10) / 10}
  {#if change !== 0}
    <span class="kpi-delta" data-direction={change > 0 ? 'up' : 'down'}>
      {#if change > 0}<ArrowUpRight {...iconSm} aria-hidden="true" />{:else}<ArrowDownRight
          {...iconSm}
          aria-hidden="true"
        />{/if}
      {change > 0 ? '+' : ''}{change}
      {unit}
    </span>
  {:else}
    <span class="kpi-delta" data-direction="flat">без изменений</span>
  {/if}
{/snippet}

{#snippet kpi(
  label: string,
  value: string,
  hint: string,
  trend: readonly (number | null)[],
  color: string,
  change?: { current: number; previous: number; unit: string }
)}
  <div class="kpi">
    <span class="kpi-label">{label}</span>
    <span class="kpi-value">{value}</span>
    <span class="kpi-foot">
      {#if change}{@render delta(change.current, change.previous, change.unit)}{/if}
      {#if hint}<span class="kpi-hint">{hint}</span>{/if}
    </span>
    <Sparkline values={trend} {color} label={`${label}: как менялось`} />
  </div>
{/snippet}

{#if failure && !overview}
  <AdminNotice {failure} onRetry={() => void load()} />
{:else if !overview}
  <p class="dash-quiet" aria-busy="true">Загружаем…</p>
{:else}
  {#if overview.openReports > 0}
    <div class="dash-reports" role="status">
      <Flag {...iconSm} aria-hidden="true" />
      <span>Открытых жалоб: <strong>{overview.openReports}</strong></span>
      {#if onOpenReports}<button type="button" class="dash-link" onclick={onOpenReports}>Посмотреть</button>{/if}
    </div>
  {/if}

  <section class="kpis" aria-label="Главное">
    {@render kpi(
      'Онлайн сейчас',
      formatCount(overview.live.onlineAccounts),
      `и ${formatCount(overview.live.guestConnections)} гостевых подключений`,
      samples.map((sample) => sample.wsConnections),
      'var(--vr-accent)'
    )}
    {@render kpi(
      'В войсе сейчас',
      formatCount(overview.live.voicePeers),
      `в ${formatCount(overview.live.voiceRooms)} комнатах`,
      samples.map((sample) => sample.voicePeers),
      'var(--vr-success)'
    )}
    {@render kpi(
      'Активны сегодня',
      formatCount(overview.today.activeAccounts),
      `за 7 дней ${formatCount(overview.totals.weeklyActive)}, за 30 — ${formatCount(overview.totals.monthlyActive)}`,
      days.map((day) => day.activeAccounts),
      'var(--vr-accent)',
      { current: overview.today.activeAccounts, previous: yesterday?.activeAccounts ?? 0, unit: 'к вчера' }
    )}
    {@render kpi(
      'Новых за 7 дней',
      formatCount(newThisWeek),
      `всего аккаунтов ${formatCount(overview.totals.accounts)}`,
      days.map((day) => day.newAccounts),
      'var(--vr-info)',
      { current: newThisWeek, previous: newLastWeek, unit: 'к прошлой неделе' }
    )}
    {@render kpi(
      'Сообщений сегодня',
      formatCount(overview.today.messages),
      `всего ${formatCount(overview.totals.messages)}`,
      days.map((day) => messages(day)),
      'var(--vr-info)',
      { current: messages(today), previous: messages(yesterday), unit: 'к вчера' }
    )}
    {@render kpi(
      'Часов в войсе сегодня',
      formatHours(voiceHours(today)),
      `${formatCount(overview.today.voiceJoins)} заходов`,
      days.map((day) => voiceHours(day)),
      'var(--vr-success)',
      { current: voiceHours(today), previous: voiceHours(yesterday), unit: 'ч к вчера' }
    )}
  </section>

  <div class="dash-charts">
    <TimeChart
      title="Активность за 14 дней"
      labels={dayLabels}
      series={[
        { name: 'Активные аккаунты', values: days.map((day) => day.activeAccounts), color: 'var(--vr-accent)' },
        { name: 'В войсе', values: days.map((day) => day.voiceAccounts), color: 'var(--vr-success)' },
        { name: 'Новые', values: days.map((day) => day.newAccounts), color: 'var(--vr-info)' }
      ]}
    />
    <TimeChart
      title="Онлайн за сутки"
      labels={sampleLabels}
      series={[
        {
          name: 'Вкладки и приложения',
          values: samples.map((sample) => sample.wsConnections),
          color: 'var(--vr-accent)'
        },
        { name: 'Гости', values: samples.map((sample) => sample.guestConnections), color: 'var(--vr-warning)' },
        { name: 'В войсе', values: samples.map((sample) => sample.voicePeers), color: 'var(--vr-success)' }
      ]}
    />
  </div>

  <section class="dash-server" aria-label="Сервер">
    <div class="dash-server-head">
      <h2>Сервер</h2>
      <span class="dash-chip" data-state={overview.livekit ? 'ok' : 'bad'}>
        LiveKit {overview.livekit ? 'работает' : 'выключен'}
      </span>
      <span class="dash-quiet">
        Версия {overview.version} · работает {formatSince(overview.startedAt, now)}{#if latest}
          · замер {formatSince(latest.at, now)} назад{:else}
          · замеров ещё нет{/if}
      </span>
    </div>
    <div class="dash-server-body">
      <div class="gauges">
        {#each gauges as gauge (gauge.label)}
          <div class="gauge" data-level={level(gauge.value)}>
            <span class="gauge-head"><span>{gauge.label}</span><strong>{formatPercent(gauge.value)}</strong></span>
            <span class="gauge-bar"><span style:width="{Math.min(100, gauge.value ?? 0)}%"></span></span>
            <span class="gauge-detail">{gauge.detail}</span>
          </div>
        {/each}
        <div class="gauge-facts">
          <span>База <strong>{formatBytes(latest?.dbBytes ?? null)}</strong></span>
          <span>Память API <strong>{formatBytes(latest?.apiRssBytes ?? null)}</strong></span>
        </div>
      </div>
      <TimeChart
        title="Нагрузка за сутки"
        labels={sampleLabels}
        format={wholePercent}
        height={150}
        series={[
          { name: 'Процессор', values: samples.map((sample) => sample.cpuPct), color: 'var(--vr-accent)' },
          {
            name: 'Память',
            values: samples.map((sample) => percent(sample.memUsedBytes, sample.memTotalBytes)),
            color: 'var(--vr-warning)'
          }
        ]}
      />
    </div>
  </section>
{/if}

<style>
  .dash-quiet {
    margin: 0;
    color: var(--vr-text-3);
    font-size: 12.5px;
  }

  .dash-reports {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    border: 1px solid var(--vr-danger-soft);
    border-radius: 12px;
    background: var(--vr-danger-soft);
    color: var(--vr-text);
    font-size: 13.5px;
  }

  .dash-link {
    margin-left: auto;
    padding: 0;
    border: 0;
    background: none;
    color: var(--vr-accent);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }

  .kpis {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr));
    gap: 12px;
  }

  .kpi {
    display: grid;
    gap: 4px;
    min-width: 0;
    padding: 14px 16px 12px;
    border: 1px solid var(--vr-line);
    border-radius: 14px;
    background: var(--vr-surface);
  }

  .kpi-label {
    color: var(--vr-text-2);
    font-size: 12.5px;
  }

  .kpi-value {
    color: var(--vr-text);
    font-size: 30px;
    font-weight: 700;
    line-height: 1.1;
    font-variant-numeric: tabular-nums;
  }

  .kpi-foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
    min-height: 18px;
    font-size: 12px;
  }

  .kpi-hint {
    color: var(--vr-text-3);
  }

  .kpi-delta {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .kpi-delta[data-direction='up'] {
    color: var(--vr-success);
  }

  .kpi-delta[data-direction='down'] {
    color: var(--vr-danger);
  }

  .kpi-delta[data-direction='flat'] {
    color: var(--vr-text-3);
    font-weight: 500;
  }

  .dash-charts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr));
    gap: 12px;
  }

  .dash-server {
    display: grid;
    gap: 12px;
    padding: 14px 16px;
    border: 1px solid var(--vr-line);
    border-radius: 14px;
    background: var(--vr-surface);
  }

  .dash-server-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 12px;
  }

  .dash-server-head h2 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
  }

  .dash-chip {
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 11.5px;
    font-weight: 600;
  }

  .dash-chip[data-state='ok'] {
    background: color-mix(in srgb, var(--vr-success) 18%, transparent);
    color: var(--vr-success);
  }

  .dash-chip[data-state='bad'] {
    background: var(--vr-danger-soft);
    color: var(--vr-danger);
  }

  .dash-server-body {
    display: grid;
    grid-template-columns: minmax(220px, 1fr) minmax(0, 2fr);
    gap: 16px;
    align-items: start;
  }

  .dash-server-body :global(.chart) {
    padding: 0;
    border: 0;
  }

  .gauges {
    display: grid;
    gap: 12px;
  }

  .gauge {
    display: grid;
    gap: 5px;
  }

  .gauge-head {
    display: flex;
    justify-content: space-between;
    color: var(--vr-text-2);
    font-size: 12.5px;
  }

  .gauge-head strong {
    color: var(--vr-text);
    font-variant-numeric: tabular-nums;
  }

  .gauge-bar {
    display: block;
    height: 8px;
    overflow: hidden;
    border-radius: 999px;
    background: var(--vr-surface-3);
  }

  .gauge-bar span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--vr-success);
  }

  .gauge[data-level='warn'] .gauge-bar span {
    background: var(--vr-warning);
  }

  .gauge[data-level='bad'] .gauge-bar span {
    background: var(--vr-danger);
  }

  .gauge[data-level='unknown'] .gauge-bar span {
    background: var(--vr-text-3);
  }

  .gauge-detail {
    color: var(--vr-text-3);
    font-size: 11.5px;
  }

  .gauge-facts {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    color: var(--vr-text-2);
    font-size: 12.5px;
  }

  .gauge-facts strong {
    color: var(--vr-text);
  }

  @media (max-width: 760px) {
    .dash-server-body {
      grid-template-columns: 1fr;
    }
  }
</style>
