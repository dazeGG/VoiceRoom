<script lang="ts">
  import { Apple, Download, Monitor } from '@lucide/svelte';
  import { fetchDesktopRelease, type DesktopRelease } from '$lib/api/desktop';
  import { Popover, PopoverMenuItem } from '$lib/shared/ui';
  import { iconMd, iconSm } from '$lib/shared/ui/icons';
  import { DESKTOP_BUILDS, RELEASES_URL } from '../model/desktop-builds';
  import { triggerDesktopDownload } from '../services/desktop-download';

  let open = $state(false);
  let release = $state<DesktopRelease | null>(null);
  let releaseLoading = $state(false);
  let releaseError = $state(false);
  let downloadingId = $state('');


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
      <Download {...iconSm} aria-hidden="true" />
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
            <Apple {...iconMd} aria-hidden="true" />
          {:else}
            <Monitor {...iconMd} aria-hidden="true" />
          {/if}
        {/snippet}
      </PopoverMenuItem>
    {/each}
    {#if releaseError}
      <div class="sidebar-download-note">Не удалось получить релиз — откроем страницу загрузок.</div>
    {/if}
  {/snippet}
</Popover>
