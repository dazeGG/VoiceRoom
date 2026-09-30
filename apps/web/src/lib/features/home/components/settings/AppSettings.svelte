<script lang="ts">
  import { X } from '@lucide/svelte';
  import { onMount } from 'svelte';
  import { Select } from '$lib/shared/ui';
  import { iconSm } from '$lib/shared/ui/icons';
  import {
    readDesktopAutostartSettings,
    updateDesktopAutostartSettings,
    type DesktopAutostartPatch,
    type DesktopAutostartSettings
  } from '$lib/platform/desktop-autostart';
  import {
    addDesktopOverlayGame,
    readDesktopOverlayForeground,
    readDesktopOverlaySettings,
    removeDesktopOverlayGame,
    updateDesktopOverlaySettings,
    type DesktopOverlayForeground,
    type DesktopOverlayPatch,
    type DesktopOverlaySettings,
    type OverlayAnchor,
    type OverlayAvatarSize
  } from '$lib/platform/desktop-overlay';
  import { copyDesktopDiagnostics, openDesktopLogsFolder } from '$lib/platform/desktop-diagnostics';
  import {
    notificationPreferences,
    requestNotificationsFromUiAction,
    setNotificationsEnabled
  } from '$lib/shared/notifications/preferences.svelte';
  import type { SettingsSupport } from '../../model/settings-support';
  import type { ToastOptions } from '../../model/toasts.svelte';

  let {
    support,
    onToast
  }: {
    support: SettingsSupport;
    onToast: (message: string, options?: ToastOptions) => void;
  } = $props();

  const FOREGROUND_POLL_MS = 1000;

  let autostartSupported = $state(false);
  let openAtLogin = $state(false);
  let startMinimized = $state(false);
  let autostartSaving = $state(false);
  let overlayEnabled = $state(true);
  let overlayAnchor = $state<OverlayAnchor>('top-left');
  let overlayAvatarSize = $state<OverlayAvatarSize>('medium');
  let overlayShowNames = $state(true);
  let overlaySaving = $state(false);
  let overlayPending: DesktopOverlayPatch | null = null;
  let overlayAllowed = $state<string[]>([]);
  let overlayForeground = $state<DesktopOverlayForeground | null>(null);

  const systemNotificationsEnabled = $derived(
    notificationPreferences.notificationsEnabled && notificationPreferences.deliveryPermission === 'granted'
  );

  onMount(() => {
    if (support.autostart) void loadAutostartSettings();
    if (support.overlay) void loadOverlaySettings();
  });

  // The window the player last switched from, so it can be added as a game.
  $effect(() => {
    if (!support.overlay) return;
    let cancelled = false;
    async function poll(): Promise<void> {
      const next = await readDesktopOverlayForeground();
      if (!cancelled) overlayForeground = next;
    }
    void poll();
    const timer = window.setInterval(() => void poll(), FOREGROUND_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  });

  async function openLogsFolder(): Promise<void> {
    if (!(await openDesktopLogsFolder())) onToast('Не удалось открыть папку логов', { variant: 'error' });
  }

  async function copyDiagnostics(): Promise<void> {
    if (await copyDesktopDiagnostics()) onToast('Скопировано');
    else onToast('Не удалось скопировать информацию о системе', { variant: 'error' });
  }

  function applyAutostartSettings(settings: DesktopAutostartSettings): void {
    autostartSupported = settings.supported;
    openAtLogin = settings.openAtLogin;
    startMinimized = settings.startMinimized;
  }

  async function loadAutostartSettings(): Promise<void> {
    const settings = await readDesktopAutostartSettings();
    if (settings) applyAutostartSettings(settings);
  }

  function applyOverlaySettings(settings: DesktopOverlaySettings): void {
    overlayEnabled = settings.enabled;
    overlayAnchor = settings.anchor;
    overlayAvatarSize = settings.avatarSize;
    overlayShowNames = settings.showNames;
    overlayAllowed = settings.allowedExecutables;
  }

  async function loadOverlaySettings(): Promise<void> {
    const settings = await readDesktopOverlaySettings();
    if (settings) applyOverlaySettings(settings);
  }

  // Changes can arrive while one is still saving. Merge them so the last value always
  // lands, and only sync the UI back once nothing is queued.
  async function changeOverlay(patch: DesktopOverlayPatch): Promise<void> {
    overlayPending = { ...(overlayPending ?? {}), ...patch };
    if (overlaySaving) return;
    overlaySaving = true;
    try {
      while (overlayPending) {
        const next: DesktopOverlayPatch = overlayPending;
        overlayPending = null;
        const settings = await updateDesktopOverlaySettings(next);
        if (!settings) {
          onToast('Не удалось сохранить оверлей', { variant: 'error' });
          if (!overlayPending) await loadOverlaySettings();
          continue;
        }
        if (!overlayPending) applyOverlaySettings(settings);
      }
    } finally {
      overlaySaving = false;
    }
  }

  function executableName(exe: string): string {
    return exe.split(/[\\/]/).pop() || exe;
  }

  async function addOverlayGame(): Promise<void> {
    const settings = await addDesktopOverlayGame(overlayForeground?.exe);
    if (settings) applyOverlaySettings(settings);
    else onToast('Не удалось добавить игру', { variant: 'error' });
  }

  async function removeOverlayGame(exe: string): Promise<void> {
    const settings = await removeDesktopOverlayGame(exe);
    if (settings) applyOverlaySettings(settings);
    else onToast('Не удалось убрать игру', { variant: 'error' });
  }

  async function changeAutostart(patch: DesktopAutostartPatch): Promise<void> {
    if (autostartSaving) return;
    autostartSaving = true;
    try {
      const settings = await updateDesktopAutostartSettings(patch);
      if (settings) applyAutostartSettings(settings);
      if (!settings || settings.reason) onToast('Не удалось изменить автозапуск', { variant: 'error' });
    } finally {
      autostartSaving = false;
    }
  }

  // Turns the OS notification toasts on or off for this device. In-app cues and
  // the unread badge are unaffected.
  async function toggleSystemNotifications(): Promise<void> {
    if (systemNotificationsEnabled) {
      setNotificationsEnabled(false);
      return;
    }
    const permission = await requestNotificationsFromUiAction();
    if (permission !== 'granted') onToast('Системные уведомления недоступны', { variant: 'error' });
  }
</script>

<div class="settings-sound">
  {#if support.overlay}
    <div>
      <div class="settings-gate-head">
        <span class="settings-field-label">Оверлей в игре</span>
        <button
          class="settings-switch"
          type="button"
          role="switch"
          aria-checked={overlayEnabled}
          aria-label="Оверлей в игре"
          disabled={overlaySaving}
          onclick={() => void changeOverlay({ enabled: !overlayEnabled })}
        >
          <span class="settings-switch-knob" aria-hidden="true"></span>
        </button>
      </div>
      <div class="settings-gate-hint">
        Панель только поверх <strong>игры</strong> в оконном или borderless режиме: Steam, Epic, Riot, Xbox и то, что вы добавите
        ниже. Браузер, проводник и лаунчеры не считаются игрой. В exclusive fullscreen Windows отдаёт монитор игре — оверлея
        там не будет.
      </div>
    </div>

    <div class="settings-notification-dependent" data-disabled={!overlayEnabled}>
      <span class="settings-field-label">Положение</span>
      <Select
        bind:value={overlayAnchor}
        options={[
          { value: 'top-left', label: 'Слева сверху' },
          { value: 'top-right', label: 'Справа сверху' },
          { value: 'bottom-left', label: 'Слева снизу' },
          { value: 'bottom-right', label: 'Справа снизу' }
        ]}
        label="Положение оверлея"
        variant="field"
        disabled={overlaySaving || !overlayEnabled}
        onValueChange={(value) => void changeOverlay({ anchor: value as OverlayAnchor })}
      />
    </div>

    <div class="settings-notification-dependent" data-disabled={!overlayEnabled}>
      <span class="settings-field-label">Размер аватаров</span>
      <Select
        bind:value={overlayAvatarSize}
        options={[
          { value: 'small', label: 'Маленькие' },
          { value: 'medium', label: 'Средние' },
          { value: 'large', label: 'Большие' }
        ]}
        label="Размер аватаров в оверлее"
        variant="field"
        disabled={overlaySaving || !overlayEnabled}
        onValueChange={(value) => void changeOverlay({ avatarSize: value as OverlayAvatarSize })}
      />
    </div>

    <div class="settings-notification-dependent" data-disabled={!overlayEnabled}>
      <div class="settings-gate-head">
        <span class="settings-field-label">Имена участников</span>
        <button
          class="settings-switch"
          type="button"
          role="switch"
          aria-checked={overlayShowNames}
          aria-label="Имена участников"
          disabled={overlaySaving || !overlayEnabled}
          onclick={() => void changeOverlay({ showNames: !overlayShowNames })}
        >
          <span class="settings-switch-knob" aria-hidden="true"></span>
        </button>
      </div>
      <div class="settings-gate-hint">Если выключить, в игре останутся только аватары.</div>
    </div>

    <section class="settings-overlay-games" data-disabled={!overlayEnabled} aria-labelledby="overlayGamesTitle">
      <span class="settings-field-label" id="overlayGamesTitle">Последнее окно</span>
      <div class="settings-overlay-window">
        {#if overlayForeground?.exe}
          <div class="settings-overlay-window-text">
            <span class="settings-overlay-window-name">{overlayForeground.title || overlayForeground.label}</span>
            <span class="settings-overlay-window-exe">{overlayForeground.label}</span>
          </div>
          {#if overlayForeground.game}
            <span class="settings-overlay-window-status">Игра</span>
          {:else}
            <button
              class="settings-overlay-add"
              type="button"
              disabled={overlaySaving || !overlayEnabled}
              onclick={() => void addOverlayGame()}
            >
              Добавить как игру
            </button>
          {/if}
        {:else}
          <span class="settings-overlay-window-empty"
            >Переключитесь в игру и вернитесь сюда — здесь появится её окно.</span
          >
        {/if}
      </div>
      {#if overlayAllowed.length}
        <ul class="settings-overlay-allowed" aria-label="Игры, добавленные вручную">
          {#each overlayAllowed as exe (exe)}
            <li class="settings-overlay-allowed-item" title={exe}>
              <span>{executableName(exe)}</span>
              <button
                class="settings-overlay-remove"
                type="button"
                aria-label={`Убрать ${executableName(exe)}`}
                disabled={overlaySaving || !overlayEnabled}
                onclick={() => void removeOverlayGame(exe)}
              >
                <X {...iconSm} aria-hidden="true" />
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}

  {#if support.autostart}
    <div>
      <div class="settings-gate-head">
        <span class="settings-field-label">Автозапуск</span>
        <button
          class="settings-switch"
          type="button"
          role="switch"
          aria-checked={openAtLogin}
          aria-label="Автозапуск"
          disabled={autostartSaving || !autostartSupported}
          onclick={() => void changeAutostart({ openAtLogin: !openAtLogin })}
        >
          <span class="settings-switch-knob" aria-hidden="true"></span>
        </button>
      </div>
      <div class="settings-gate-hint">
        {#if autostartSupported}Voice Room откроется при входе в систему.
        {:else}Автозапуск недоступен в этой сборке приложения.{/if}
      </div>
    </div>

    <div class="settings-notification-dependent" data-disabled={!openAtLogin}>
      <div class="settings-gate-head">
        <span class="settings-field-label">Автозапуск свёрнутым</span>
        <button
          class="settings-switch"
          type="button"
          role="switch"
          aria-checked={startMinimized}
          aria-label="Автозапуск свёрнутым"
          disabled={autostartSaving || !autostartSupported || !openAtLogin}
          onclick={() => void changeAutostart({ startMinimized: !startMinimized })}
        >
          <span class="settings-switch-knob" aria-hidden="true"></span>
        </button>
      </div>
      <div class="settings-gate-hint">
        {#if support.mac}При автозапуске окно не откроется — Voice Room будет ждать в Dock.
        {:else}При автозапуске окно не откроется — Voice Room будет ждать в трее.{/if}
      </div>
    </div>

    {#if !support.mac}
      <div>
        <div class="settings-gate-head">
          <span class="settings-field-label">Системные уведомления</span>
          <button
            class="settings-switch"
            type="button"
            role="switch"
            aria-checked={systemNotificationsEnabled}
            aria-label="Системные уведомления"
            onclick={() => void toggleSystemNotifications()}
          >
            <span class="settings-switch-knob" aria-hidden="true"></span>
          </button>
        </div>
        <div class="settings-gate-hint">
          Уведомления Windows о сообщениях и заявках в друзья, без системного звука. Звуки Voice Room и счётчик на
          панели задач от этого не зависят.
        </div>
      </div>
    {/if}
  {/if}

  {#if support.diagnostics}
    <div>
      <span class="settings-field-label">Диагностика</span>
      <div class="settings-gate-hint">Логи и сведения о системе помогут поддержке разобраться с проблемой.</div>
      <div class="settings-diagnostics-actions">
        <button class="settings-unblock-button" type="button" onclick={() => void openLogsFolder()}>
          Открыть папку логов
        </button>
        <button class="settings-unblock-button" type="button" onclick={() => void copyDiagnostics()}>
          Скопировать информацию о системе
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  :global(.settings-diagnostics-actions) {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 10px;
  }
  :global(.settings-overlay-window) {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 54px;
    padding: 8px 8px 8px 14px;
    border: 1px solid color-mix(in oklch, var(--warm-faint), transparent 84%);
    border-radius: var(--radius-md);
    background: color-mix(in oklch, var(--panel-strong), transparent 45%);
  }
  :global(.settings-overlay-window-text) {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  :global(.settings-overlay-window-name),
  :global(.settings-overlay-window-exe) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  :global(.settings-overlay-window-name) {
    color: var(--warm-ink);
    font-size: 13px;
    font-weight: 650;
  }
  :global(.settings-overlay-window-exe) {
    color: var(--warm-faint);
    font-size: 12px;
  }
  :global(.settings-overlay-window-empty) {
    padding: 6px 0;
    color: var(--warm-faint);
    font-size: 12.5px;
    line-height: 1.45;
  }
  :global(.settings-overlay-window-status) {
    flex: none;
    margin-right: 6px;
    padding: 4px 10px;
    border-radius: var(--radius-pill);
    background: color-mix(in oklch, var(--green), transparent 86%);
    color: var(--green);
    font: 700 12px var(--font-ui);
  }
  :global(.settings-overlay-add) {
    flex: none;
    min-height: 36px;
    padding: 0 14px;
    border: none;
    border-radius: 11px;
    background: var(--green);
    color: oklch(20% 0.05 150);
    font: 700 12.5px var(--font-ui);
    cursor: pointer;
    transition: filter 0.15s ease;
  }
  :where(.settings-overlay-add):hover:not(:disabled) {
    filter: brightness(1.08);
  }
  :where(.settings-overlay-add):disabled {
    cursor: default;
    opacity: 0.6;
  }
  :global(.settings-overlay-allowed) {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 10px 0 0;
    padding: 0;
    list-style: none;
  }
  :global(.settings-overlay-allowed-item) {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    max-width: 100%;
    min-height: 28px;
    padding: 0 3px 0 11px;
    border-radius: var(--radius-pill);
    background: color-mix(in oklch, var(--panel-strong), transparent 25%);
    color: var(--warm-ink);
    font-size: 12px;
  }
  :where(.settings-overlay-allowed-item) > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  :global(.settings-overlay-remove) {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--warm-faint);
    cursor: pointer;
  }
  :where(.settings-overlay-remove):hover:not(:disabled) {
    background: color-mix(in oklch, var(--coral), transparent 84%);
    color: var(--coral);
  }
</style>
