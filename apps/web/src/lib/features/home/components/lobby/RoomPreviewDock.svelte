<script lang="ts">
  // Where the call dock sits in the room, before the viewer has joined: no
  // audio or video yet, and one way in.
  import { LogIn, VolumeX } from '@lucide/svelte';
  import { Button } from '$lib/shared/ui';
  import { iconMd, iconSm } from '$lib/shared/ui/icons';

  let { onEnter }: { onEnter: () => void } = $props();
</script>

<div class="lobby-preview-dock">
  <span class="lobby-preview-dock-note">
    <VolumeX {...iconSm} aria-hidden="true" />
    Звук и видео включатся после входа
  </span>
  <Button variant="primary" size="lg" onclick={onEnter}>
    {#snippet icon()}<LogIn {...iconMd} aria-hidden="true" />{/snippet}
    Войти в комнату
  </Button>
</div>

<style>
  .lobby-preview-dock {
    position: absolute;
    right: 20px;
    bottom: 20px;
    left: 20px;
    z-index: 6;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 14px;
    width: fit-content;
    max-width: calc(100% - 40px);
    margin-inline: auto;
    padding: 8px 8px 8px 18px;
    border: 1px solid var(--vr-line-strong);
    border-radius: 18px;
    background: var(--vr-dock-bg);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    box-shadow: var(--vr-shadow-dock);
  }

  .lobby-preview-dock-note {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--vr-text-2);
    font-size: 13.5px;
  }
</style>
