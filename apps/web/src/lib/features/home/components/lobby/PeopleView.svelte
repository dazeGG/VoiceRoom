<script lang="ts">
  import { Check, ChevronLeft, Copy, X } from '@lucide/svelte';
  import type { AuthUser } from '$lib/api/auth';
  import { Avatar, Button } from '$lib/shared/ui';
  import { iconMd, iconSm, iconXs } from '$lib/shared/ui/icons';
  import { copyText } from '$lib/shared/utils/clipboard';
  import { friendName } from '../../model/lobby-format';
  import {
    friendsState,
    acceptRequest,
    cancelRequest,
    declineRequest,
    addFriendByLogin
  } from '../../model/friends.svelte';

  let { user, onToast, onHome } = $props<{ user: AuthUser; onToast: (message: string) => void; onHome: () => void }>();

  let query = $state('');
  let sending = $state(false);
  let copied = $state(false);
  let busy = $state<Record<string, boolean>>({});

  const incoming = $derived(friendsState.requests.incoming);
  const outgoing = $derived(friendsState.requests.outgoing);

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
      const { status } = await addFriendByLogin(login);
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
    const word = mod10 === 1 && mod100 !== 11 ? 'общий друг' : mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20) ? 'общих друга' : 'общих друзей';
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
            <Avatar name={friendName(request.user)} src={request.user.avatarUrl} colorKey={request.user.avatarColorKey} background={request.user.avatarAccent || undefined} size={44} />
            <div class="people-request-copy">
              <div class="lr-req-name people-truncate">{friendName(request.user)}</div>
              <div class="lr-req-handle people-truncate">@{request.user.login}</div>
              <div class="lr-req-meta people-truncate">{mutualLabel(request.mutualFriends)}</div>
            </div>
            <div class="lr-req-actions">
              <button class="lr-req-btn accept" type="button" title="Принять" disabled={busy[request.id]} onclick={() => run(request.id, () => acceptRequest(request.id), 'Заявка принята')}>
                <Check {...iconMd} aria-hidden="true" />
              </button>
              <button class="lr-req-btn decline" type="button" title="Отклонить" disabled={busy[request.id]} onclick={() => run(request.id, () => declineRequest(request.id), 'Заявка отклонена')}>
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
            <Avatar name={friendName(request.user)} src={request.user.avatarUrl} colorKey={request.user.avatarColorKey} background={request.user.avatarAccent || undefined} size={44} />
            <div class="people-request-copy">
              <div class="lr-req-name people-truncate">{friendName(request.user)}</div>
              <div class="lr-req-handle people-truncate">@{request.user.login}</div>
              <div class="lr-req-pending"><span class="lr-req-pending-dot"></span>заявка отправлена · ждём ответа</div>
            </div>
            <Button variant="ghost" disabled={busy[request.id]} onclick={() => run(request.id, () => cancelRequest(request.id), 'Заявка отменена')}>Отменить</Button>
          </div>
        {/each}
      {/if}
    </div>
  </div>
</div>
