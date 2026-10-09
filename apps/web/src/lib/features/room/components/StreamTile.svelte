<script lang="ts">
  import { Monitor } from '@lucide/svelte';
  import { iconLg } from '$lib/shared/ui/icons';
  import { state as roomState } from '../client/core/state.svelte';
  import { getAvatarPresentation } from '../client/ui/avatar-presentation';
  import { getScreenProfileLabels } from '../client/media/profiles';
  import { playMediaElement } from '../client/services/media-playback-service';
  import { enterScreenView } from '../client/ui/screen-view';
  import type { Participant } from '../client/core/types';
  import { createLogger, errorContext } from '$lib/shared/log';

  const log = createLogger('room:stream');

  let {
    participant,
    hasPreview,
    isCollapsed,
    isSubscribed,
    stream
  }: {
    participant: Participant;
    hasPreview: boolean;
    isCollapsed: boolean;
    isSubscribed: boolean;
    stream: MediaStream | null;
  } = $props();

  let videoEl = $state<HTMLVideoElement>();

  const isIdle = $derived(!hasPreview);
  const isActive = $derived(hasPreview || isSubscribed);
  const profileMeta = $derived(getProfileMeta());
  const streamerAvatar = $derived(getAvatarPresentation(participant));
  const ariaLabel = $derived(
    hasPreview
      ? `Развернуть стрим ${participant.name}`
      : isSubscribed
        ? `Подключение к стриму ${participant.name}`
        : `Смотреть стрим ${participant.name}`
  );

  function getProfileMeta(): string {
    const profileId = participant.isLocal ? roomState.localScreenProfileId : participant.screenProfileId;
    const { qualityLabel, fpsLabel } = getScreenProfileLabels(profileId);
    return [qualityLabel, fpsLabel].filter(Boolean).join(' · ');
  }

  function handleEnter(event?: Event): void {
    event?.stopPropagation();
    void enterScreenView(participant.id).catch((error) => log.error('screen view action failed', errorContext(error)));
  }

  $effect(() => {
    if (!videoEl || !stream) return;
    if (videoEl.srcObject !== stream) {
      videoEl.srcObject = stream;
      playMediaElement(videoEl);
    }
  });
</script>

{#snippet streamPlate()}
  <span class="stream-tile-plate">
    <span
      class="stream-tile-mini-avatar"
      style:background={streamerAvatar.background}
      style:color={streamerAvatar.foreground}
      aria-hidden="true">{streamerAvatar.initials}</span
    >Стрим
  </span>
{/snippet}

{#if isCollapsed}
  <div
    class="stream-tile"
    data-peer-id={participant.id}
    data-preview={String(hasPreview)}
    data-collapsed="true"
    data-idle={String(isIdle)}
    data-local={String(participant.isLocal)}
    role="group"
  >
    <span class="stream-tile-preview">
      {#if hasPreview && stream}
        <video class="stream-tile-video" bind:this={videoEl} autoplay muted playsinline></video>
        {#if profileMeta}
          <span class="stream-tile-profile-meta">{profileMeta}</span>
        {/if}
      {:else}
        <span class="stream-tile-icon" aria-hidden="true"><Monitor {...iconLg} /></span>
      {/if}
    </span>
    <button
      class="stream-tile-expand"
      type="button"
      aria-pressed={isActive}
      aria-label={`Развернуть стрим ${participant.isLocal ? 'ваш' : participant.name}`}
      onclick={handleEnter}
    ></button>
    <span class="stream-tile-copy">{@render streamPlate()}</span>
  </div>
{:else}
  <button
    class="stream-tile"
    type="button"
    data-peer-id={participant.id}
    data-preview={String(hasPreview)}
    data-collapsed="false"
    data-idle={String(isIdle)}
    data-local={String(participant.isLocal)}
    aria-pressed={isActive}
    aria-label={ariaLabel}
    onclick={handleEnter}
  >
    <span class="stream-tile-preview">
      {#if hasPreview && stream}
        <video class="stream-tile-video" bind:this={videoEl} autoplay muted playsinline></video>
        {#if profileMeta}
          <span class="stream-tile-profile-meta">{profileMeta}</span>
        {/if}
      {:else}
        <span class="stream-tile-icon" aria-hidden="true"><Monitor {...iconLg} /></span>
      {/if}
    </span>
    {#if isIdle}
      <span class="stream-tile-copy stream-tile-copy-idle">{@render streamPlate()}</span>
      <span class="stream-tile-actions">
        <span class="stream-tile-action stream-tile-action-primary">
          {isSubscribed ? 'Подключение' : 'Смотреть стрим'}
        </span>
      </span>
    {/if}
  </button>
{/if}

<style>
  :global(.stream-tile-video) {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
    background: var(--vr-video-bg);
    object-fit: cover;
  }
  :global(.stream-tile-action) {
    display: inline-flex;
    min-height: 32px;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    padding: 0 14px;
    background: var(--vr-accent);
    color: var(--vr-accent-ink);
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
  }
  :global(.stream-tile-expand) {
    position: absolute;
    inset: 0;
    z-index: 1;
    border: 0;
    padding: 0;
    margin: 0;
    background: transparent;
    cursor: pointer;
  }
</style>
