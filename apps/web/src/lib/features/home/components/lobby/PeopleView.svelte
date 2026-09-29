<script lang="ts">
  import EmojiText from '$lib/shared/chat/EmojiText.svelte';
  import { Check, ChevronLeft, Copy, X } from '@lucide/svelte';
  import type { AuthUser } from '$lib/api/auth';
  import { Avatar, Button } from '$lib/shared/ui';
  import { iconMd, iconSm, iconXs } from '$lib/shared/ui/icons';
  import { copyText } from '$lib/shared/utils/clipboard';
  import { friendName } from '../../model/lobby-format';
  import { useLobby } from '$lib/features/home/model/lobby-context';

  const lobby = useLobby();

  let { user, onToast, onHome } = $props<{ user: AuthUser; onToast: (message: string) => void; onHome: () => void }>();

  let query = $state('');
  let sending = $state(false);
  let copied = $state(false);
  let busy = $state<Record<string, boolean>>({});

  const incoming = $derived(lobby.requests.incoming);
  const outgoing = $derived(lobby.requests.outgoing);

  function statusMessage(status: string): string {
    switch (status) {
      case 'accepted':
        return 'Теперь вы друзья';
      case 'already_friends':
        return 'Вы уже друзья';
      case 'already_sent':
        return 'Заявка уже отправлена';
      default:
        return 'Заявка отправлена';
    }
  }

  async function sendByLogin(): Promise<void> {
    const login = query.trim().replace(/^@/, '');
    if (!login || sending) return;
    sending = true;
    try {
      const { status } = await lobby.addFriendByLogin(login);
      onToast(statusMessage(status));
      query = '';
    } catch (error) {
      onToast(error instanceof Error && error.message ? error.message : 'Не удалось отправить заявку');
    } finally {
      sending = false;
    }
  }

  async function copyLogin(): Promise<void> {
    try {
      await copyText(user.login);
    } catch {
      // Clipboard may be unavailable; still show feedback.
    }
    copied = true;
    window.setTimeout(() => (copied = false), 2000);
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      void sendByLogin();
    }
  }

  async function run(id: string, action: () => Promise<void>, ok: string): Promise<void> {
    if (busy[id]) return;
    busy = { ...busy, [id]: true };
    try {
      await action();
      onToast(ok);
    } catch (error) {
      onToast(error instanceof Error && error.message ? error.message : 'Не удалось выполнить действие');
    } finally {
      busy = { ...busy, [id]: false };
    }
  }

  function mutualLabel(count: number): string {
    if (count === 0) return 'нет общих друзей';
    const mod10 = count % 10;
    const mod100 = count % 100;
    const word =
      mod10 === 1 && mod100 !== 11
        ? 'общий друг'
        : mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)
          ? 'общих друга'
          : 'общих друзей';
    return `${count} ${word}`;
  }
</script>

<div class="lv-main-scroll">
  <button class="lr-section-link people-back" type="button" onclick={onHome}>
    <ChevronLeft {...iconSm} aria-hidden="true" />
    На главную
  </button>
  <div class="lr-title people-title">Друзья и заявки</div>

  <div class="lr-eyebrow people-section-label people-section-label--add">Добавить друга</div>
  <div class="lr-add-bar">
    <label class="lr-add-field">
      <span class="at">@</span>
      <input
        type="text"
        placeholder="логин друга"
        aria-label="Логин друга"
        autocapitalize="off"
        autocomplete="off"
        spellcheck="false"
        bind:value={query}
        onkeydown={onKeydown}
      />
    </label>
    <Button variant="primary" disabled={sending || !query.trim()} onclick={sendByLogin}>Отправить заявку</Button>
  </div>
  <div class="lr-add-hint">
    Ваш логин <code>@{user.login}</code>
    <button class="lr-add-copy" type="button" onclick={copyLogin}>
      <Copy {...iconXs} aria-hidden="true" />
      {copied ? 'скопировано' : 'копировать'}
    </button>
    — поделитесь им, чтобы вас нашли.
  </div>

  <div class="lr-eyebrow people-section-label people-section-label--requests">Заявки</div>
  <div class="lr-grid-2">
    <div>
      <div class="lr-eyebrow people-column-label">Входящие — {incoming.length}</div>
      {#if incoming.length === 0}
        <p class="lr-empty">Новых заявок нет.</p>
      {:else}
        {#each incoming as request (request.id)}
          <div class="lr-req-card">
            <Avatar
              name={friendName(request.user)}
              src={request.user.avatarUrl}
              colorKey={request.user.avatarColorKey}
              background={request.user.avatarAccent || undefined}
              size={44}
            />
            <div class="people-request-copy">
              <div class="lr-req-name people-truncate"><EmojiText text={friendName(request.user)} /></div>
              <div class="lr-req-handle people-truncate">@{request.user.login}</div>
              <div class="lr-req-meta people-truncate">{mutualLabel(request.mutualFriends)}</div>
            </div>
            <div class="lr-req-actions">
              <button
                class="lr-req-btn accept"
                type="button"
                title="Принять"
                disabled={busy[request.id]}
                onclick={() => run(request.id, () => lobby.acceptRequest(request.id), 'Заявка принята')}
              >
                <Check {...iconMd} aria-hidden="true" />
              </button>
              <button
                class="lr-req-btn decline"
                type="button"
                title="Отклонить"
                disabled={busy[request.id]}
                onclick={() => run(request.id, () => lobby.declineRequest(request.id), 'Заявка отклонена')}
              >
                <X {...iconSm} aria-hidden="true" />
              </button>
            </div>
          </div>
        {/each}
      {/if}
    </div>

    <div>
      <div class="lr-eyebrow people-column-label">Исходящие — {outgoing.length}</div>
      {#if outgoing.length === 0}
        <p class="lr-empty">Вы пока никому не отправляли заявки.</p>
      {:else}
        {#each outgoing as request (request.id)}
          <div class="lr-req-card">
            <Avatar
              name={friendName(request.user)}
              src={request.user.avatarUrl}
              colorKey={request.user.avatarColorKey}
              background={request.user.avatarAccent || undefined}
              size={44}
            />
            <div class="people-request-copy">
              <div class="lr-req-name people-truncate"><EmojiText text={friendName(request.user)} /></div>
              <div class="lr-req-handle people-truncate">@{request.user.login}</div>
              <div class="lr-req-pending"><span class="lr-req-pending-dot"></span>заявка отправлена · ждём ответа</div>
            </div>
            <Button
              variant="ghost"
              disabled={busy[request.id]}
              onclick={() => run(request.id, () => lobby.cancelRequest(request.id), 'Заявка отменена')}>Отменить</Button
            >
          </div>
        {/each}
      {/if}
    </div>
  </div>
</div>

<style>
  :global(.lr-eyebrow) {
    font-family: var(--font-ui);
    font-size: 11px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--warm-faint);
  }
  :global(.lr-section-link) {
    border: none;
    background: transparent;
    color: var(--warm-muted);
    font-family: var(--font-ui);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0;
  }
  :where(.lr-section-link):hover {
    color: var(--accent);
  }
  :global(.lr-grid-2) {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 14px;
  }
  :global(.lr-req-card) {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: var(--radius-lg);
    background: var(--panel);
    margin-bottom: 10px;
  }
  :global(.lr-req-name) {
    font-size: 14px;
    font-weight: 700;
    color: var(--warm-ink);
  }
  :global(.lr-req-handle) {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--warm-muted-dim);
    margin-top: 2px;
  }
  :global(.lr-req-meta) {
    font-size: 12px;
    color: var(--warm-faint);
    margin-top: 2px;
  }
  :global(.lr-req-pending) {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--warm-faint);
    margin-top: 2px;
  }
  :global(.lr-req-pending-dot) {
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--amber);
  }
  :global(.lr-req-actions) {
    display: flex;
    gap: 6px;
    flex: none;
  }
  :global(.lr-add-bar) {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    max-width: 520px;
  }
  :global(.lr-add-hint) {
    margin-top: 12px;
    font-size: 12.5px;
    color: var(--warm-faint);
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
  }
  :where(.lr-add-hint) code {
    font-family: var(--font-mono);
    font-size: 12.5px;
    color: var(--warm-muted);
  }
  :global(.lr-add-copy) {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border: none;
    background: transparent;
    cursor: pointer;
    color: var(--accent);
    font-family: var(--font-ui);
    font-size: 12px;
    font-weight: 600;
    padding: 2px 4px;
    border-radius: 6px;
  }
  :where(.lr-add-copy):hover {
    background: color-mix(in oklch, var(--accent), transparent 88%);
  }
  :global(.people-back) {
    margin-bottom: 18px;
  }
  :global(.people-section-label--add) {
    margin: 24px 0 12px;
  }
  :global(.people-section-label--requests) {
    margin: 32px 0 14px;
  }
  :global(.people-column-label) {
    margin-bottom: 14px;
  }
  :global(.people-request-copy) {
    flex: 1;
    min-width: 0;
  }
  :global(.people-truncate) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
