<script lang="ts">
  // One account in full: its numbers, the last 90 days, its rooms and
  // devices, what was reported about it, and what an administrator can do —
  // block, sign out everywhere, delete, give the official mark — with the log
  // of what administrators already did.
  import { onMount } from 'svelte';
  import { ArrowLeft, BadgeCheck } from '@lucide/svelte';
  import {
    blockAccount,
    cancelAccountDeletion,
    deleteAccount,
    fetchAccount,
    setAccountBadge,
    signOutAccount,
    unblockAccount,
    type AccountDetail,
    type BlockDuration
  } from '$lib/api/admin';
  import { loadAccountBadges } from '$lib/api/badges';
  import EmojiText from '$lib/shared/chat/EmojiText.svelte';
  import { AccountBadge, Avatar, Button, Dialog, Switch } from '$lib/shared/ui';
  import { iconSm } from '$lib/shared/ui/icons';
  import AccountBlockDialog from './AccountBlockDialog.svelte';
  import AccountDeleteDialog from './AccountDeleteDialog.svelte';
  import AdminNotice from './AdminNotice.svelte';
  import TimeChart from './charts/TimeChart.svelte';
  import { blockTerm, describeAction } from './accounts';
  import { formatAgo, formatCount, formatDate, formatDateTime, formatDay, formatMinutes } from './format';
  import { loadFailure, type LoadFailure } from './load-state';

  let { userId, onBack }: { userId: string; onBack: () => void } = $props();

  let detail = $state<AccountDetail | null>(null);
  let failure = $state<LoadFailure | null>(null);
  let actionError = $state('');
  let busy = $state(false);
  let dialog = $state<'block' | 'delete' | 'sign-out' | null>(null);
  let now = $state(Date.now());

  async function load(): Promise<void> {
    try {
      detail = await fetchAccount(userId);
      failure = null;
      now = Date.now();
    } catch (cause) {
      failure = loadFailure(cause, 'Не удалось загрузить аккаунт');
    }
  }

  onMount(() => {
    void load();
  });

  const message = (cause: unknown, fallback: string) =>
    cause instanceof Error && cause.message ? cause.message : fallback;

  /** Runs one action; the answer is the card as it is now. */
  async function run(action: () => Promise<AccountDetail>, fallback: string): Promise<string | null> {
    busy = true;
    actionError = '';
    try {
      detail = await action();
      now = Date.now();
      dialog = null;
      return null;
    } catch (cause) {
      return message(cause, fallback);
    } finally {
      busy = false;
    }
  }

  async function runInline(action: () => Promise<AccountDetail>, fallback: string): Promise<void> {
    actionError = (await run(action, fallback)) ?? '';
  }

  const confirmBlock = (input: { duration: BlockDuration; reason: string }) =>
    run(() => blockAccount(userId, input), 'Не удалось заблокировать');
  const confirmDelete = (input: { login: string; reason: string }) =>
    run(() => deleteAccount(userId, input), 'Не удалось удалить аккаунт');

  async function toggleOfficial(checked: boolean): Promise<void> {
    await runInline(() => setAccountBadge(userId, checked ? 'official' : null), 'Не удалось изменить отметку');
    // Names everywhere in this tab pick the mark up at once.
    await loadAccountBadges();
  }

  function onOfficialChange(checked: boolean): void {
    void toggleOfficial(checked);
  }

  const account = $derived(detail?.account ?? null);
  const name = $derived(account ? account.displayName || account.login : '');
  const days = $derived(detail?.days ?? []);
  const labels = $derived(days.map((day) => formatDay(day.day)));
  const activeInSpan = $derived(days.filter((day) => day.active).length);
  const minutes = (value: number) => formatMinutes(value);
  const clients = $derived(
    account
      ? [
          account.clients.desktopApp ? 'приложение' : '',
          account.clients.browser ? 'браузер' : '',
          account.clients.mobile ? 'телефон' : ''
        ].filter(Boolean)
      : []
  );
</script>

<div class="card-top">
  <Button variant="ghost" onclick={onBack}>
    {#snippet icon()}<ArrowLeft {...iconSm} aria-hidden="true" />{/snippet}
    Все аккаунты
  </Button>
</div>

{#if failure && !detail}
  <AdminNotice {failure} onRetry={() => void load()} />
{:else if !detail || !account}
  <p class="card-quiet" aria-busy="true">Загружаем…</p>
{:else}
  <header class="card-head">
    <Avatar
      {name}
      src={account.avatarUrl}
      colorKey={account.avatarColorKey}
      background={account.avatarAccent}
      size={64}
      showDot
      online={account.online}
    />
    <div class="card-identity">
      <h2><EmojiText text={name} /><AccountBadge userId={account.id} size={20} /></h2>
      <span class="card-login">@{account.login}</span>
      <span class="card-chips">
        {#if account.online}<span class="card-chip" data-tone="success">в сети</span>{/if}
        {#if account.admin}<span class="card-chip" data-tone="accent">администратор</span>{/if}
        {#if account.badge === 'official'}<span class="card-chip" data-tone="accent">официальный аккаунт</span>{/if}
        {#if account.status === 'blocked'}<span class="card-chip" data-tone="danger">заблокирован</span>{/if}
        {#if account.status === 'deleting'}<span class="card-chip" data-tone="danger">удаляется</span>{/if}
      </span>
    </div>
  </header>

  {#if detail.deletion}
    <div class="card-banner" data-tone="danger" role="status">
      <span>
        Удалится {formatDateTime(detail.deletion.scheduledFor)} —
        {detail.deletion.byAdmin ? 'по решению администратора' : 'по просьбе владельца'}.
      </span>
      {#if detail.deletion.byAdmin}
        <Button
          variant="outline"
          disabled={busy}
          onclick={() => void runInline(() => cancelAccountDeletion(userId), 'Не удалось отменить удаление')}
          >Отменить удаление</Button
        >
      {/if}
    </div>
  {/if}
  {#if detail.block && !detail.deletion?.byAdmin}
    <div class="card-banner" data-tone="danger" role="status">
      <span>
        Заблокирован {blockTerm(detail.block.until)}. Причина: {detail.block.reason}
      </span>
      <Button
        variant="outline"
        disabled={busy}
        onclick={() => void runInline(() => unblockAccount(userId), 'Не удалось разблокировать')}>Разблокировать</Button
      >
    </div>
  {/if}
  {#if actionError}<p class="card-error" role="alert">{actionError}</p>{/if}

  <section class="card-tiles" aria-label="Цифры">
    <div class="card-tile">
      <span class="card-tile-label">Регистрация</span><span class="card-tile-value"
        >{formatDate(account.createdAt)}</span
      >
    </div>
    <div class="card-tile">
      <span class="card-tile-label">Последний визит</span><span class="card-tile-value"
        >{account.online ? 'сейчас' : formatAgo(account.lastSeenAt, now)}</span
      >
    </div>
    <div class="card-tile">
      <span class="card-tile-label">Активных дней</span><span class="card-tile-value"
        >{formatCount(account.activeDays)}</span
      >
      <span class="card-tile-hint">{clients.length ? clients.join(', ') : 'нет данных о клиентах'}</span>
    </div>
    <div class="card-tile">
      <span class="card-tile-label">В войсе</span><span class="card-tile-value"
        >{formatMinutes(account.voiceMinutes)}</span
      >
    </div>
    <div class="card-tile">
      <span class="card-tile-label">Сообщений</span><span class="card-tile-value">{formatCount(account.messages)}</span>
    </div>
    <div class="card-tile">
      <span class="card-tile-label">Комнаты</span><span class="card-tile-value">{formatCount(account.ownedRooms)}</span>
      <span class="card-tile-hint">своих · участник в {formatCount(detail.memberOf)}</span>
    </div>
    <div class="card-tile">
      <span class="card-tile-label">Жалобы на аккаунт</span><span
        class="card-tile-value"
        data-alert={detail.reports.againstOpen > 0}>{formatCount(detail.reports.against)}</span
      >
      <span class="card-tile-hint"
        >{detail.reports.againstOpen ? `открытых: ${detail.reports.againstOpen}` : 'открытых нет'} · от аккаунта: {formatCount(
          detail.reports.filed
        )}</span
      >
    </div>
  </section>

  <div class="card-charts">
    <TimeChart
      title="Сообщения за 90 дней"
      kind="bar"
      {labels}
      series={[{ name: 'Сообщения', values: days.map((day) => day.messages), color: 'var(--vr-accent)' }]}
      note={`Активных дней: ${activeInSpan} из ${days.length}.`}
    />
    <TimeChart
      title="Войс за 90 дней"
      kind="bar"
      {labels}
      format={minutes}
      series={[{ name: 'В войсе', values: days.map((day) => day.voiceMinutes), color: 'var(--vr-success)' }]}
    />
  </div>

  <div class="card-columns">
    <section class="card-box" aria-label="Комнаты">
      <h3>Свои постоянные комнаты</h3>
      {#if detail.ownedRooms.length === 0}
        <p class="card-quiet">Нет.</p>
      {:else}
        <ul class="card-list">
          {#each detail.ownedRooms as room (room.id)}
            <li><EmojiText text={room.name || 'Без названия'} /><span>{formatCount(room.members)} участн.</span></li>
          {/each}
        </ul>
      {/if}
    </section>
    <section class="card-box" aria-label="Устройства">
      <h3>Устройства со входом</h3>
      {#if detail.devices.length === 0}
        <p class="card-quiet">Ни одного открытого сеанса.</p>
      {:else}
        <ul class="card-list">
          {#each detail.devices as device, index (index)}
            <li>
              {[device.client || 'Неизвестный клиент', device.os].filter(Boolean).join(' · ')}
              <span>{formatAgo(device.lastSeenAt, now)}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </div>

  <section class="card-box" aria-label="Действия">
    <h3>Действия</h3>
    <div class="card-official">
      <BadgeCheck {...iconSm} aria-hidden="true" />
      <span>
        <strong>Официальный аккаунт VoiceRoom</strong>
        <small>Галочка у имени везде; только ему можно называться VoiceRoom.</small>
      </span>
      <Switch
        checked={account.badge === 'official'}
        disabled={busy}
        ariaLabel="Официальный аккаунт"
        onChange={onOfficialChange}
      />
    </div>
    {#if account.admin}
      <p class="card-quiet">Это аккаунт администратора: заблокировать, разлогинить или удалить его нельзя.</p>
    {:else}
      <div class="card-actions">
        {#if account.status === 'active'}
          <Button variant="outline" disabled={busy} onclick={() => (dialog = 'block')}>Заблокировать…</Button>
        {/if}
        <Button variant="outline" disabled={busy || detail.devices.length === 0} onclick={() => (dialog = 'sign-out')}
          >Разлогинить везде</Button
        >
        {#if !detail.deletion}
          <Button variant="danger-ghost" disabled={busy} onclick={() => (dialog = 'delete')}>Удалить аккаунт…</Button>
        {/if}
      </div>
    {/if}
  </section>

  <section class="card-box" aria-label="История действий">
    <h3>История действий администраторов</h3>
    {#if detail.actions.length === 0}
      <p class="card-quiet">Пока ничего.</p>
    {:else}
      <ol class="card-log">
        {#each detail.actions as entry (entry.id)}
          <li>
            <span class="card-log-what">{describeAction(entry)}</span>
            {#if entry.reason}<span class="card-log-reason">«{entry.reason}»</span>{/if}
            <span class="card-log-meta">{formatDateTime(entry.at)} · {entry.adminName}</span>
          </li>
        {/each}
      </ol>
    {/if}
  </section>

  <AccountBlockDialog open={dialog === 'block'} {name} onClose={() => (dialog = null)} onConfirm={confirmBlock} />
  <AccountDeleteDialog
    open={dialog === 'delete'}
    login={account.login}
    onClose={() => (dialog = null)}
    onConfirm={confirmDelete}
  />
  <div>
    <Dialog open={dialog === 'sign-out'} title="Разлогинить везде" onClose={() => (dialog = null)} width={420}>
      <div class="card-confirm">
        <p>
          Все сеансы <strong><EmojiText text={name} /></strong> завершатся, звонок прервётся. Войти снова можно будет с паролем
          — это не блокировка.
        </p>
        <div class="lr-dialog-actions">
          <Button variant="ghost" onclick={() => (dialog = null)}>Отмена</Button>
          <Button
            variant="danger"
            disabled={busy}
            onclick={() => void runInline(() => signOutAccount(userId), 'Не удалось завершить сеансы')}
            >Разлогинить</Button
          >
        </div>
      </div>
    </Dialog>
  </div>
{/if}

<style>
  .card-top {
    margin: -6px 0 -10px -10px;
  }

  .card-quiet {
    margin: 0;
    color: var(--vr-text-3);
    font-size: 13px;
  }

  .card-error {
    margin: 0;
    color: var(--vr-danger);
  }

  .card-head {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .card-identity {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  .card-identity h2 {
    display: flex;
    align-items: center;
    margin: 0;
    font-size: 22px;
    overflow-wrap: anywhere;
  }

  .card-login {
    color: var(--vr-text-3);
    font-family: var(--font-mono);
    font-size: 13px;
  }

  .card-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 4px;
  }

  .card-chip {
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 11.5px;
    font-weight: 600;
  }

  .card-chip[data-tone='accent'] {
    background: var(--vr-accent-soft);
    color: var(--vr-accent);
  }

  .card-chip[data-tone='danger'] {
    background: var(--vr-danger-soft);
    color: var(--vr-danger);
  }

  .card-chip[data-tone='success'] {
    background: var(--vr-surface-2);
    color: var(--vr-success);
  }

  .card-banner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px 16px;
    padding: 10px 14px;
    border-radius: 12px;
    background: var(--vr-danger-soft);
    color: var(--vr-text);
    font-size: 13.5px;
    overflow-wrap: anywhere;
  }

  .card-tiles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 160px), 1fr));
    gap: 10px;
  }

  .card-tile {
    display: grid;
    align-content: start;
    gap: 2px;
    min-width: 0;
    padding: 12px 14px;
    border: 1px solid var(--vr-line);
    border-radius: 14px;
    background: var(--vr-surface);
  }

  .card-tile-label {
    color: var(--vr-text-2);
    font-size: 12.5px;
  }

  .card-tile-value {
    color: var(--vr-text);
    font-size: 18px;
    white-space: nowrap;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .card-tile-value[data-alert='true'] {
    color: var(--vr-danger);
  }

  .card-tile-hint {
    color: var(--vr-text-3);
    font-size: 12px;
  }

  .card-charts,
  .card-columns {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 380px), 1fr));
    gap: 12px;
  }

  .card-box {
    display: grid;
    align-content: start;
    gap: 10px;
    padding: 14px 16px;
    border: 1px solid var(--vr-line);
    border-radius: 14px;
    background: var(--vr-surface);
  }

  .card-box h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
  }

  .card-list,
  .card-log {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 13.5px;
  }

  .card-list li {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    color: var(--vr-text);
  }

  .card-list li span {
    flex: none;
    color: var(--vr-text-3);
  }

  .card-official {
    display: flex;
    align-items: center;
    gap: 12px;
    color: var(--vr-accent);
  }

  .card-official span {
    display: grid;
    flex: 1;
    gap: 2px;
    color: var(--vr-text);
    font-size: 13.5px;
  }

  .card-official small {
    color: var(--vr-text-3);
    font-size: 12.5px;
  }

  .card-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .card-log li {
    display: grid;
    gap: 1px;
    padding: 8px 0;
    border-bottom: 1px solid var(--vr-line);
  }

  .card-log li:last-child {
    border-bottom: 0;
  }

  .card-log-what {
    color: var(--vr-text);
    font-weight: 600;
  }

  .card-log-reason {
    color: var(--vr-text-2);
    overflow-wrap: anywhere;
  }

  .card-log-meta {
    color: var(--vr-text-3);
    font-size: 12px;
  }

  .card-confirm {
    display: grid;
    gap: 14px;
  }

  .card-confirm p {
    margin: 0;
    color: var(--vr-text-2);
    font-size: 14px;
    line-height: 1.45;
  }
</style>
