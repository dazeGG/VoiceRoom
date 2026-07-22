<script lang="ts">
  import type { NotificationItem } from '@voice-room/shared/notifications';
  import type { createNotificationInbox } from '$lib/shared/notifications/inbox.svelte';
  type Inbox = ReturnType<typeof createNotificationInbox>;
  let { inbox, onopen }: { inbox: Inbox; onopen: (item: NotificationItem) => void } = $props();
</script>

<section class="notification-inbox" aria-labelledby="notification-inbox-title">
  <header><h2 id="notification-inbox-title">Уведомления</h2><div>{#if inbox.firstUnread}<button type="button" onclick={() => onopen(inbox.firstUnread!)}>К первому непрочитанному</button>{/if}<button type="button" disabled={!inbox.unreadCount} onclick={() => inbox.markAllRead()}>Прочитать все</button></div></header>
  <div aria-live="polite" class="sr-only">{inbox.loading ? 'Загрузка уведомлений' : `${inbox.unreadCount} непрочитанных`}</div>
  {#if inbox.error}<p role="alert">{inbox.error}</p><button type="button" onclick={() => inbox.load()}>Повторить</button>
  {:else if !inbox.loading && inbox.items.length === 0}<p>Новых уведомлений нет</p>
  {:else}<ul>{#each inbox.items as item (item.id)}<li class:unread={!item.readAt}><button type="button" onclick={() => { void inbox.markRead(item.id); onopen(item); }}><strong>{item.retractedAt ? 'Сообщение недоступно' : item.body || 'Новое уведомление'}</strong><small>{item.reasons.join(' · ')}</small></button></li>{/each}</ul>{/if}
  {#if inbox.hasMore}<button type="button" disabled={inbox.loading} onclick={() => inbox.load(true)}>Показать ещё</button>{/if}
</section>

<style>
  .notification-inbox, header { display: grid; gap: 12px; } header { grid-template-columns: 1fr auto; align-items: center; } header div { display:flex;gap:6px; } h2,p,ul { margin: 0; } ul { display:grid;gap:4px;padding:0;list-style:none; } li button { display:grid;width:100%;gap:3px;padding:10px;border:0;border-radius:10px;background:transparent;color:inherit;text-align:left; } li.unread button { background:color-mix(in oklch, var(--paper), var(--ink) 8%); } small { color:var(--muted); } .sr-only { position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0); }
</style>
