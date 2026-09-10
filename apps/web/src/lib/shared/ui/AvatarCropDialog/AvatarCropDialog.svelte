<script lang="ts">
  import { Check, X } from '@lucide/svelte';
  import { deriveAvatarAccent, dominantAvatarColor } from '@voice-room/shared/avatar-accent';
  import { dialogFocusTrap } from '$lib/shared/ui/focus-trap';
  import Avatar from '../Avatar/Avatar.svelte';
  import type { AvatarCropDialogProps } from './types';

  const DEFAULT_ACCENT = {
    background: 'var(--panel-strong)',
    foreground: 'var(--warm-ink)',
    shadow: 'var(--shadow)'
  };

  let { file, name, open, shape, title, kind, onClose, onSave }: AvatarCropDialogProps = $props();

  let canvas = $state<HTMLCanvasElement>();
  let image = $state<HTMLImageElement | null>(null);
  let zoom = $state(1);
  let offsetX = $state(0);
  let offsetY = $state(0);
  let previewUrl = $state('');
  let error = $state('');
  let saving = $state(false);
  let dragging = $state(false);
  let dragPointerId = $state<number | null>(null);
  let lastPointerX = $state(0);
  let lastPointerY = $state(0);
  let accent = $state({ ...DEFAULT_ACCENT });

  $effect(() => {
    const nextFile = file;
    const isOpen = open;
    image = null;
    zoom = 1;
    offsetX = 0;
    offsetY = 0;
    previewUrl = '';
    error = '';
    accent = { ...DEFAULT_ACCENT };
    if (!isOpen || !nextFile) return;
    const reader = new FileReader();
    let cancelled = false;
    reader.onload = () => {
      if (cancelled || typeof reader.result !== 'string') return;
      const next = new Image();
      next.onload = () => {
        if (cancelled) return;
        image = next;
        zoom = 1;
        offsetX = 0;
        offsetY = 0;
        error = '';
        queueMicrotask(draw);
      };
      next.onerror = () => {
        if (!cancelled) error = 'Не удалось прочитать изображение';
      };
      next.src = reader.result;
    };
    reader.onerror = () => {
      if (!cancelled) error = 'Не удалось прочитать файл';
    };
    reader.readAsDataURL(nextFile);
    return () => {
      cancelled = true;
      if (reader.readyState === FileReader.LOADING) reader.abort();
    };
  });

  $effect(() => {
    void zoom;
    void offsetX;
    void offsetY;
    if (open && image) queueMicrotask(draw);
  });

  function clampOffsets(target: HTMLCanvasElement, source: HTMLImageElement): void {
    const baseScale = Math.max(target.width / source.naturalWidth, target.height / source.naturalHeight);
    const width = source.naturalWidth * baseScale * zoom;
    const height = source.naturalHeight * baseScale * zoom;
    const maxX = Math.max(0, (width - target.width) / 2);
    const maxY = Math.max(0, (height - target.height) / 2);
    offsetX = Math.max(-maxX, Math.min(maxX, offsetX));
    offsetY = Math.max(-maxY, Math.min(maxY, offsetY));
  }

  function draw(): void {
    if (!canvas || !image) return;
    clampOffsets(canvas, image);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return;
    const scale = Math.max(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight) * zoom;
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, (canvas.width - width) / 2 + offsetX, (canvas.height - height) / 2 + offsetY, width, height);
    previewUrl = canvas.toDataURL('image/webp', 0.86);
    accent = deriveCanvasAccent(context, canvas.width, canvas.height);
  }

  function deriveCanvasAccent(context: CanvasRenderingContext2D, width: number, height: number) {
    const pixels = context.getImageData(0, 0, width, height).data;
    const dominant = dominantAvatarColor(pixels, width, height);
    return dominant ? deriveAvatarAccent(dominant) : accent;
  }


  function onWheel(event: WheelEvent): void {
    if (!image) return;
    event.preventDefault();
    const direction = event.deltaY < 0 ? 1 : -1;
    zoom = Math.max(1, Math.min(3, zoom + direction * 0.08));
  }

  function onPointerDown(event: PointerEvent): void {
    if (!canvas || !image) return;
    dragging = true;
    dragPointerId = event.pointerId;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent): void {
    if (!dragging || dragPointerId !== event.pointerId || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    offsetX += (event.clientX - lastPointerX) * canvas.width / rect.width;
    offsetY += (event.clientY - lastPointerY) * canvas.height / rect.height;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
  }

  function endDrag(event: PointerEvent): void {
    if (dragPointerId !== event.pointerId) return;
    dragging = false;
    dragPointerId = null;
  }

  function exportBlob(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!canvas || !image) {
        reject(new Error('Выберите изображение'));
        return;
      }
      const output = document.createElement('canvas');
      output.width = 256;
      output.height = 256;
      const context = output.getContext('2d');
      if (!context) {
        reject(new Error('Canvas недоступен'));
        return;
      }
      context.drawImage(canvas, 0, 0, 256, 256);
      output.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Не удалось подготовить изображение')), 'image/webp', 0.88);
    });
  }

  async function save(): Promise<void> {
    if (saving) return;
    saving = true;
    error = '';
    try {
      await onSave(await exportBlob());
    } catch (err) {
      error = err instanceof Error && err.message ? err.message : 'Не удалось сохранить аватар';
    } finally {
      saving = false;
    }
  }

  function onOverlayClick(event: MouseEvent): void {
    if (event.target === event.currentTarget && !saving) onClose();
  }

  function onKeydown(event: KeyboardEvent): void {
    if (open && event.key === 'Escape' && !saving) {
      event.preventDefault();
      onClose();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <div class="crop-overlay" role="presentation" onclick={onOverlayClick}>
    <div
      class="crop-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="avatarCropTitle"
      tabindex="-1"
      use:dialogFocusTrap={{ enabled: open }}
    >
      <header class="crop-head">
        <div>
          <h2 id="avatarCropTitle">{title}</h2>
          <p>Перетащите изображение, масштабируйте ползунком или колесом</p>
        </div>
        <button type="button" aria-label="Закрыть" onclick={onClose} disabled={saving} data-dialog-initial-focus><X size={18} /></button>
      </header>

      <div class="crop-body">
        <section class="crop-editor">
          <div class="crop-stage" class:crop-stage--circle={shape === 'circle'} class:crop-stage--squircle={shape === 'squircle'}>
            <canvas
              bind:this={canvas}
              width="512"
              height="512"
              aria-label="Область кадрирования"
              onpointerdown={onPointerDown}
              onpointermove={onPointerMove}
              onpointerup={endDrag}
              onpointercancel={endDrag}
              onwheel={onWheel}
            ></canvas>
          </div>
          <label class="crop-zoom">
            <span>Масштаб</span>
            <input type="range" min="1" max="3" step="0.01" bind:value={zoom} aria-label="Масштаб изображения" />
          </label>
        </section>

        <aside class="crop-preview" aria-label="Предпросмотр">
          <span class="crop-preview-label">Предпросмотр</span>
          {#if kind === 'user'}
            <div class="crop-user-tile" style={`--preview-accent:${accent.background};--preview-shadow:${accent.shadow}`}>
              <Avatar name={name} src={previewUrl} size={76} />
              <strong>{name || 'Ваш профиль'}</strong>
              <span>плитка разговора</span>
            </div>
            <div class="crop-sidebar-preview">
              <Avatar name={name} src={previewUrl} size={34} online showDot ring="#24221d" />
              <div><strong>{name || 'Ваш профиль'}</strong><span>в сети</span></div>
            </div>
          {:else}
            <div class="crop-room-preview">
              <Avatar name={name} src={previewUrl} shape="squircle" size={48} background="var(--room-avatar-bg)" />
              <div><strong>{name || 'Комната'}</strong><span>карточка лобби</span></div>
            </div>
          {/if}
        </aside>
      </div>

      {#if error}<p class="crop-error" role="alert">{error}</p>{/if}
      <footer class="crop-actions">
        <button class="crop-cancel" type="button" onclick={onClose} disabled={saving}>Отмена</button>
        <button class="crop-save" type="button" onclick={save} disabled={saving || !image}>
          <Check size={17} aria-hidden="true" />
          Готово
        </button>
      </footer>
    </div>
  </div>
{/if}

<style>
  .crop-overlay { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; padding: 24px; background: color-mix(in srgb, var(--warm-950) 72%, transparent); backdrop-filter: blur(8px); }
  .crop-dialog { width: min(820px, 100%); border: 1px solid rgb(255 255 255 / .1); border-radius: 20px; background: var(--warm-800); box-shadow: 0 36px 90px rgb(0 0 0 / .6); color: var(--warm-ink, #f5efe4); overflow: hidden; }
  .crop-head { display: flex; align-items: flex-start; justify-content: space-between; padding: 20px 22px; border-bottom: 1px solid rgb(255 255 255 / .08); }
  .crop-head h2 { margin: 0; font-size: 18px; }
  .crop-head p { margin: 5px 0 0; color: var(--warm-faint, #8e887c); font-size: 13px; }
  .crop-head button { display: grid; place-items: center; width: 34px; height: 34px; border: 1px solid rgb(255 255 255 / .1); border-radius: 10px; background: var(--control); color: inherit; cursor: pointer; }
  .crop-body { display: grid; grid-template-columns: minmax(0, 1fr) 260px; gap: 28px; padding: 24px; }
  .crop-editor { min-width: 0; }
  .crop-stage { position: relative; width: min(100%, 430px); aspect-ratio: 1; margin: auto; overflow: hidden; background: var(--warm-950); touch-action: none; }
  .crop-stage--circle { border-radius: 50%; }
  .crop-stage--squircle { border-radius: 31%; }
  canvas { display: block; width: 100%; height: 100%; cursor: grab; }
  canvas:active { cursor: grabbing; }
  .crop-zoom { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 14px; margin: 18px auto 0; max-width: 430px; color: var(--warm-muted, #aaa397); font-size: 12px; font-weight: 700; }
  .crop-zoom input { accent-color: var(--accent, #d9f27c); }
  .crop-preview { display: flex; flex-direction: column; gap: 14px; }
  .crop-preview-label { color: var(--warm-faint, #8e887c); font-family: var(--font-ui, sans-serif); font-size: 10px; letter-spacing: .14em; text-transform: uppercase; }
  .crop-user-tile { display: flex; min-height: 210px; flex-direction: column; align-items: center; justify-content: center; gap: 8px; border-radius: 18px; background: var(--preview-accent); box-shadow: var(--preview-shadow); }
  .crop-user-tile strong { margin-top: 5px; }
  .crop-user-tile span, .crop-sidebar-preview span, .crop-room-preview span { color: rgb(255 255 255 / .62); font-size: 11px; }
  .crop-sidebar-preview, .crop-room-preview { display: flex; align-items: center; gap: 11px; padding: 13px; border: 1px solid rgb(255 255 255 / .08); border-radius: 14px; background: var(--panel); }
  .crop-sidebar-preview div, .crop-room-preview div { display: flex; min-width: 0; flex-direction: column; gap: 3px; }
  .crop-sidebar-preview strong, .crop-room-preview strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .crop-error { margin: 0 24px 12px; color: #f87171; font-size: 13px; }
  .crop-actions { display: flex; justify-content: flex-end; gap: 10px; padding: 17px 22px; border-top: 1px solid rgb(255 255 255 / .08); }
  .crop-actions button { display: inline-flex; align-items: center; gap: 8px; padding: 10px 16px; border-radius: 11px; font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; }
  .crop-cancel { border: 1px solid rgb(255 255 255 / .12); background: transparent; color: var(--warm-ink-dim, #d5cfc4); }
  .crop-save { border: 0; background: var(--accent); color: var(--accent-ink); }
  .crop-actions button:disabled, .crop-head button:disabled { cursor: default; opacity: .58; }
  @media (max-width: 720px) { .crop-overlay { padding: 10px; } .crop-dialog { max-height: 96vh; overflow-y: auto; } .crop-body { grid-template-columns: 1fr; } .crop-preview { display: none; } }
</style>
