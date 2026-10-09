<script lang="ts">
  import EmojiText from '$lib/shared/chat/EmojiText.svelte';
  // The panel you reach from the bell. It answers two questions — what happened
  // and how long ago — and offers exactly one bulk action. "К первому
  // непрочитанному" is gone: every unread row is already one click away, and
  // the two buttons together overflowed the header into a horizontal scrollbar.
  import { Bell, Check, CircleAlert, X } from '@lucide/svelte';
  import { iconSm } from '$lib/shared/ui/icons';
  import type { NotificationItem, NotificationReason } from '@voice-room/shared/notifications';
  import type { createNotificationInbox } from '$lib/shared/notifications/inbox.svelte';

  type Inbox = ReturnType<typeof createNotificationInbox>;

  let {
    inbox,
    onopen,
    onclose,
    roomLabel
  }: {
    inbox: Inbox;
    onopen: (item: NotificationItem) => void;
    onclose?: () => void;
    /** Name of the room a notification came from. */
    roomLabel?: (roomId: string) => string;
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

  // Escape closes the panel, unless it belongs to something above it: an open
  // modal dialog (settings over the panel) or a handler that took the key. The
  // room keeps its guest-name and screen-source dialogs mounted but hidden.
  function onWindowKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    const modals = document.querySelectorAll('[aria-modal="true"]');
    if ([...modals].some((modal) => !modal.closest('[hidden]'))) return;
    onclose?.();
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

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
        <span class="notification-inbox-glyph notification-inbox-glyph--error"
          ><CircleAlert size={20} aria-hidden="true" /></span
        >
        <p role="alert">{inbox.error}</p>
        <button class="notification-inbox-retry" type="button" onclick={() => void inbox.load()}>Повторить</button>
      </div>
    {:else if inbox.loading && inbox.items.length === 0}
      <div class="notification-inbox-skeleton">
        {#each [72, 58, 84, 64] as width, index (index)}
          <div class="notification-inbox-skeleton-row" aria-hidden="true">
            <span class="notification-inbox-dot notification-inbox-dot--skeleton"></span>
            <span class="notification-inbox-skeleton-lines">
              <span style:width={`${width}%`}></span>
              <span class="is-short"></span>
            </span>
          </div>
        {/each}
        <p>Загружаем…</p>
      </div>
    {:else if inbox.items.length === 0}
      <div class="notification-inbox-state">
        <span class="notification-inbox-glyph"><Bell size={20} aria-hidden="true" /></span>
        <p>Новых уведомлений нет</p>
      </div>
    {:else}
      <ul class="notification-inbox-list">
        {#each inbox.items as item (item.id)}
          {@const where = roomLabel?.(item.roomId)}
          <li class:unread={!item.readAt}>
            <button type="button" onclick={() => open(item)}>
              <span class="notification-inbox-dot" aria-hidden="true"></span>
              <span class="notification-inbox-text">
                <strong class:is-retracted={Boolean(item.retractedAt)}
                  ><EmojiText
                    text={item.retractedAt ? 'Сообщение недоступно' : item.body || 'Новое уведомление'}
                  /></strong
                >
                <small>
                  <span class="notification-inbox-reason">{reasonLabel(item.reasons)}</span>
                  {#if where}<span class="notification-inbox-room">{where}</span>{/if}
                  {#if timeAgo(item.createdAt)}
                    <span aria-hidden="true">·</span>
                    <span class="notification-inbox-time">{timeAgo(item.createdAt)}</span>
                  {/if}
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
          onclick={() => void inbox.load(true)}>{inbox.loading ? 'Загружаем…' : 'Показать ещё'}</button
        >
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
    gap: 8px;
    padding: 14px 12px 12px 18px;
    border-bottom: 1px solid var(--vr-line);
  }

  h2 {
    display: flex;
    min-width: 0;
    flex: 1;
    align-items: center;
    gap: 8px;
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  .notification-inbox-count {
    display: flex;
    min-width: 20px;
    height: 20px;
    align-items: center;
    justify-content: center;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--vr-accent);
    color: var(--vr-accent-ink);
    font-size: 11.5px;
    font-weight: 600;
  }

  .notification-inbox-tools {
    display: flex;
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
    color: var(--vr-text-2);
    font-family: var(--font-ui);
    font-size: 13px;
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
    transition:
      background 0.14s ease,
      color 0.14s ease;
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
    color: var(--vr-text-2);
    cursor: pointer;
    transition:
      background 0.14s ease,
      color 0.14s ease;
  }

  .notification-inbox-read-all:hover,
  .notification-inbox-read-all:focus-visible,
  .notification-inbox-dismiss:hover,
  .notification-inbox-dismiss:focus-visible {
    background: var(--vr-hover);
    color: var(--vr-text);
    outline: none;
  }

  /* The list scrolls, the panel does not. */
  .notification-inbox-body {
    min-height: 0;
    flex: 1 1 auto;
    overflow-x: hidden;
    overflow-y: auto;
  }

  .notification-inbox-list {
    display: grid;
    gap: 0;
    margin: 0;
    padding: 6px;
    list-style: none;
  }

  li button {
    display: flex;
    width: 100%;
    align-items: flex-start;
    gap: 12px;
    padding: 12px;
    border: 0;
    border-radius: 12px;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background 0.14s ease;
  }

  li button:hover,
  li button:focus-visible {
    background: var(--vr-hover);
    outline: none;
  }

  /* The unread marker is a dot in the gutter rather than a filled row. */
  .notification-inbox-dot {
    width: 8px;
    height: 8px;
    flex: none;
    margin-top: 6px;
    border-radius: 50%;
    background: transparent;
  }

  li.unread .notification-inbox-dot {
    background: var(--vr-accent);
  }

  .notification-inbox-dot--skeleton {
    background: var(--vr-surface-3);
  }

  .notification-inbox-text {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
    gap: 4px;
  }

  strong {
    overflow: hidden;
    overflow-wrap: anywhere;
    color: var(--vr-text-2);
    font-size: 14px;
    font-weight: 400;
    line-height: 1.4;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }

  li.unread strong {
    color: var(--vr-text);
    font-weight: 600;
  }

  strong.is-retracted {
    font-style: italic;
  }

  small {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    color: var(--vr-text-3);
    font-size: 12px;
  }

  .notification-inbox-reason {
    padding: 1px 7px;
    border-radius: 999px;
    background: var(--vr-hover);
    color: var(--vr-text-2);
    font-weight: 500;
  }

  li.unread .notification-inbox-reason {
    background: var(--vr-accent-soft);
    color: var(--vr-accent);
  }

  .notification-inbox-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 44px 24px;
    color: var(--vr-text-3);
    text-align: center;
  }

  .notification-inbox-glyph {
    display: grid;
    width: 44px;
    height: 44px;
    place-items: center;
    border-radius: 13px;
    background: var(--vr-surface-3);
  }

  .notification-inbox-glyph--error {
    background: var(--vr-danger-soft);
    color: var(--vr-danger);
  }

  .notification-inbox-state p {
    margin: 0;
    color: var(--vr-text-2);
    font-size: 14px;
  }

  .notification-inbox-skeleton {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
  }

  .notification-inbox-skeleton p {
    margin: 0;
    color: var(--vr-text-3);
    font-size: 13px;
    text-align: center;
  }

  .notification-inbox-skeleton-row {
    display: flex;
    gap: 12px;
    padding: 12px;
  }

  .notification-inbox-skeleton-lines {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 8px;
  }

  .notification-inbox-skeleton-lines span {
    display: block;
    height: 12px;
    border-radius: 6px;
    background: var(--vr-surface-3);
  }

  .notification-inbox-skeleton-lines .is-short {
    width: 40%;
    height: 10px;
    border-radius: 5px;
    opacity: 0.6;
  }

  .notification-inbox-retry,
  .notification-inbox-more {
    height: 36px;
    padding: 0 16px;
    border: 1px solid var(--vr-line-strong);
    border-radius: 10px;
    background: transparent;
    color: var(--vr-text);
    font-family: var(--font-ui);
    font-size: 13.5px;
    font-weight: 500;
    cursor: pointer;
  }

  .notification-inbox-more {
    width: calc(100% - 24px);
    height: 38px;
    margin: 2px 12px 12px;
    border-radius: 11px;
  }

  .notification-inbox-retry:hover,
  .notification-inbox-more:hover:not(:disabled) {
    background: var(--vr-hover);
  }

  .notification-inbox-more:disabled {
    cursor: default;
    opacity: 0.6;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
  }
</style>
