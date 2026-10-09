<script lang="ts">
  import { getAvatarColor } from '$lib/visual/tokens';
  import { avatarInitial } from '$lib/shared/utils/avatar-initial';
  import type { AvatarProps } from './types';

  let {
    name,
    src = null,
    colorKey = '',
    size = 36,
    shape = 'circle',
    background = null,
    foreground = null,
    online = null,
    showDot = false,
    dnd = false,
    afk = false,
    ring = 'var(--vr-bg)',
    class: className = ''
  }: AvatarProps = $props();

  const fontSize = $derived(Math.round(size * 0.39));
  const dotSize = $derived(Math.max(10, Math.round(size * 0.3)));
  const presence = $derived(dnd ? 'dnd' : afk ? 'afk' : online ? 'online' : 'offline');
  const presenceColors = {
    dnd: 'var(--vr-dnd)',
    afk: 'var(--vr-away)',
    online: 'var(--vr-online)',
    offline: 'var(--vr-offline)'
  } as const;
  const dotColor = $derived(presenceColors[presence]);
  const initial = $derived(avatarInitial(name));
  const palette = $derived(getAvatarColor(colorKey));
  // A new src gets a fresh attempt: only the src that failed stays hidden.
  let failedSrc = $state<string | null>(null);
  const imageFailed = $derived(failedSrc !== null && failedSrc === src);
</script>

<span
  class="ui-avatar {className}"
  class:ui-avatar--squircle={shape === 'squircle'}
  style:width={`${size}px`}
  style:height={`${size}px`}
  style:font-size={`${fontSize}px`}
  style:background={background || palette.background}
  style:color={foreground || palette.foreground}
  aria-hidden="true"
>
  {#if src && !imageFailed}
    <img {src} alt="" onerror={() => (failedSrc = src)} />
  {:else}
    {initial}
  {/if}
  {#if showDot}
    <span
      class="ui-avatar-dot"
      data-status={presence}
      style:width={`${dotSize}px`}
      style:height={`${dotSize}px`}
      style:background={dotColor}
      style:border-color={ring}
    ></span>
  {/if}
</span>

<style>
  .ui-avatar {
    position: relative;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    font-family: var(--font-ui);
    font-weight: 600;
    letter-spacing: -0.02em;
  }

  .ui-avatar--squircle {
    border-radius: 31%;
  }

  .ui-avatar > img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: inherit;
  }

  .ui-avatar-dot {
    position: absolute;
    right: -1px;
    bottom: -1px;
    border-radius: 50%;
    border: 2px solid;
  }
</style>
