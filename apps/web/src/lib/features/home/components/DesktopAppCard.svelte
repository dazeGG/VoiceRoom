<script lang="ts">
  import { Check, ChevronDown, Copy, Download, ExternalLink, Monitor } from '@lucide/svelte';
  import { Select } from '$lib/shared/ui';
  import { iconMd, iconSm, iconXs } from '$lib/shared/ui/icons';
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
        <Select
          bind:value={selectedBuildId}
          options={BUILD_OPTIONS}
          label="Платформа"
          variant="home"
        />
      </div>

      {#if releaseError}
        <a class="home-dl" href={RELEASES_URL} target="_blank" rel="noopener">
          <ExternalLink {...iconSm} aria-hidden="true" />
          Открыть страницу загрузок
        </a>
      {:else}
        <button class="home-dl" type="button" disabled={releaseLoading || appDownloadState === 'loading'} onclick={onDownload}>
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
        <p class="home-app-note">Приложение не подписано. Если SmartScreen покажет «Приложение не проверено» — нажмите «Подробнее» → «Выполнить в любом случае».</p>
      {/if}
    </div>
  {/if}
</section>
