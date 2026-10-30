<script setup lang="ts">
import { Check, X } from '@lucide/vue';
import { deriveAvatarAccent, dominantAvatarColor } from '@voice-room/shared/avatar-accent';
import { DialogContent, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui';
import { ref, shallowRef, watch } from 'vue';
import EmojiText from '@/shared/chat/EmojiText.vue';
import { isToastPress } from '../Dialog/toast-press';
import Avatar from '../Avatar/Avatar.vue';
import type { AvatarCropDialogProps } from './types';
import { context2d, type Canvas2D } from './canvas-2d';

const DEFAULT_ACCENT = {
  background: 'var(--vr-surface-3)',
  foreground: 'var(--vr-text)',
  shadow: 'var(--vr-shadow-popover)'
};

const props = defineProps<AvatarCropDialogProps>();

const canvas = ref<HTMLCanvasElement | null>(null);
const image = shallowRef<HTMLImageElement | null>(null);
const zoom = ref(1);
const offsetX = ref(0);
const offsetY = ref(0);
const previewUrl = ref('');
const error = ref('');
const saving = ref(false);
const dragging = ref(false);
const dragPointerId = ref<number | null>(null);
const lastPointerX = ref(0);
const lastPointerY = ref(0);
const accent = ref({ ...DEFAULT_ACCENT });

watch(
  () => [props.file, props.open] as const,
  ([nextFile, isOpen], _previous, onCleanup) => {
    image.value = null;
    zoom.value = 1;
    offsetX.value = 0;
    offsetY.value = 0;
    previewUrl.value = '';
    error.value = '';
    accent.value = { ...DEFAULT_ACCENT };
    if (!isOpen || !nextFile) return;
    const reader = new FileReader();
    let cancelled = false;
    reader.onload = () => {
      if (cancelled || typeof reader.result !== 'string') return;
      const next = new Image();
      next.onload = () => {
        if (cancelled) return;
        image.value = next;
        zoom.value = 1;
        offsetX.value = 0;
        offsetY.value = 0;
        error.value = '';
        queueMicrotask(draw);
      };
      next.onerror = () => {
        if (!cancelled) error.value = 'Не удалось прочитать изображение';
      };
      next.src = reader.result;
    };
    reader.onerror = () => {
      if (!cancelled) error.value = 'Не удалось прочитать файл';
    };
    reader.readAsDataURL(nextFile);
    onCleanup(() => {
      cancelled = true;
      if (reader.readyState === FileReader.LOADING) reader.abort();
    });
  },
  { immediate: true, flush: 'post' }
);

watch(
  [zoom, offsetX, offsetY],
  () => {
    if (props.open && image.value) queueMicrotask(draw);
  },
  { flush: 'post' }
);

function clampOffsets(target: HTMLCanvasElement, source: HTMLImageElement): void {
  const baseScale = Math.max(target.width / source.naturalWidth, target.height / source.naturalHeight);
  const width = source.naturalWidth * baseScale * zoom.value;
  const height = source.naturalHeight * baseScale * zoom.value;
  const maxX = Math.max(0, (width - target.width) / 2);
  const maxY = Math.max(0, (height - target.height) / 2);
  offsetX.value = Math.max(-maxX, Math.min(maxX, offsetX.value));
  offsetY.value = Math.max(-maxY, Math.min(maxY, offsetY.value));
}

function draw(): void {
  const target = canvas.value;
  const source = image.value;
  if (!target || !source) return;
  clampOffsets(target, source);
  const context = context2d(target, { willReadFrequently: true });
  if (!context) return;
  const scale = Math.max(target.width / source.naturalWidth, target.height / source.naturalHeight) * zoom.value;
  const width = source.naturalWidth * scale;
  const height = source.naturalHeight * scale;
  context.clearRect(0, 0, target.width, target.height);
  context.drawImage(
    source,
    (target.width - width) / 2 + offsetX.value,
    (target.height - height) / 2 + offsetY.value,
    width,
    height
  );
  previewUrl.value = target.toDataURL('image/webp', 0.86);
  accent.value = deriveCanvasAccent(context, target.width, target.height);
}

function deriveCanvasAccent(context: Canvas2D, width: number, height: number) {
  const pixels = context.getImageData(0, 0, width, height).data;
  const dominant = dominantAvatarColor(pixels, width, height);
  return dominant ? deriveAvatarAccent(dominant) : accent.value;
}

function onWheel(event: WheelEvent): void {
  if (!image.value) return;
  event.preventDefault();
  const direction = event.deltaY < 0 ? 1 : -1;
  zoom.value = Math.max(1, Math.min(3, zoom.value + direction * 0.08));
}

function onPointerDown(event: PointerEvent): void {
  if (!canvas.value || !image.value) return;
  dragging.value = true;
  dragPointerId.value = event.pointerId;
  lastPointerX.value = event.clientX;
  lastPointerY.value = event.clientY;
  canvas.value.setPointerCapture(event.pointerId);
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging.value || dragPointerId.value !== event.pointerId || !canvas.value) return;
  const rect = canvas.value.getBoundingClientRect();
  offsetX.value += ((event.clientX - lastPointerX.value) * canvas.value.width) / rect.width;
  offsetY.value += ((event.clientY - lastPointerY.value) * canvas.value.height) / rect.height;
  lastPointerX.value = event.clientX;
  lastPointerY.value = event.clientY;
}

function endDrag(event: PointerEvent): void {
  if (dragPointerId.value !== event.pointerId) return;
  dragging.value = false;
  dragPointerId.value = null;
}

function exportBlob(): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (!canvas.value || !image.value) {
      reject(new Error('Выберите изображение'));
      return;
    }
    const output = document.createElement('canvas');
    output.width = 256;
    output.height = 256;
    const context = context2d(output);
    if (!context) {
      reject(new Error('Canvas недоступен'));
      return;
    }
    context.drawImage(canvas.value, 0, 0, 256, 256);
    output.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Не удалось подготовить изображение'))),
      'image/webp',
      0.88
    );
  });
}

async function save(): Promise<void> {
  if (saving.value) return;
  saving.value = true;
  error.value = '';
  try {
    await props.onSave(await exportBlob());
  } catch (err) {
    error.value = err instanceof Error && err.message ? err.message : 'Не удалось сохранить аватар';
  } finally {
    saving.value = false;
  }
}

// Reka traps Tab, closes on Escape and on a press outside the card, and returns
// focus to the previously focused element. A save in flight blocks closing.
function onOpenChange(next: boolean): void {
  if (!next && !saving.value) props.onClose();
}

function blockWhileSaving(event: Event): void {
  if (saving.value || isToastPress(event)) event.preventDefault();
}

function onOpenAutoFocus(event: Event): void {
  const root = event.target;
  if (!(root instanceof HTMLElement)) return;
  const target = root.querySelector('[data-dialog-initial-focus]');
  if (!(target instanceof HTMLElement)) return;
  event.preventDefault();
  target.focus({ preventScroll: true });
}
</script>

<template>
  <DialogRoot :open="open" @update:open="onOpenChange">
    <DialogPortal>
      <!-- Not DialogOverlay: it locks body scroll and the original had no lock. -->
      <div v-if="open" class="avatar-crop__overlay">
        <DialogContent
          class="avatar-crop__dialog"
          :aria-describedby="undefined"
          @open-auto-focus="onOpenAutoFocus"
          @escape-key-down="blockWhileSaving"
          @pointer-down-outside="blockWhileSaving"
          @interact-outside="blockWhileSaving"
        >
          <header class="avatar-crop__head">
            <div>
              <DialogTitle as="h2" class="avatar-crop__title">{{ title }}</DialogTitle>
              <p class="avatar-crop__hint">Перетащите изображение, масштабируйте ползунком или колесом</p>
            </div>
            <button
              class="avatar-crop__close"
              type="button"
              aria-label="Закрыть"
              :disabled="saving"
              data-dialog-initial-focus
              @click="onClose"
            >
              <X :size="18" />
            </button>
          </header>

          <div class="avatar-crop__body">
            <section class="avatar-crop__editor">
              <div
                class="avatar-crop__stage"
                :class="{
                  'avatar-crop__stage--circle': shape === 'circle',
                  'avatar-crop__stage--squircle': shape === 'squircle'
                }"
              >
                <canvas
                  ref="canvas"
                  class="avatar-crop__canvas"
                  width="512"
                  height="512"
                  aria-label="Область кадрирования"
                  @pointerdown="onPointerDown"
                  @pointermove="onPointerMove"
                  @pointerup="endDrag"
                  @pointercancel="endDrag"
                  @wheel="onWheel"
                ></canvas>
              </div>
              <label class="avatar-crop__zoom">
                <span>Масштаб</span>
                <input
                  v-model.number="zoom"
                  class="avatar-crop__zoom-input"
                  type="range"
                  min="1"
                  max="3"
                  step="0.01"
                  aria-label="Масштаб изображения"
                />
              </label>
            </section>

            <aside class="avatar-crop__preview" aria-label="Предпросмотр">
              <span class="avatar-crop__preview-label">Предпросмотр</span>
              <template v-if="kind === 'user'">
                <div
                  class="avatar-crop__tile"
                  :style="{ '--preview-accent': accent.background, '--preview-shadow': accent.shadow }"
                >
                  <Avatar :name="name" :src="previewUrl" :size="76" />
                  <strong class="avatar-crop__name"><EmojiText :text="name || 'Ваш профиль'" /></strong>
                  <span class="avatar-crop__caption">плитка разговора</span>
                </div>
                <div class="avatar-crop__card">
                  <Avatar :name="name" :src="previewUrl" :size="34" online show-dot ring="var(--vr-surface)" />
                  <div class="avatar-crop__card-text">
                    <strong class="avatar-crop__name"><EmojiText :text="name || 'Ваш профиль'" /></strong
                    ><span class="avatar-crop__caption">в сети</span>
                  </div>
                </div>
              </template>
              <div v-else class="avatar-crop__card">
                <Avatar :name="name" :src="previewUrl" shape="squircle" :size="48" background="var(--vr-surface-3)" />
                <div class="avatar-crop__card-text">
                  <strong class="avatar-crop__name"><EmojiText :text="name || 'Комната'" /></strong
                  ><span class="avatar-crop__caption">карточка лобби</span>
                </div>
              </div>
            </aside>
          </div>

          <p v-if="error" class="avatar-crop__error" role="alert">{{ error }}</p>
          <footer class="avatar-crop__actions">
            <button class="avatar-crop__cancel" type="button" :disabled="saving" @click="onClose">Отмена</button>
            <button class="avatar-crop__save" type="button" :disabled="saving || !image" @click="save">
              <Check :size="17" aria-hidden="true" />
              Готово
            </button>
          </footer>
        </DialogContent>
      </div>
    </DialogPortal>
  </DialogRoot>
</template>
