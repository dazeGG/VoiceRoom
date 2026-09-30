<script lang="ts">
  import { ImagePlus } from '@lucide/svelte';
  import { iconLg } from '$lib/shared/ui/icons';
  import './attachment.css';
</script>

<div class="attachment-drop-overlay" role="status" aria-live="polite">
  <span class="attachment-drop-icon"><ImagePlus {...iconLg} aria-hidden="true" /></span>
  <strong>Перетащите фото сюда</strong>
  <span>JPEG, PNG или WebP до 10 МБ</span>
</div>

<style>
  :global(.attachment-drop-overlay) {
    position: absolute;
    inset: 10px;
    z-index: 80;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 8px;
    border: 2px dashed color-mix(in oklch, var(--accent) 72%, white);
    border-radius: 18px;
    color: var(--warm-ink);
    background: color-mix(in oklch, var(--warm-950), transparent 8%);
    backdrop-filter: blur(12px);
    pointer-events: none;
  }
  :where(.attachment-drop-overlay) strong {
    font-size: 16px;
  }
  :where(.attachment-drop-overlay) > span:last-child {
    color: var(--warm-muted);
    font-size: 12px;
  }
  :global(.attachment-drop-icon) {
    display: grid;
    width: 54px;
    height: 54px;
    place-items: center;
    border-radius: 16px;
    color: var(--warm-950);
    background: var(--accent);
  }
</style>
