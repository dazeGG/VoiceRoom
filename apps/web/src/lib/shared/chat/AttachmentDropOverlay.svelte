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
