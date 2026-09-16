<script lang="ts">
  import { Copy, Download } from '@lucide/svelte';
  import { generateRecoveryCodes, type RecoveryCodesStatus } from '$lib/api/auth';
  import { Button, Dialog } from '$lib/shared/ui';
  import { iconSm } from '$lib/shared/ui/icons';
  import { recoveryCodesFileText } from '../model/account-security';
  import type { ToastOptions } from '../model/toasts.svelte';

  let { open, login, replacing = false, onClose, onGenerated, onToast } = $props<{
    open: boolean;
    login: string;
    replacing?: boolean;
    onClose: () => void;
    onGenerated: (status: RecoveryCodesStatus) => void;
    onToast: (message: string, options?: ToastOptions) => void;
  }>();

  let password = $state('');
  let codes = $state<string[]>([]);
  let saved = $state(false);
  let generating = $state(false);
  let error = $state('');

  $effect(() => {
    if (!open) return;
    password = '';
    codes = [];
    saved = false;
    error = '';
  });

  // Codes exist on the page only while the dialog shows them.
  function close(): void {
    codes = [];
    password = '';
    onClose();
  }

  async function generate(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (generating) return;
    if (!password) {
      error = 'Введите текущий пароль';
      return;
    }
    generating = true;
    error = '';
    try {
      const result = await generateRecoveryCodes(password);
      password = '';
      codes = result.codes;
      onGenerated(result.recoveryCodes);
    } catch (cause) {
      error = cause instanceof Error && cause.message ? cause.message : 'Не удалось создать коды';
    } finally {
      generating = false;
    }
  }

  async function copyCodes(): Promise<void> {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      onToast('Коды скопированы');
    } catch {
      onToast('Не удалось скопировать коды', { variant: 'error' });
    }
  }

  function downloadCodes(): void {
    const url = URL.createObjectURL(new Blob([recoveryCodesFileText(codes, login)], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `voiceroom-recovery-codes-${login}.txt`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
</script>

<!-- Opened from the settings modal, whose overlay sits at z-index 60. -->
<div class="recovery-dialog-layer">
<Dialog
  {open}
  title={codes.length > 0 ? 'Сохраните коды восстановления' : 'Коды восстановления'}
  onClose={close}
  width={480}
  initialFocus={codes.length > 0 ? '[data-recovery-codes]' : '#recoveryPasswordInput'}
>
  {#if codes.length === 0}
    <form class="recovery-form" onsubmit={generate}>
      <p class="recovery-text">
        Если вы забудете пароль, войти можно будет по логину и одному из десяти кодов. Каждый код срабатывает один раз.
      </p>
      {#if replacing}
        <p class="recovery-warning">Новые коды заменят старые — старые сразу перестанут работать.</p>
      {/if}
      <div>
        <label class="settings-field-label" for="recoveryPasswordInput">Текущий пароль</label>
        <input
          id="recoveryPasswordInput"
          class="settings-input"
          type="password"
          autocomplete="current-password"
          placeholder="••••••••"
          bind:value={password}
        />
      </div>
      {#if error}
        <p class="recovery-error" role="alert">{error}</p>
      {/if}
      <div class="lr-dialog-actions">
        <Button variant="ghost" type="button" onclick={close}>Отмена</Button>
        <Button variant="primary" type="submit" disabled={generating}>
          {generating ? 'Создаём…' : 'Создать коды'}
        </Button>
      </div>
    </form>
  {:else}
    <p class="recovery-text">
      Коды показываются только сейчас. Сохраните их там, где не потеряете: в менеджере паролей или на бумаге.
    </p>
    <ol class="recovery-codes" tabindex="-1" data-recovery-codes>
      {#each codes as code (code)}
        <li><code>{code}</code></li>
      {/each}
    </ol>
    <div class="recovery-tools">
      <Button variant="ghost" type="button" onclick={copyCodes}>
        {#snippet icon()}<Copy {...iconSm} aria-hidden="true" />{/snippet}
        Скопировать
      </Button>
      <Button variant="ghost" type="button" onclick={downloadCodes}>
        {#snippet icon()}<Download {...iconSm} aria-hidden="true" />{/snippet}
        Скачать .txt
      </Button>
    </div>
    <label class="recovery-confirm">
      <input type="checkbox" bind:checked={saved} />
      <span>Я сохранил коды</span>
    </label>
    <div class="lr-dialog-actions">
      <Button variant="primary" type="button" disabled={!saved} onclick={close}>Готово</Button>
    </div>
  {/if}
</Dialog>
</div>

<style>
  .recovery-dialog-layer :global(.ui-dialog-overlay) {
    z-index: 100;
  }

  .recovery-form {
    display: grid;
    gap: 14px;
  }

  .recovery-text,
  .recovery-warning,
  .recovery-error {
    margin: 0;
    font-size: 14px;
    line-height: 1.45;
  }

  .recovery-text {
    color: var(--warm-muted);
  }

  .recovery-warning {
    color: var(--amber, #e0b457);
  }

  .recovery-error {
    color: #e8b3a8;
  }

  .recovery-codes {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px 16px;
    margin: 14px 0;
    padding: 14px 16px 14px 36px;
    border: 1px solid var(--control-line, rgba(255, 255, 255, 0.1));
    border-radius: 12px;
    background: var(--warm-900);
    color: var(--warm-faint);
    outline: none;
  }

  .recovery-codes code {
    color: var(--warm-ink);
    font-family: var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);
    font-size: 14px;
    letter-spacing: 0.04em;
    user-select: all;
  }

  .recovery-tools {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .recovery-confirm {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin: 14px 0 4px;
    color: var(--warm-ink);
    font-size: 14px;
    cursor: pointer;
  }

  .recovery-confirm input {
    width: 16px;
    height: 16px;
    margin: 0;
    accent-color: var(--accent, currentColor);
  }

  @media (max-width: 460px) {
    .recovery-codes {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
