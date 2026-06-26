<script lang="ts">
  import { onMount } from 'svelte';
  import { fetchDesktopRelease, type DesktopRelease } from '$lib/api/desktop';
  import Select from '$lib/shared/components/Select.svelte';
  import { RELEASES_URL, detectDesktopBuildId } from '../model/desktop-builds';
  import { triggerDesktopDownload } from '../services/desktop-download';

  // Compact platform labels for the inline control (the full card uses longer ones).
  const PLATFORM_OPTIONS = [
    { value: 'mac-arm64', label: 'macOS' },
    { value: 'mac-x64', label: 'macOS · Intel' },
    { value: 'win-x64', label: 'Windows' }
  ];

  let selectedBuildId = $state('mac-arm64');
  let release = $state<DesktopRelease | null>(null);
  let releaseLoading = $state(false);
  let releaseError = $state(false);
  let downloadState = $state<'idle' | 'loading' | 'done'>('idle');
  let downloadTimer = 0;
  let downloadResetTimer = 0;

  const selectedAsset = $derived(release?.assets[selectedBuildId] ?? null);
  const busy = $derived(downloadState === 'loading' || releaseLoading);

  onMount(() => {
    selectedBuildId = detectDesktopBuildId();
    return () => {
      window.clearTimeout(downloadTimer);
      window.clearTimeout(downloadResetTimer);
    };
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

  async function handleDownload(): Promise<void> {
    if (busy) return;
    if (releaseError) {
      window.open(RELEASES_URL, '_blank', 'noopener');
      return;
    }

    const latestRelease = release ?? (await ensureRelease());
    const asset = latestRelease?.assets[selectedBuildId] ?? null;
    if (!asset) {
      window.open(RELEASES_URL, '_blank', 'noopener');
      return;
    }

    downloadState = 'loading';
    triggerDesktopDownload(asset.url);

    window.clearTimeout(downloadTimer);
    downloadTimer = window.setTimeout(() => {
      downloadState = 'done';
    }, 1200);

    window.clearTimeout(downloadResetTimer);
    downloadResetTimer = window.setTimeout(() => {
      downloadState = 'idle';
    }, 4800);
  }
</script>

<div class="topbar-download" aria-label="Скачать приложение">
  <button class="topbar-download-btn" type="button" onclick={handleDownload} disabled={busy}>
    {#if busy}
      <span class="home-spinner" aria-hidden="true"></span>
    {:else if downloadState === 'done'}
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#7ec99a" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5 12 10 17 19 7"></polyline></svg>
    {:else}
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="4" x2="12" y2="15"></line><polyline points="7 11 12 16 17 11"></polyline><line x1="5" y1="20" x2="19" y2="20"></line></svg>
    {/if}
    Скачать
  </button>

  <span class="topbar-download-divider" aria-hidden="true"></span>

  <div class="topbar-download-platform">
    <Select
      bind:value={selectedBuildId}
      options={PLATFORM_OPTIONS}
      label="Платформа"
      variant="compact"
      placement="bottom-end"
    />
  </div>
</div>
