<script lang="ts">
  import { Select } from '$lib/shared/ui';
  import { DESKTOP_BUILDS, QUARANTINE_CMD, RELEASES_URL, type DesktopBuild } from '../model/desktop-builds';

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
    selectedBuildId: string;
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
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#9a9484" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
      <span>
        <span class="home-app-title">Десктоп-приложение</span>
        <span class="home-app-sub">Своё окно и горячие клавиши · macOS и Windows</span>
      </span>
    </span>
    <span class="home-app-chevron" aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
    </span>
  </button>

  {#if appOpen}
    <div class="home-app-body">
      <div>
        <div class="home-app-fieldlabel">Платформа</div>
        <Select
          bind:value={selectedBuildId}
          options={BUILD_OPTIONS}
          label="Платформа"
          variant="home"
        />
      </div>

      {#if releaseError}
        <a class="home-dl" href={RELEASES_URL} target="_blank" rel="noopener">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
          Открыть страницу загрузок
        </a>
      {:else}
        <button class="home-dl" type="button" disabled={releaseLoading || appDownloadState === 'loading'} onclick={onDownload}>
          {#if appDownloadState === 'loading' || releaseLoading}
            <span class="home-spinner" aria-hidden="true"></span>
          {:else if appDownloadState === 'done'}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7ec99a" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5 12 10 17 19 7"></polyline></svg>
          {:else}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="4" x2="12" y2="15"></line><polyline points="7 11 12 16 17 11"></polyline><line x1="5" y1="20" x2="19" y2="20"></line></svg>
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
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#7ec99a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5 12 10 17 19 7"></polyline></svg>
              {:else}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15 V5 a2 2 0 0 1 2-2 h10"></path></svg>
              {/if}
              {cmdCopied ? 'Скопировано' : 'Копировать'}
            </button>
          </div>
        </div>
      {:else}
        <p class="home-app-note">Приложение не подписано. Если SmartScreen покажет «Приложение не проверено» — нажмите «Подробнее» → «Выполнить в любом случае».</p>
      {/if}
    </div>
  {/if}
</section>
