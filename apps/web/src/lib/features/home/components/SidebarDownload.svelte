<script lang="ts">
  import { onMount } from 'svelte';
  import { fetchDesktopRelease, type DesktopRelease } from '$lib/api/desktop';
  import { Popover, PopoverMenuItem } from '$lib/shared/ui';
  import { DESKTOP_BUILDS, RELEASES_URL, detectDesktopBuildId } from '../model/desktop-builds';
  import { triggerDesktopDownload } from '../services/desktop-download';

  let open = $state(false);
  let detectedBuildId = $state('mac-arm64');
  let release = $state<DesktopRelease | null>(null);
  let releaseLoading = $state(false);
  let releaseError = $state(false);
  let downloadingId = $state('');

  onMount(() => {
    detectedBuildId = detectDesktopBuildId();
  });

  async function ensureRelease(): Promise<DesktopRelease | null> {
    if (release) return release;
    if (releaseLoading) return null;
    releaseLoading = true;
    releaseError = false;
    try {
      release = await fetchDesktopRelease();
      return release;
    } catch {
      releaseError = true;
      return null;
    } finally {
      releaseLoading = false;
    }
  }

  async function download(buildId: string, close: () => void): Promise<void> {
    if (downloadingId) return;
    downloadingId = buildId;
    try {
      const latestRelease = release ?? (await ensureRelease());
      const asset = latestRelease?.assets[buildId] ?? null;
      if (asset) {
        triggerDesktopDownload(asset.url);
      } else {
        window.open(RELEASES_URL, '_blank', 'noopener');
      }
    } finally {
      downloadingId = '';
      close();
    }
  }
</script>

<Popover
  bind:open
  placement="top-end"
  flip
  role="menu"
  ariaLabel="Скачать приложение"
  rootClass="sidebar-download"
  panelClass="sidebar-download-popover"
>
  {#snippet trigger({ open: isOpen, toggle, panelId })}
    <button
      class="lobby-gear sidebar-download-trigger"
      class:is-open={isOpen}
      type="button"
      title="Скачать приложение"
      aria-label="Скачать приложение"
      aria-haspopup="menu"
      aria-expanded={isOpen}
      aria-controls={panelId}
      onclick={toggle}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="4" x2="12" y2="15"></line><polyline points="7 11 12 16 17 11"></polyline><line x1="5" y1="20" x2="19" y2="20"></line></svg>
    </button>
  {/snippet}

  {#snippet content({ close })}
    <div class="sidebar-download-head">Скачать приложение</div>
    {#each DESKTOP_BUILDS as build (build.id)}
      <PopoverMenuItem
        label={build.label}
        disabled={Boolean(downloadingId) && downloadingId !== build.id}
        onclick={() => download(build.id, close)}
      >
        {#snippet icon()}
          {#if downloadingId === build.id}
            <span class="home-spinner" aria-hidden="true"></span>
          {:else if build.mac}
            <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.4 12.7c0-2.2 1.8-3.3 1.9-3.3-1-1.5-2.6-1.7-3.2-1.7-1.4-.1-2.6.8-3.3.8-.7 0-1.7-.8-2.8-.8-1.5 0-2.8.8-3.6 2.2-1.5 2.6-.4 6.5 1.1 8.6.7 1 1.5 2.2 2.6 2.1 1-.04 1.4-.7 2.7-.7 1.2 0 1.6.7 2.7.6 1.1-.02 1.8-1 2.5-2 .8-1.2 1.1-2.3 1.1-2.3-.02-.01-2.1-.8-2.1-3.2zM14.3 6.3c.6-.7 1-1.7.9-2.7-.9.04-1.9.6-2.5 1.3-.5.6-1 1.6-.9 2.6 1 .1 1.9-.5 2.5-1.2z"></path></svg>
          {:else}
            <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 5.5 10.5 4.4v7.1H3V5.5zm0 13 7.5 1.1v-7H3v5.9zM11.5 4.3 21 3v8.5h-9.5V4.3zm0 8.2H21V21l-9.5-1.3v-7.2z"></path></svg>
          {/if}
        {/snippet}
      </PopoverMenuItem>
    {/each}
    {#if releaseError}
      <div class="sidebar-download-note">Не удалось получить релиз — откроем страницу загрузок.</div>
    {/if}
  {/snippet}
</Popover>
