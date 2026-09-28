<script lang="ts">
  import { Check, ChevronDown, Copy, Download, ExternalLink, Monitor } from '@lucide/svelte';
  import { Select } from '$lib/shared/ui';
  import { iconMd, iconSm, iconXs } from '$lib/shared/ui/icons';
  import {
    DESKTOP_BUILDS,
    QUARANTINE_CMD,
    RELEASES_URL,
    type DesktopBuild,
    type DesktopBuildId
  } from '../../../platform/desktop-builds';

  const BUILD_OPTIONS = DESKTOP_BUILDS.map((build) => ({ value: build.id, label: build.label }));

  let {
    appOpen,
    selectedBuildId = $bindable(),
    selectedBuild,
    releaseError,
    releaseLoading,
    appDownloadState,
    cmdCopied,
    appMeta,
    appDownloadLabel,
    onToggleApp,
    onDownload,
    onCopyCommand
  } = $props<{
    appOpen: boolean;
    selectedBuildId: DesktopBuildId;
    selectedBuild: DesktopBuild;
    releaseError: boolean;
    releaseLoading: boolean;
    appDownloadState: 'idle' | 'loading' | 'done';
    cmdCopied: boolean;
    appMeta: string;
    appDownloadLabel: string;
    onToggleApp: () => void;
    onDownload: () => void;
    onCopyCommand: () => void;
  }>();
</script>

<section class="home-app" data-open={appOpen} aria-label="Десктоп-приложение">
  <button class="home-app-head" type="button" aria-expanded={appOpen} onclick={onToggleApp}>
    <span class="home-app-head-main">
      <Monitor {...iconMd} color="#9a9484" aria-hidden="true" />
      <span>
        <span class="home-app-title">Десктоп-приложение</span>
        <span class="home-app-sub">Своё окно и горячие клавиши · macOS и Windows</span>
      </span>
    </span>
    <span class="home-app-chevron" aria-hidden="true">
      <ChevronDown {...iconSm} aria-hidden="true" />
    </span>
  </button>

  {#if appOpen}
    <div class="home-app-body">
      <div>
        <div class="home-app-fieldlabel">Платформа</div>
        <Select bind:value={selectedBuildId} options={BUILD_OPTIONS} label="Платформа" variant="home" />
      </div>

      {#if releaseError}
        <a class="home-dl" href={RELEASES_URL} target="_blank" rel="noopener">
          <ExternalLink {...iconSm} aria-hidden="true" />
          Открыть страницу загрузок
        </a>
      {:else}
        <button
          class="home-dl"
          type="button"
          disabled={releaseLoading || appDownloadState === 'loading'}
          onclick={onDownload}
        >
          {#if appDownloadState === 'loading' || releaseLoading}
            <span class="home-spinner" aria-hidden="true"></span>
          {:else if appDownloadState === 'done'}
            <Check {...iconSm} color="#7ec99a" aria-hidden="true" />
          {:else}
            <Download {...iconSm} aria-hidden="true" />
          {/if}
          {appDownloadLabel}
        </button>
      {/if}

      <p class="home-app-meta">{appMeta}</p>

      {#if selectedBuild.mac}
        <div>
          <p class="home-cmd-label">Приложение не подписано. После установки выполните в Терминале:</p>
          <div class="home-cmd">
            <code>{QUARANTINE_CMD}</code>
            <button class="home-cmd-copy" type="button" onclick={onCopyCommand}>
              {#if cmdCopied}
                <Check {...iconXs} color="#7ec99a" aria-hidden="true" />
              {:else}
                <Copy {...iconXs} aria-hidden="true" />
              {/if}
              {cmdCopied ? 'Скопировано' : 'Копировать'}
            </button>
          </div>
        </div>
      {:else}
        <p class="home-app-note">
          Приложение не подписано. Если SmartScreen покажет «Приложение не проверено» — нажмите «Подробнее» → «Выполнить
          в любом случае».
        </p>
      {/if}
    </div>
  {/if}
</section>

<style>
  :global(.home-app-head) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }
  :global(.home-app-head-main) {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  :global(.home-app-title) {
    display: block;
    color: var(--warm-300);
    font-size: 14px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  :global(.home-app-sub) {
    display: block;
    margin-top: 2px;
    color: var(--warm-faint);
    font-size: 12.5px;
  }
  :global(.home-app-body) {
    margin-top: 18px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  :global(.home-app-fieldlabel) {
    margin-bottom: 8px;
    font-family: var(--font-ui);
    font-size: 11px;
    letter-spacing: 0.14em;
    color: var(--warm-650);
    text-transform: uppercase;
  }
  :global(.home-dl) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 9px;
    width: 100%;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 12px;
    padding: 14px;
    background: var(--control);
    color: var(--warm-100);
    font-family: var(--font-ui);
    font-size: 14px;
    font-weight: 600;
    text-decoration: none;
    cursor: pointer;
    transition: background 0.15s ease;
  }
  :where(.home-dl):disabled {
    cursor: default;
    opacity: 0.7;
  }
  :where(.home-dl):hover {
    background: var(--control-hover);
  }
  :global(.home-app-meta) {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 11.5px;
    letter-spacing: 0.02em;
    color: var(--warm-650);
  }
  :global(.home-app-note) {
    margin: 2px 0 0;
    color: var(--warm-560);
    font-size: 12px;
    line-height: 1.55;
  }
  :global(.home-cmd-label) {
    margin: 0 0 8px;
    color: var(--warm-560);
    font-size: 12px;
    line-height: 1.5;
  }
  :global(.home-cmd) {
    display: flex;
    align-items: stretch;
    gap: 8px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 11px;
    padding: 10px 11px;
    background: var(--warm-900);
  }
  :where(.home-cmd) code {
    flex: 1;
    min-width: 0;
    align-self: center;
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1.5;
    color: var(--warm-300);
    word-break: break-all;
  }
  :global(.home-cmd-copy) {
    flex: none;
    align-self: center;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    padding: 6px 10px;
    background: var(--control);
    color: var(--warm-300);
    font-family: var(--font-ui);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s ease;
  }
  :where(.home-cmd-copy):hover {
    background: var(--control-hover);
  }
</style>
