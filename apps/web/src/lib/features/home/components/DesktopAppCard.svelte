<script lang="ts">
  // The desktop app: what it adds and one row per build. The build for this
  // computer is filled with the accent; a click downloads the latest release,
  // or opens the releases page when it cannot be fetched.
  import { onMount } from 'svelte';
  import { Check, Clapperboard, Copy, Download, Gamepad2, Keyboard, Power } from '@lucide/svelte';
  import Fa from 'svelte-fa';
  import { faApple, faWindows } from '@fortawesome/free-brands-svg-icons';
  import { fetchDesktopRelease, type DesktopRelease } from '$lib/api/desktop';
  import { MascotIcon } from '$lib/shared/ui';
  import { iconSm, iconXs } from '$lib/shared/ui/icons';
  import { copyText } from '$lib/shared/utils/clipboard';
  import {
    DESKTOP_BUILDS,
    QUARANTINE_CMD,
    detectDesktopBuildId,
    formatDesktopReleaseMeta,
    type DesktopBuildId
  } from '../../../platform/desktop-builds';
  import { startDesktopBuildDownload } from '../../../platform/desktop-download';

  let { title = 'Voice Room Desktop' }: { title?: string } = $props();

  const PERKS = [
    { text: 'Оверлей поверх игры', icon: Gamepad2 },
    { text: 'Стрим со звуком системы', icon: Clapperboard },
    { text: 'Горячие клавиши в свёрнутом окне', icon: Keyboard },
    { text: 'Автозапуск и работа из трея', icon: Power }
  ];

  let release = $state<DesktopRelease | null>(null);
  let releaseLoading = $state(true);
  let releaseError = $state(false);
  let recommendedId = $state<DesktopBuildId>('mac-arm64');
  let downloadingId = $state('');
  let cmdCopied = $state(false);

  onMount(() => {
    recommendedId = detectDesktopBuildId();
    void fetchDesktopRelease()
      .then((value) => (release = value))
      .catch(() => (releaseError = true))
      .finally(() => (releaseLoading = false));
  });

  function download(buildId: DesktopBuildId): void {
    if (downloadingId) return;
    downloadingId = buildId;
    startDesktopBuildDownload(release, buildId);
    window.setTimeout(() => (downloadingId = ''), 1500);
  }

  async function copyCommand(): Promise<void> {
    try {
      await copyText(QUARANTINE_CMD);
    } catch {
      // Clipboard may be unavailable; still show feedback.
    }
    cmdCopied = true;
    window.setTimeout(() => (cmdCopied = false), 2000);
  }
</script>

<section class="desktop-card" id="download" aria-label="Десктоп-приложение">
  <div class="desktop-card-head">
    <span class="desktop-card-icon"><MascotIcon variant="blink" size={32} /></span>
    <span class="desktop-card-titles">
      <span class="desktop-card-title">{title}</span>
      <span class="desktop-card-sub">Всё то же, что в браузере, и немного больше</span>
    </span>
  </div>

  <ul class="desktop-card-perks">
    {#each PERKS as perk (perk.text)}
      {@const Icon = perk.icon}
      <li>
        <span class="desktop-card-perk-icon"><Icon size={14} aria-hidden="true" /></span>
        {perk.text}
      </li>
    {/each}
  </ul>

  <div class="desktop-card-builds">
    {#each DESKTOP_BUILDS as build (build.id)}
      <button
        class="desktop-build"
        class:is-recommended={build.id === recommendedId}
        type="button"
        disabled={downloadingId === build.id}
        onclick={() => download(build.id)}
      >
        <span class="desktop-build-icon">
          <Fa icon={build.mac ? faApple : faWindows} size="sm" />
        </span>
        <span class="desktop-build-copy">
          <span class="desktop-build-name">{build.label}</span>
          <span class="desktop-build-meta"
            >{formatDesktopReleaseMeta(build, release?.assets?.[build.id], release, releaseLoading, releaseError)}</span
          >
        </span>
        {#if downloadingId === build.id}
          <Check {...iconSm} aria-hidden="true" />
        {:else}
          <Download {...iconSm} aria-hidden="true" />
        {/if}
      </button>
    {/each}
  </div>

  <div class="desktop-card-note">
    <p>
      Приложение не подписано. В macOS после установки выполните в Терминале, в Windows — «Подробнее» → «Выполнить в
      любом случае».
    </p>
    <div class="desktop-card-cmd">
      <code>{QUARANTINE_CMD}</code>
      <button type="button" onclick={copyCommand}>
        {#if cmdCopied}<Check {...iconXs} aria-hidden="true" />{:else}<Copy {...iconXs} aria-hidden="true" />{/if}
        {cmdCopied ? 'Скопировано' : 'Копировать'}
      </button>
    </div>
  </div>
</section>

<style>
  .desktop-card {
    display: flex;
    flex-direction: column;
    gap: 20px;
    width: 100%;
    min-width: 0;
    max-width: 480px;
    justify-self: end;
    padding: 24px;
    border: 1px solid var(--vr-line-strong);
    border-radius: 22px;
    background: var(--vr-surface);
    box-shadow: var(--vr-shadow-modal);
  }

  .desktop-card-head {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .desktop-card-icon {
    display: grid;
    width: 56px;
    height: 56px;
    flex: none;
    place-items: center;
    border: 1px solid var(--vr-line);
    border-radius: 16px;
    background: var(--vr-bg);
  }

  .desktop-card-titles {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .desktop-card-title {
    color: var(--vr-text);
    font-size: 19px;
    font-weight: 600;
    letter-spacing: -0.015em;
  }

  .desktop-card-sub {
    color: var(--vr-text-2);
    font-size: 13px;
  }

  .desktop-card-perks {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .desktop-card-perks li {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--vr-text);
    font-size: 13.5px;
  }

  .desktop-card-perk-icon {
    display: grid;
    width: 28px;
    height: 28px;
    flex: none;
    place-items: center;
    border-radius: 8px;
    background: var(--vr-surface-2);
    color: var(--vr-accent);
  }

  .desktop-card-builds {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-top: 4px;
  }

  .desktop-build {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    border: 1px solid var(--vr-line);
    border-radius: 13px;
    background: var(--vr-surface-2);
    color: var(--vr-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition:
      background 0.15s ease,
      border-color 0.15s ease;
  }

  .desktop-build:hover:not(:disabled) {
    border-color: var(--vr-line-strong);
    background: var(--vr-surface-3);
  }

  .desktop-build.is-recommended {
    border-color: transparent;
    background: var(--vr-accent);
    color: var(--vr-accent-ink);
  }

  .desktop-build.is-recommended:hover:not(:disabled) {
    background: var(--vr-accent-hover);
  }

  .desktop-build-icon {
    display: grid;
    width: 34px;
    height: 34px;
    flex: none;
    place-items: center;
    border-radius: 10px;
    background: var(--vr-bg);
  }

  .desktop-build.is-recommended .desktop-build-icon {
    background: color-mix(in oklch, var(--vr-accent-ink), transparent 88%);
  }

  .desktop-build-copy {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
    gap: 1px;
  }

  .desktop-build-name {
    font-size: 14px;
    font-weight: 600;
  }

  .desktop-build-meta {
    font-family: var(--font-mono);
    font-size: 11.5px;
    opacity: 0.7;
  }

  .desktop-card-note {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
    min-width: 0;
    color: var(--vr-text-3);
    font-size: 12px;
    line-height: 1.5;
  }

  .desktop-card-note p {
    margin: 0;
  }

  .desktop-card-cmd {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 10px;
    background: var(--vr-bg);
  }

  .desktop-card-cmd code {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    color: var(--vr-text-2);
    font-family: var(--font-mono);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .desktop-card-cmd button {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 4px;
    border: 0;
    background: transparent;
    color: var(--vr-accent);
    font: 500 12px var(--font-ui);
    cursor: pointer;
  }
</style>
