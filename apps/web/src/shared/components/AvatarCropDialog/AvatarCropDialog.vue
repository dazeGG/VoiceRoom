<script setup lang="ts">
import { useLocalizedText, currentErrorMessage } from '@/shared/i18n/localized-text';

import { t } from '@/shared/i18n';
import { Check } from '@lucide/vue';
import { deriveAvatarAccent, dominantAvatarColor } from '@voice-room/shared/avatar-accent';
import { ref, shallowRef, watch } from 'vue';
import EmojiText from '@/shared/chat/EmojiText.vue';
import { Avatar, Button, Dialog, Slider } from '@voice-room/ui/components';
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
const error = useLocalizedText();
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
        if (!cancelled) error.value = () => t('Не удалось прочитать изображение');
      };
      next.src = reader.result;
    };
    reader.onerror = () => {
      if (!cancelled) error.value = () => t('Не удалось прочитать файл');
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
      reject(new Error(t('Выберите изображение')));
      return;
    }
    const output = document.createElement('canvas');
    output.width = 256;
    output.height = 256;
    const context = context2d(output);
    if (!context) {
      reject(new Error(t('Canvas недоступен')));
      return;
    }
    context.drawImage(canvas.value, 0, 0, 256, 256);
    output.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error(t('Не удалось подготовить изображение')))),
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
    error.value = () =>
      err instanceof Error && currentErrorMessage(err) ? currentErrorMessage(err) : t('Не удалось сохранить аватар');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Dialog
    layer="nested"
    :open="open"
    size="lg"
    :title="title"
    :description="t('Перетащите изображение, масштабируйте ползунком или колесом')"
    :close-disabled="saving"
    :on-close="onClose"
  >
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
            :aria-label="t('Область кадрирования')"
            @pointerdown="onPointerDown"
            @pointermove="onPointerMove"
            @pointerup="endDrag"
            @pointercancel="endDrag"
            @wheel="onWheel"
          ></canvas>
        </div>
        <div class="avatar-crop__zoom">
          <div class="avatar-crop__zoom-head">
            <span>{{ t('Масштаб') }}</span>
            <output aria-hidden="true">{{ Math.round(zoom * 100) }}%</output>
          </div>
          <Slider
            v-model="zoom"
            :min="1"
            :max="3"
            :step="0.01"
            :aria-label="t('Масштаб изображения')"
            :aria-value-text="Math.round(zoom * 100) + '%'"
          />
        </div>
      </section>

      <aside class="avatar-crop__preview" :aria-label="t('Предпросмотр')">
        <span class="avatar-crop__preview-label">{{ t('Предпросмотр') }}</span>
        <template v-if="kind === 'user'">
          <div
            class="avatar-crop__tile"
            :style="{ '--preview-accent': accent.background, '--preview-shadow': accent.shadow }"
          >
            <Avatar :name="name" :src="previewUrl" :size="80" />
            <strong class="avatar-crop__name"><EmojiText :text="name || t('Ваш профиль')" /></strong>
            <span class="avatar-crop__caption">{{ t('плитка разговора') }}</span>
          </div>
          <div class="avatar-crop__card">
            <Avatar :name="name" :src="previewUrl" :size="36" online show-dot ring="var(--vr-surface)" />
            <div class="avatar-crop__card-text">
              <strong class="avatar-crop__name"><EmojiText :text="name || t('Ваш профиль')" /></strong
              ><span class="avatar-crop__caption">{{ t('в сети') }}</span>
            </div>
          </div>
        </template>
        <div v-else class="avatar-crop__card">
          <Avatar :name="name" :src="previewUrl" shape="squircle" :size="48" background="var(--vr-surface-3)" />
          <div class="avatar-crop__card-text">
            <strong class="avatar-crop__name"><EmojiText :text="name || t('Комната')" /></strong
            ><span class="avatar-crop__caption">{{ t('карточка лобби') }}</span>
          </div>
        </div>
      </aside>
    </div>

    <p v-if="error" class="avatar-crop__error" role="alert">{{ error }}</p>
    <template #footer>
      <Button variant="ghost" :disabled="saving" @click="onClose">
        {{ t('Отмена') }}
      </Button>
      <Button variant="primary" :busy="saving" :disabled="!image" @click="save">
        <template #icon><Check aria-hidden="true" /></template>
        {{ t('Готово') }}
      </Button>
    </template>
  </Dialog>
</template>
