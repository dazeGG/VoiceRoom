<script lang="ts">
  import { renderIcon } from '../client/ui/icons';
  import { state as roomState } from '../client/core/state.svelte';
  import { getScreenProfileLabels } from '../client/media/profiles';
  import { playMediaElement } from '../client/services/media-playback-service';
  import { enterScreenView } from '../client/ui/screen-view';
  import type { Participant } from '../client/core/types';

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
  const title = $derived(participant.isLocal ? 'Ваш стрим' : participant.name);
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
    void enterScreenView(participant.id).catch((error) => console.error(error));
  }

  $effect(() => {
    if (!videoEl || !stream) return;
    if (videoEl.srcObject !== stream) {
      videoEl.srcObject = stream;
      playMediaElement(videoEl);
    }
  });

</script>

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
        <span class="stream-tile-icon" aria-hidden="true">{@html renderIcon('monitor')}</span>
      {/if}
    </span>
    <button
      class="stream-tile-expand"
      type="button"
      aria-pressed={isActive}
      aria-label={`Развернуть стрим ${participant.isLocal ? 'ваш' : participant.name}`}
      onclick={handleEnter}
    ></button>
    <span class="stream-tile-copy"><strong>{title}</strong></span>
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
        <span class="stream-tile-icon" aria-hidden="true">{@html renderIcon('monitor')}</span>
      {/if}
    </span>
    {#if isIdle}
      <span class="stream-tile-copy stream-tile-copy-idle"><strong>{title}</strong></span>
      <span class="stream-tile-actions">
        <span class="stream-tile-action stream-tile-action-primary">
          {isSubscribed ? 'Подключение' : 'Смотреть стрим'}
        </span>
      </span>
    {/if}
  </button>
{/if}