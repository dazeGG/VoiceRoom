<script lang="ts">
  // The panel you reach from the bell. It answers two questions — what happened
  // and how long ago — and offers exactly one bulk action. "К первому
  // непрочитанному" is gone: every unread row is already one click away, and
  // the two buttons together overflowed the header into a horizontal scrollbar.
  import { Bell, Check, X } from '@lucide/svelte';
  import { iconSm } from '$lib/shared/ui/icons';
  import type { NotificationItem, NotificationReason } from '@voice-room/shared/notifications';
  import type { createNotificationInbox } from '$lib/shared/notifications/inbox.svelte';

  type Inbox = ReturnType<typeof createNotificationInbox>;

  let {
    inbox,
    onopen,
    onclose
  }: {
    inbox: Inbox;
    onopen: (item: NotificationItem) => void;
    onclose?: () => void;
  } = $props();

  const REASON_LABELS: Record<NotificationReason, string> = {
    mention: 'Упоминание',
    reply: 'Ответ'
  };

  function reasonLabel(reasons: NotificationReason[]): string {
    return reasons.map((reason) => REASON_LABELS[reason] ?? reason).join(' · ');
  }

  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;

  /** Coarse on purpose: the exact second of a mention has never mattered. */
  function timeAgo(value: unknown): string {
    const at = typeof value === 'number' ? value : Date.parse(String(value ?? ''));
    if (!Number.isFinite(at)) return '';
    const elapsed = Date.now() - at;
    if (elapsed < MINUTE) return 'только что';
    if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} мин назад`;
    if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} ч назад`;
    if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)} дн назад`;
    return new Date(at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  }

  function open(item: NotificationItem): void {
    void inbox.markRead(item.id);
    onopen(item);
  }
</script>

<section class="notification-inbox" aria-labelledby="notification-inbox-title">
  <header class="notification-inbox-head">
    <h2 id="notification-inbox-title">
      Уведомления
      {#if inbox.unreadCount}<span class="notification-inbox-count">{inbox.unreadCount}</span>{/if}
    </h2>
    <div class="notification-inbox-tools">
      {#if inbox.unreadCount}
        <button
          class="notification-inbox-read-all"
          type="button"
          title="Отметить все прочитанными"
          onclick={() => void inbox.markAllRead()}
        >
          <Check {...iconSm} aria-hidden="true" />
          <span>Прочитать все</span>
        </button>
      {/if}
      {#if onclose}
        <button class="notification-inbox-dismiss" type="button" aria-label="Закрыть" onclick={onclose}>
          <X {...iconSm} aria-hidden="true" />
        </button>
      {/if}
    </div>
  </header>

  <div aria-live="polite" class="sr-only">
    {inbox.loading ? 'Загрузка уведомлений' : `${inbox.unreadCount} непрочитанных`}
  </div>

  <div class="notification-inbox-body">
    {#if inbox.error}
      <div class="notification-inbox-state">
        <p role="alert">{inbox.error}</p>
        <button class="notification-inbox-retry" type="button" onclick={() => void inbox.load()}>Повторить</button>
      </div>
    {:else if inbox.loading && inbox.items.length === 0}
      <div class="notification-inbox-state"><p>Загружаем…</p></div>
    {:else if inbox.items.length === 0}
      <div class="notification-inbox-state notification-inbox-empty">
        <Bell size={22} aria-hidden="true" />
        <p>Новых уведомлений нет</p>
      </div>
    {:else}
      <ul class="notification-inbox-list">
        {#each inbox.items as item (item.id)}
          <li class:unread={!item.readAt}>
            <button type="button" onclick={() => open(item)}>
              <span class="notification-inbox-dot" aria-hidden="true"></span>
              <span class="notification-inbox-text">
                <strong>{item.retractedAt ? 'Сообщение недоступно' : item.body || 'Новое уведомление'}</strong>
                <small>
                  <span class="notification-inbox-reason">{reasonLabel(item.reasons)}</span>
                  {#if timeAgo(item.createdAt)}<span class="notification-inbox-time">{timeAgo(item.createdAt)}</span>{/if}
                </small>
              </span>
            </button>
          </li>
        {/each}
      </ul>
      {#if inbox.hasMore}
        <button
          class="notification-inbox-more"
          type="button"
          disabled={inbox.loading}
          onclick={() => void inbox.load(true)}
        >{inbox.loading ? 'Загружаем…' : 'Показать ещё'}</button>
      {/if}
    {/if}
  </div>
</section>

<style>
  .notification-inbox {
    display: flex;
    min-width: 0;
    max-height: inherit;
    flex-direction: column;
  }

  .notification-inbox-head {
    display: flex;
    flex: none;
    align-items: center;
    gap: 10px;
    padding: 14px 12px 12px 18px;
    border-bottom: 1px solid var(--line);
  }

  h2 {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 8px;
    margin: 0;
    font-size: 15px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }

  .notification-inbox-count {
    display: grid;
    min-width: 20px;
    height: 20px;
    place-items: center;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--coral);
    color: var(--paper-deep);
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 500;
  }

  .notification-inbox-tools {
    display: flex;
    margin-left: auto;
    align-items: center;
    gap: 4px;
  }

  .notification-inbox-read-all {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 10px;
    border: 0;
    border-radius: 9px;
    background: transparent;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: 12.5px;
    white-space: nowrap;
    cursor: pointer;
    transition: background 0.14s ease, color 0.14s ease;
  }

  .notification-inbox-dismiss {
    display: grid;
    width: 32px;
    height: 32px;
    flex: none;
    place-items: center;
    border: 0;
    border-radius: 9px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    transition: background 0.14s ease, color 0.14s ease;
  }

  .notification-inbox-read-all:hover,
  .notification-inbox-read-all:focus-visible,
  .notification-inbox-dismiss:hover,
  .notification-inbox-dismiss:focus-visible {
    background: color-mix(in oklch, var(--paper), var(--ink) 8%);
    color: var(--ink);
    outline: none;
  }

  /* The list scrolls, the panel does not: a header that overflowed used to give
     the whole panel a horizontal scrollbar. */
  .notification-inbox-body {
    min-height: 0;
    flex: 1 1 auto;
    padding: 6px;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .notification-inbox-list {
    display: grid;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li button {
    display: flex;
    width: 100%;
    align-items: flex-start;
    gap: 9px;
    padding: 10px 12px;
    border: 0;
    border-radius: 11px;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background 0.14s ease;
  }

  li button:hover,
  li button:focus-visible {
    background: color-mix(in oklch, var(--paper), var(--ink) 7%);
    outline: none;
  }

  /* The unread marker is a dot in the gutter rather than a filled row, so a
     screen of unread notifications does not read as one solid block. */
  .notification-inbox-dot {
    width: 7px;
    height: 7px;
    flex: none;
    margin-top: 6px;
    border-radius: 50%;
    background: transparent;
  }

  li.unread .notification-inbox-dot { background: var(--coral); }

  .notification-inbox-text {
    display: grid;
    min-width: 0;
    gap: 3px;
  }

  strong {
    overflow: hidden;
    color: var(--muted);
    font-size: 13.5px;
    font-weight: 600;
    line-height: 1.35;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }

  li.unread strong { color: var(--ink); }

  small {
    display: flex;
    align-items: center;
    gap: 7px;
    color: var(--muted);
    font-size: 11.5px;
  }

  .notification-inbox-reason {
    padding: 1px 7px;
    border-radius: 999px;
    background: color-mix(in oklch, var(--paper), var(--ink) 9%);
    font-size: 11px;
  }

  .notification-inbox-time { font-family: var(--font-mono); }

  .notification-inbox-state {
    display: grid;
    justify-items: center;
    gap: 10px;
    padding: 34px 18px;
    color: var(--muted);
    text-align: center;
  }

  .notification-inbox-empty { color: var(--warm-faint, var(--muted)); }

  .notification-inbox-state p { margin: 0; font-size: 13px; }

  .notification-inbox-retry,
  .notification-inbox-more {
    height: 34px;
    padding: 0 14px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: transparent;
    color: inherit;
    font-family: var(--font-ui);
    font-size: 12.5px;
    cursor: pointer;
  }

  .notification-inbox-more {
    width: calc(100% - 12px);
    margin: 6px;
  }

  .notification-inbox-retry:hover,
  .notification-inbox-more:hover:not(:disabled) {
    background: color-mix(in oklch, var(--paper), var(--ink) 7%);
  }

  .notification-inbox-more:disabled { cursor: default; opacity: 0.6; }

  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); }
</style>
