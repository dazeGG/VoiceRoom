<script setup lang="ts">
import { IconButton, NativeDialog } from '@voice-room/ui/components';
// Full-screen image viewer.
//
// It takes plain sources rather than message attachments, so the same viewer
// opens a picture already in the chat and one still sitting in the composer —
// the moment you most want a closer look is before you send it.
//
// The native modal puts the viewer above the room, regardless of the chat's stacking context.
import { t } from '@/shared/i18n';
import { ChevronLeft, ChevronRight, Download, Minus, Plus, RotateCcw, X } from '@lucide/vue';
import { computed, ref } from 'vue';
import { iconSm } from '@voice-room/ui/icon-defaults';

export interface LightboxItem {
  src: string;
  downloadHref?: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
  alt?: string | undefined;
}

const { items, index = 0 } = defineProps<{
  items: LightboxItem[];
  index?: number;
}>();

const emit = defineEmits<{ close: [] }>();

const MIN_SCALE = 1;
const MAX_SCALE = 6;
const STEP = 0.4;

const current = ref(Math.max(0, Math.min(index, items.length - 1)));
const scale = ref(1);
const offsetX = ref(0);
const offsetY = ref(0);
const dragging = ref(false);
let dragStartX = 0;
let dragStartY = 0;

const item = computed(() => items[current.value]);
const zoomed = computed(() => scale.value > MIN_SCALE + 0.001);

function reset(): void {
  scale.value = 1;
  offsetX.value = 0;
  offsetY.value = 0;
  dragging.value = false;
}

function move(delta: number): void {
  if (items.length < 2) return;
  current.value = (current.value + delta + items.length) % items.length;
  reset();
}

function zoomTo(next: number): void {
  const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number(next.toFixed(2))));
  if (clamped === scale.value) return;
  scale.value = clamped;
  // Back at fit size there is nothing left to pan to, so the image recentres
  // instead of staying wherever the reader dragged it.
  if (!zoomed.value) {
    offsetX.value = 0;
    offsetY.value = 0;
  }
}

function onWheel(event: WheelEvent): void {
  event.preventDefault();
  zoomTo(scale.value - Math.sign(event.deltaY) * STEP);
}

function onPointerDown(event: PointerEvent): void {
  if (!zoomed.value || event.button !== 0) return;
  dragging.value = true;
  dragStartX = event.clientX - offsetX.value;
  dragStartY = event.clientY - offsetY.value;
  if (event.currentTarget instanceof Element) event.currentTarget.setPointerCapture(event.pointerId);
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging.value) return;
  offsetX.value = event.clientX - dragStartX;
  offsetY.value = event.clientY - dragStartY;
}

function onPointerUp(event: PointerEvent): void {
  if (!dragging.value) return;
  dragging.value = false;
  if (event.currentTarget instanceof Element) event.currentTarget.releasePointerCapture?.(event.pointerId);
}

function keydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowLeft' && items.length > 1) {
    event.preventDefault();
    move(-1);
  } else if (event.key === 'ArrowRight' && items.length > 1) {
    event.preventDefault();
    move(1);
  } else if (event.key === '+' || event.key === '=') {
    event.preventDefault();
    zoomTo(scale.value + STEP);
  } else if (event.key === '-') {
    event.preventDefault();
    zoomTo(scale.value - STEP);
  } else if (event.key === '0') {
    event.preventDefault();
    reset();
  }
}
</script>

<template>
  <NativeDialog
    v-slot="{ close }"
    class="attachment-lightbox__backdrop"
    :label="t('Изображение {p0} из {p1}', { p0: current + 1, p1: items.length })"
    @keydown="keydown"
    @contextmenu.stop
    @close="emit('close')"
  >
    <div class="attachment-lightbox">
      <header class="attachment-lightbox__header">
        <span class="attachment-lightbox__counter">{{ current + 1 }} / {{ items.length }}</span>
        <div class="attachment-lightbox__tools">
          <IconButton
            :tooltip="false"
            :disabled="!zoomed"
            :label="t('Уменьшить')"
            :size="32"
            @click="zoomTo(scale - STEP)"
          >
            <Minus aria-hidden="true" />
          </IconButton>
          <span class="attachment-lightbox__scale">{{ Math.round(scale * 100) }}%</span>
          <IconButton
            :tooltip="false"
            :disabled="scale >= MAX_SCALE"
            :label="t('Увеличить')"
            :size="32"
            @click="zoomTo(scale + STEP)"
          >
            <Plus aria-hidden="true" />
          </IconButton>
          <IconButton
            :tooltip="false"
            :disabled="!zoomed && !offsetX && !offsetY"
            :label="t('Исходный размер')"
            :size="32"
            @click="reset"
          >
            <RotateCcw aria-hidden="true" />
          </IconButton>
          <a v-if="item?.downloadHref" :href="item.downloadHref" download rel="external" :aria-label="t('Скачать')"
            ><Download v-bind="iconSm" aria-hidden="true"
          /></a>
          <IconButton :tooltip="false" autofocus :label="t('Закрыть просмотр')" :size="32" @click="close">
            <X aria-hidden="true" />
          </IconButton>
        </div>
      </header>

      <div
        v-if="item"
        class="attachment-lightbox__stage"
        :class="{ 'attachment-lightbox__stage--zoomed': zoomed, 'attachment-lightbox__stage--dragging': dragging }"
        role="img"
        :aria-label="item.alt || t('Изображение')"
        @wheel="onWheel"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @dblclick="zoomed ? reset() : zoomTo(2)"
      >
        <img
          class="attachment-lightbox__image"
          :src="item.src"
          :alt="item.alt || ''"
          :width="item.width"
          :height="item.height"
          draggable="false"
          :style="{ transform: `translate(${offsetX}px, ${offsetY}px) scale(${scale})` }"
        />
      </div>

      <template v-if="items.length > 1">
        <IconButton
          :tooltip="false"
          class="attachment-lightbox__previous"
          :label="t('Предыдущее изображение')"
          :size="40"
          variant="filled"
          @click="move(-1)"
        >
          <ChevronLeft aria-hidden="true" />
        </IconButton>
        <IconButton
          :tooltip="false"
          class="attachment-lightbox__next"
          :label="t('Следующее изображение')"
          :size="40"
          variant="filled"
          @click="move(1)"
        >
          <ChevronRight aria-hidden="true" />
        </IconButton>
      </template>
    </div>
  </NativeDialog>
</template>
