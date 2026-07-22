<script lang="ts">
  import { onMount } from 'svelte';
  import type { MessageAttachment } from '@voice-room/shared/attachments';
  import { attachmentVariantUrl } from '../../api/attachments';
  import './attachment.css';

  let { attachments, index = 0, onclose }: {
    attachments: MessageAttachment[];
    index?: number;
    onclose: () => void;
  } = $props();
  let current = $state(0);
  let zoomed = $state(false);
  let dialog: HTMLDivElement;
  const attachment = $derived(attachments[current]);

  function move(delta: number) {
    current = (current + delta + attachments.length) % attachments.length;
    zoomed = false;
  }

  function keydown(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); onclose(); }
    else if (event.key === 'ArrowLeft' && attachments.length > 1) { event.preventDefault(); move(-1); }
    else if (event.key === 'ArrowRight' && attachments.length > 1) { event.preventDefault(); move(1); }
    else if (event.key === 'Tab') {
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled),a[href]'));
      if (!controls.length) return;
      const first = controls[0]; const last = controls.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }

  onMount(() => {
    current = Math.max(0, Math.min(index, attachments.length - 1));
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.querySelector<HTMLElement>('button')?.focus();
    return () => previous?.focus();
  });
</script>

<div class="attachment-lightbox-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) onclose(); }}>
  <div bind:this={dialog} class="attachment-lightbox" role="dialog" aria-modal="true" tabindex="-1"
    aria-label={`Изображение ${current + 1} из ${attachments.length}`} onkeydown={keydown}>
    <header>
      <span>{current + 1} / {attachments.length}</span>
      <a href={attachmentVariantUrl(attachment.id, 'processed', true)}>Скачать</a>
      <button type="button" onclick={onclose} aria-label="Закрыть просмотр">×</button>
    </header>
    <button type="button" class:zoomed class="attachment-lightbox-image" onclick={() => { zoomed = !zoomed; }}
      aria-label={zoomed ? 'Уменьшить изображение' : 'Увеличить изображение'}>
      <img src={attachmentVariantUrl(attachment.id, 'processed')} alt="" width={attachment.width} height={attachment.height} />
    </button>
    {#if attachments.length > 1}
      <button class="attachment-previous" type="button" onclick={() => move(-1)} aria-label="Предыдущее изображение">‹</button>
      <button class="attachment-next" type="button" onclick={() => move(1)} aria-label="Следующее изображение">›</button>
    {/if}
  </div>
</div>
