<script lang="ts">
  import type { AuthUser } from '$lib/api/auth';
  import { copyText } from '../../services/desktop-download';
  import { addFriendByLogin } from '../../model/friends.svelte';

  let { user, onToast } = $props<{ user: AuthUser; onToast: (message: string) => void }>();

  let query = $state('');
  let sending = $state(false);
  let copied = $state(false);

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
</script>

<div class="lobby-view-head">
  <div class="lobby-view-title">Добавить друга</div>
  <div class="lobby-view-sub">Введите логин — например <span class="mono">@daze</span>. Заявка уйдёт после нажатия кнопки.</div>
</div>

<div class="lobby-view-body lobby-scroll">
  <div class="lobby-cols-add">
    <div>
      <div class="lobby-add-form">
        <label class="lobby-add-field">
          <span class="at">@</span>
          <input
            type="text"
            placeholder="login"
            autocapitalize="off"
            autocomplete="off"
            spellcheck="false"
            bind:value={query}
            onkeydown={onKeydown}
          />
        </label>
        <button class="lobby-add-send" type="button" onclick={sendByLogin} disabled={sending || !query.trim()}>Отправить заявку</button>
      </div>
    </div>

    <div>
      <div class="lobby-info-card">
        <div class="lobby-mono" style="font-size:11px;color:#7d7768;margin-bottom:14px;">Ваш логин</div>
        <div class="lobby-handle-box">
          <code>@{user.login}</code>
          <button class="lobby-handle-copy" type="button" onclick={copyLogin}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15V5a2 2 0 0 1 2-2h10"></path></svg>
            {copied ? 'Скопировано' : 'Копировать'}
          </button>
        </div>
        <div class="lobby-info-note">Поделитесь логином — друзья найдут вас и отправят заявку. Принимать запросы можно на экране «Заявки в друзья».</div>
      </div>

      <div class="lobby-info-card">
        <div class="lobby-mono" style="font-size:11px;color:#7d7768;margin-bottom:14px;">Как это работает</div>
        <div class="lobby-info-row"><span class="lobby-info-num">1</span><span class="lobby-info-text">Введите логин друга и отправьте заявку.</span></div>
        <div class="lobby-info-row"><span class="lobby-info-num">2</span><span class="lobby-info-text">Он примет — и вы окажетесь в списках друг друга.</span></div>
        <div class="lobby-info-row"><span class="lobby-info-num">3</span><span class="lobby-info-text">Пишите в личку и зовите в комнаты.</span></div>
      </div>
    </div>
  </div>
</div>