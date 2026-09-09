<script lang="ts">
  // Full-screen image viewer.
  //
  // It takes plain sources rather than message attachments, so the same viewer
  // opens a picture already in the chat and one still sitting in the composer —
  // the moment you most want a closer look is before you send it.
  import { onMount } from 'svelte';
  import { Download, Minus, Plus, RotateCcw, X } from '@lucide/svelte';
  import { iconSm } from '$lib/shared/ui/icons';
  import './attachment.css';

  export interface LightboxItem {
    src: string;
    downloadHref?: string;
    width?: number;
    height?: number;
    alt?: string;
  }

  let { items, index = 0, onclose }: {
    items: LightboxItem[];
    index?: number;
    onclose: () => void;
  } = $props();

  const MIN_SCALE = 1;
  const MAX_SCALE = 6;
  const STEP = 0.4;

  let current = $state(0);
  let scale = $state(1);
  let offsetX = $state(0);
  let offsetY = $state(0);
  let dragging = $state(false);
  let dragStartX = 0;
  let dragStartY = 0;
  let dialog: HTMLDivElement;

  const item = $derived(items[current]);
  const zoomed = $derived(scale > MIN_SCALE + 0.001);

  function reset(): void {
    scale = 1;
    offsetX = 0;
    offsetY = 0;
    dragging = false;
  }

  function move(delta: number): void {
    if (items.length < 2) return;
    current = (current + delta + items.length) % items.length;
    reset();
  }

  function zoomTo(next: number): void {
    const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number(next.toFixed(2))));
    if (clamped === scale) return;
    scale = clamped;
    // Back at fit size there is nothing left to pan to, so the image recentres
    // instead of staying wherever the reader dragged it.
    if (!zoomed) {
      offsetX = 0;
      offsetY = 0;
    }
  }

  function onWheel(event: WheelEvent): void {
    event.preventDefault();
    zoomTo(scale - Math.sign(event.deltaY) * STEP);
  }

  function onPointerDown(event: PointerEvent): void {
    if (!zoomed || event.button !== 0) return;
    dragging = true;
    dragStartX = event.clientX - offsetX;
    dragStartY = event.clientY - offsetY;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent): void {
    if (!dragging) return;
    offsetX = event.clientX - dragStartX;
    offsetY = event.clientY - dragStartY;
  }

  function onPointerUp(event: PointerEvent): void {
    if (!dragging) return;
    dragging = false;
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
  }

  function keydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.preventDefault(); onclose(); }
    else if (event.key === 'ArrowLeft' && items.length > 1) { event.preventDefault(); move(-1); }
    else if (event.key === 'ArrowRight' && items.length > 1) { event.preventDefault(); move(1); }
    else if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomTo(scale + STEP); }
    else if (event.key === '-') { event.preventDefault(); zoomTo(scale - STEP); }
    else if (event.key === '0') { event.preventDefault(); reset(); }
    else if (event.key === 'Tab') {
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled),a[href]'));
      if (!controls.length) return;
      const first = controls[0]; const last = controls.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }

  onMount(() => {
    current = Math.max(0, Math.min(index, items.length - 1));
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.querySelector<HTMLElement>('button')?.focus();
    return () => previous?.focus();
  });
</script>

<div
  class="attachment-lightbox-backdrop"
  role="presentation"
  onclick={(event) => { if (event.target === event.currentTarget) onclose(); }}
>
  <div
    bind:this={dialog}
    class="attachment-lightbox"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    aria-label={`Изображение ${current + 1} из ${items.length}`}
    onkeydown={keydown}
  >
    <header>
      <span class="attachment-lightbox-counter">{current + 1} / {items.length}</span>
      <div class="attachment-lightbox-tools">
        <button type="button" onclick={() => zoomTo(scale - STEP)} disabled={!zoomed} aria-label="Уменьшить">
          <Minus {...iconSm} aria-hidden="true" />
        </button>
        <span class="attachment-lightbox-scale">{Math.round(scale * 100)}%</span>
        <button type="button" onclick={() => zoomTo(scale + STEP)} disabled={scale >= MAX_SCALE} aria-label="Увеличить">
          <Plus {...iconSm} aria-hidden="true" />
        </button>
        <button type="button" onclick={reset} disabled={!zoomed && !offsetX && !offsetY} aria-label="Исходный размер">
          <RotateCcw {...iconSm} aria-hidden="true" />
        </button>
        {#if item.downloadHref}
          <a href={item.downloadHref} download aria-label="Скачать"><Download {...iconSm} aria-hidden="true" /></a>
        {/if}
        <button type="button" onclick={onclose} aria-label="Закрыть просмотр">
          <X {...iconSm} aria-hidden="true" />
        </button>
      </div>
    </header>

    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="attachment-lightbox-stage"
      class:is-zoomed={zoomed}
      class:is-dragging={dragging}
      role="img"
      aria-label={item.alt || 'Изображение'}
      onwheel={onWheel}
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      onpointercancel={onPointerUp}
      ondblclick={() => (zoomed ? reset() : zoomTo(2))}
    >
      <img
        src={item.src}
        alt={item.alt || ''}
        width={item.width}
        height={item.height}
        draggable="false"
        style:transform={`translate(${offsetX}px, ${offsetY}px) scale(${scale})`}
      />
    </div>

    {#if items.length > 1}
      <button class="attachment-previous" type="button" onclick={() => move(-1)} aria-label="Предыдущее изображение">‹</button>
      <button class="attachment-next" type="button" onclick={() => move(1)} aria-label="Следующее изображение">›</button>
    {/if}
  </div>
</div>
