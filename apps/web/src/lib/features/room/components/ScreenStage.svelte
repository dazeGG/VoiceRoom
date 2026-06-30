<script lang="ts">
  import { onMount } from 'svelte';
  import { mountIcons } from '../client/ui/icons';
  import { leaveScreenView, handleScreenStageClick } from '../client/ui/screen-view';
  import {
    getFullscreenView,
    getScreenMetaView,
    getStreamVolumeView,
    getViewerAvatarStyle,
    getViewerInitials,
    registerScreenStage,
    registerScreenVideo,
    registerStreamVolumeSlider,
    screenUi
  } from '../screen-ui.svelte';
  import {
    syncScreenVideoAudio,
    toggleScreenFullscreen,
    toggleScreenMute,
    updateScreenVolumeFromSlider
  } from '../client/ui/screen-stage-controls';

  let stageEl: HTMLElement | undefined;
  let videoEl: HTMLVideoElement | undefined;
  let volumeSliderEl: HTMLInputElement | undefined;

  const meta = $derived(getScreenMetaView());
  const volume = $derived(getStreamVolumeView());
  const fullscreen = $derived(getFullscreenView());

  $effect(() => {
    registerScreenVideo(videoEl ?? null);
    registerScreenStage(stageEl ?? null);
    registerStreamVolumeSlider(volumeSliderEl ?? null);
  });

  $effect(() => {
    if (!videoEl) return;
    const stream = screenUi.activeStream;
    if (stream && videoEl.srcObject !== stream) {
      videoEl.srcObject = stream;
      syncScreenVideoAudio();
    } else if (!stream) {
      videoEl.pause();
      videoEl.srcObject = null;
    }
  });

  onMount(() => {
    if (stageEl) mountIcons(stageEl);
  });
</script>

<div
  class="screen-stage"
  id="screenStage"
  bind:this={stageEl}
  hidden={!screenUi.stageVisible}
  data-ui-active={screenUi.uiActive ? 'true' : undefined}
  onclick={handleScreenStageClick}
  onpointerenter={() => { screenUi.uiActive = true; }}
  onpointerleave={() => { screenUi.uiActive = false; }}
  onpointermove={() => { if (screenUi.stageVisible) screenUi.uiActive = true; }}
>
  <video class="screen-video" id="screenVideo" bind:this={videoEl} autoplay playsinline></video>
  <div class="screen-placeholder" id="screenPlaceholder" hidden={!screenUi.showPlaceholder}>Подключение к экрану</div>

  {#if meta}
    <div class="screen-meta" id="screenMeta">
      <span class="screen-meta-live" aria-hidden="true"></span>
      <span class="screen-meta-title" id="screenMetaTitle">{meta.title}</span>
      {#if meta.showSepProfile}
        <span class="screen-meta-sep" id="screenMetaSepProfile" aria-hidden="true">·</span>
      {/if}
      {#if meta.showQuality}
        <span class="screen-meta-detail" id="screenMetaQuality">{meta.qualityLabel}</span>
      {/if}
      {#if meta.showSepFps}
        <span class="screen-meta-sep" id="screenMetaSepFps" aria-hidden="true">·</span>
      {/if}
      {#if meta.showFps}
        <span class="screen-meta-detail" id="screenMetaFps">{meta.fpsLabel}</span>
      {/if}
      {#if meta.showSepViewers}
        <span class="screen-meta-sep" id="screenMetaSepViewers" aria-hidden="true">·</span>
      {/if}
      <span class="screen-meta-detail screen-meta-viewers" id="screenMetaViewers">
        {#if meta.viewers.length === 0}
          Смотрят: 0
        {:else}
          {#each meta.viewers as viewer (viewer.id)}
            {@const avatar = getViewerAvatarStyle(viewer)}
            <span
              class="screen-meta-viewer-avatar"
              title={avatar.label}
              role="img"
              aria-label={avatar.label}
              style:--avatar-bg={avatar.background}
              style:--avatar-fg={avatar.foreground}
              style:--avatar-shadow={avatar.shadow}
            >{getViewerInitials(viewer)}</span>
          {/each}
          {#if meta.viewersRest > 0}
            <span class="screen-meta-viewers-rest">+{meta.viewersRest}</span>
          {/if}
        {/if}
      </span>
    </div>
  {/if}

  <div class="screen-view-controls" id="screenViewControls" hidden={!screenUi.showControls}>
    <div class="stream-volume-control" id="streamVolumeControl" hidden={volume.hidden}>
      <button
        class="screen-control-button stream-volume-button"
        id="streamVolumeButton"
        type="button"
        aria-label={volume.ariaLabel}
        aria-pressed={volume.muted}
        data-muted={String(volume.muted)}
        onclick={toggleScreenMute}
      >
        <span class="stream-volume-icon stream-volume-icon-on" data-icon="volume-on" aria-hidden="true"></span>
        <span class="stream-volume-icon stream-volume-icon-off" data-icon="volume-off" aria-hidden="true"></span>
      </button>
      <div class="stream-volume-popover" id="streamVolumePopover">
        <input
          class="stream-volume-slider"
          id="streamVolumeSlider"
          bind:this={volumeSliderEl}
          type="range"
          min="0"
          max={volume.maxPercent}
          value={volume.valuePercent}
          aria-label="Громкость стрима"
          oninput={() => updateScreenVolumeFromSlider()}
        />
      </div>
    </div>

    <button
      class="screen-control-button screen-fullscreen-button"
      id="screenFullscreenButton"
      type="button"
      aria-label={fullscreen.ariaLabel}
      aria-pressed={fullscreen.fullscreen}
      data-fullscreen={String(fullscreen.fullscreen)}
      onclick={() => void toggleScreenFullscreen()}
    >
      <span class="screen-fullscreen-icon screen-fullscreen-icon-enter" data-icon="fullscreen-enter" aria-hidden="true"></span>
      <span class="screen-fullscreen-icon screen-fullscreen-icon-exit" data-icon="fullscreen-exit" aria-hidden="true"></span>
    </button>
  </div>
</div>