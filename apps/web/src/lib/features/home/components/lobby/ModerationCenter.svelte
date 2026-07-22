<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { Ban, RotateCcw, ShieldAlert, Trash2 } from '@lucide/svelte';
  import type { ActiveBan, ModerationDuration } from '@voice-room/shared/moderation';
  import { deleteModeratedMessage, fetchActiveBans, putBan, unban } from '$lib/api/moderation';
  import { iconSm } from '$lib/shared/ui/icons';

  let { roomId, onMessageDeleted = () => {} }: {
    roomId: string;
    onMessageDeleted?: (messageId: string) => void;
  } = $props();

  let bans = $state<ActiveBan[]>([]);
  let nextCursor = $state<string>();
  let loading = $state(true);
  let loadingMore = $state(false);
  let saving = $state(false);
  let error = $state('');
  let userId = $state('');
  let reason = $state('');
  let duration = $state<ModerationDuration>('1h');
  let messageId = $state('');
  let deletingMessage = $state(false);
  let undoBan = $state<ActiveBan | null>(null);
  let undoTimer: ReturnType<typeof setTimeout> | undefined;

  function idempotencyKey(): string {
    return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  async function load(reset = false): Promise<void> {
    if (reset) loading = true;
    else loadingMore = true;
    error = '';
    try {
      const page = await fetchActiveBans(roomId, { cursor: reset ? undefined : nextCursor });
      bans = reset ? page.bans : [...bans, ...page.bans.filter((ban) => !bans.some((item) => item.id === ban.id))];
      nextCursor = page.pageInfo.nextCursor;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Не удалось загрузить блокировки';
    } finally {
      loading = false;
      loadingMore = false;
    }
  }

  function offerUndo(ban: ActiveBan): void {
    if (undoTimer) clearTimeout(undoTimer);
    undoBan = ban;
    undoTimer = setTimeout(() => { undoBan = null; }, 10_000);
  }

  async function submitBan(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (saving || !userId.trim()) return;
    saving = true;
    error = '';
    try {
      const ban = await putBan(roomId, {
        userId: userId.trim(),
        guestIp: null,
        duration,
        reason: reason.trim()
      }, idempotencyKey());
      bans = [ban, ...bans.filter((item) => item.id !== ban.id && item.subject.userId !== ban.subject.userId)];
      userId = '';
      reason = '';
      offerUndo(ban);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Не удалось заблокировать участника';
    } finally {
      saving = false;
    }
  }

  async function removeBan(ban: ActiveBan): Promise<void> {
    error = '';
    try {
      await unban(roomId, ban.id);
      bans = bans.filter((item) => item.id !== ban.id);
      if (undoBan?.id === ban.id) undoBan = null;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Не удалось снять блокировку';
    }
  }

  async function removeMessage(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const id = messageId.trim();
    if (!id || deletingMessage) return;
    deletingMessage = true;
    error = '';
    try {
      await deleteModeratedMessage(roomId, id);
      messageId = '';
      onMessageDeleted(id);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Не удалось удалить сообщение';
    } finally {
      deletingMessage = false;
    }
  }

  function expiryLabel(ban: ActiveBan): string {
    return ban.expiresAt == null
      ? 'Навсегда'
      : `до ${new Intl.DateTimeFormat('ru', { dateStyle: 'medium', timeStyle: 'short' }).format(ban.expiresAt)}`;
  }

  onMount(() => { void load(true); });
  onDestroy(() => { if (undoTimer) clearTimeout(undoTimer); });
</script>

<section class="moderation-center" aria-labelledby="moderation-title">
  <header>
    <span class="moderation-icon" aria-hidden="true"><ShieldAlert {...iconSm} /></span>
    <div><h2 id="moderation-title">Модерация</h2><p>Управление блокировками и нарушающими правила сообщениями</p></div>
  </header>

  {#if error}<p class="moderation-error" role="alert">{error}</p>{/if}
  {#if undoBan}
    <div class="undo" role="status">
      <span>Участник заблокирован</span>
      <button type="button" onclick={() => removeBan(undoBan!)}><RotateCcw {...iconSm} /> Отменить</button>
    </div>
  {/if}

  <form class="ban-form" onsubmit={submitBan}>
    <h3>Заблокировать участника</h3>
    <label><span>ID участника</span><input bind:value={userId} maxlength="36" autocomplete="off" required /></label>
    <label><span>Срок</span><select bind:value={duration}><option value="1h">1 час</option><option value="1d">1 день</option><option value="7d">7 дней</option><option value="permanent">Навсегда</option></select></label>
    <label class="reason"><span>Причина <small>необязательно</small></span><textarea bind:value={reason} maxlength="500" rows="2"></textarea></label>
    <button class="primary" type="submit" disabled={saving || !userId.trim()}><Ban {...iconSm} /> {saving ? 'Блокируем…' : 'Заблокировать'}</button>
  </form>

  <div class="active-section">
    <h3>Активные блокировки</h3>
    {#if loading}<p class="empty" aria-live="polite">Загружаем…</p>
    {:else if bans.length === 0}<p class="empty">Активных блокировок нет</p>
    {:else}<ul>{#each bans as ban (ban.id)}<li><div><strong>{ban.subject.userId ?? 'Гость'}</strong><span>{expiryLabel(ban)}</span>{#if ban.reason}<p>{ban.reason}</p>{/if}</div><button type="button" aria-label={`Снять блокировку ${ban.subject.userId ?? 'гостя'}`} onclick={() => removeBan(ban)}>Разблокировать</button></li>{/each}</ul>{/if}
    {#if nextCursor}<button class="more" type="button" disabled={loadingMore} onclick={() => load(false)}>{loadingMore ? 'Загружаем…' : 'Показать ещё'}</button>{/if}
  </div>

  <form class="delete-form" onsubmit={removeMessage}>
    <h3>Удалить сообщение</h3>
    <label><span>ID сообщения</span><input bind:value={messageId} maxlength="64" autocomplete="off" required /></label>
    <button type="submit" disabled={deletingMessage || !messageId.trim()}><Trash2 {...iconSm} /> {deletingMessage ? 'Удаляем…' : 'Удалить'}</button>
  </form>
</section>

<style>
  .moderation-center { display: grid; gap: 20px; color: var(--ink); }
  header { display: flex; gap: 12px; align-items: flex-start; }
  header h2, h3, header p { margin: 0; }
  header h2 { font-size: 18px; }
  header p, .empty { margin-top: 4px; color: var(--muted); font-size: 13px; }
  .moderation-icon { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; background: color-mix(in oklch, var(--coral) 18%, transparent); color: var(--coral); }
  .moderation-error, .undo { margin: 0; padding: 10px 12px; border-radius: 10px; font-size: 13px; }
  .moderation-error { background: color-mix(in oklch, var(--coral) 12%, transparent); color: var(--coral); }
  .undo { display: flex; align-items: center; justify-content: space-between; background: color-mix(in oklch, var(--green) 12%, transparent); color: var(--green); }
  .undo button { display: inline-flex; gap: 6px; align-items: center; border: 0; background: transparent; color: inherit; font-weight: 700; cursor: pointer; }
  form { display: grid; gap: 12px; padding: 16px; border: 1px solid var(--line); border-radius: 14px; background: color-mix(in oklch, var(--paper), var(--ink) 3%); }
  .ban-form { grid-template-columns: minmax(0, 1fr) 140px; }
  form h3, .reason, form .primary { grid-column: 1 / -1; }
  label { display: grid; gap: 6px; color: var(--muted); font-size: 12px; font-weight: 600; }
  small { font-weight: 400; }
  input, select, textarea { width: 100%; box-sizing: border-box; padding: 10px 11px; border: 1px solid var(--line); border-radius: 9px; background: var(--control); color: inherit; font: inherit; }
  textarea { resize: vertical; }
  button { font: inherit; }
  .primary, .delete-form button, li button, .more { justify-self: start; padding: 9px 12px; border: 0; border-radius: 9px; cursor: pointer; font-weight: 650; }
  .primary, .delete-form button { display: inline-flex; align-items: center; gap: 7px; background: var(--coral); color: var(--ink); }
  button:disabled { cursor: not-allowed; opacity: .55; }
  .active-section { display: grid; gap: 10px; }
  ul { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
  li { display: flex; justify-content: space-between; gap: 12px; padding: 12px; border: 1px solid var(--line); border-radius: 11px; }
  li div { min-width: 0; display: grid; gap: 3px; }
  li span, li p { margin: 0; color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
  li button, .more { align-self: center; border: 1px solid rgba(255,255,255,.12); background: transparent; color: inherit; }
  .delete-form { border-color: rgba(239,68,68,.22); }
  @media (max-width: 520px) { .ban-form { grid-template-columns: 1fr; } .ban-form > * { grid-column: 1; } li { align-items: flex-start; flex-direction: column; } }
</style>
