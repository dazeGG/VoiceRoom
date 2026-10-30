<script setup lang="ts">
// Full-screen image viewer.
//
// It takes plain sources rather than message attachments, so the same viewer
// opens a picture already in the chat and one still sitting in the composer —
// the moment you most want a closer look is before you send it.
//
// Not the shared Dialog: that one is a titled card, this is a full-screen
// viewer with its own toolbar. Focus is kept inside and handed back on close here.
import { Download, Minus, Plus, RotateCcw, X } from '@lucide/vue';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { iconSm } from '@/shared/ui/icons';

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
const dialog = ref<HTMLDivElement | null>(null);
let previousFocus: HTMLElement | null = null;

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
  if (event.key === 'Escape') {
    event.preventDefault();
    emit('close');
  } else if (event.key === 'ArrowLeft' && items.length > 1) {
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
  } else if (event.key === 'Tab') {
    const controls = Array.from(dialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href]') ?? []);
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}

function onBackdropClick(event: MouseEvent): void {
  if (event.target === event.currentTarget) emit('close');
}

onMounted(() => {
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  dialog.value?.querySelector<HTMLElement>('button')?.focus();
});

onBeforeUnmount(() => previousFocus?.focus());
</script>

<template>
  <div class="attachment-lightbox__backdrop" role="presentation" @click="onBackdropClick">
    <div
      ref="dialog"
      class="attachment-lightbox"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      :aria-label="`Изображение ${current + 1} из ${items.length}`"
      @keydown="keydown"
    >
      <header class="attachment-lightbox__header">
        <span class="attachment-lightbox__counter">{{ current + 1 }} / {{ items.length }}</span>
        <div class="attachment-lightbox__tools">
          <button type="button" :disabled="!zoomed" aria-label="Уменьшить" @click="zoomTo(scale - STEP)">
            <Minus v-bind="iconSm" aria-hidden="true" />
          </button>
          <span class="attachment-lightbox__scale">{{ Math.round(scale * 100) }}%</span>
          <button type="button" :disabled="scale >= MAX_SCALE" aria-label="Увеличить" @click="zoomTo(scale + STEP)">
            <Plus v-bind="iconSm" aria-hidden="true" />
          </button>
          <button type="button" :disabled="!zoomed && !offsetX && !offsetY" aria-label="Исходный размер" @click="reset">
            <RotateCcw v-bind="iconSm" aria-hidden="true" />
          </button>
          <a v-if="item?.downloadHref" :href="item.downloadHref" download rel="external" aria-label="Скачать"
            ><Download v-bind="iconSm" aria-hidden="true"
          /></a>
          <button type="button" aria-label="Закрыть просмотр" @click="emit('close')">
            <X v-bind="iconSm" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div
        v-if="item"
        class="attachment-lightbox__stage"
        :class="{ 'attachment-lightbox__stage--zoomed': zoomed, 'attachment-lightbox__stage--dragging': dragging }"
        role="img"
        :aria-label="item.alt || 'Изображение'"
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
        <button
          class="attachment-lightbox__previous"
          type="button"
          aria-label="Предыдущее изображение"
          @click="move(-1)"
        >
          ‹
        </button>
        <button class="attachment-lightbox__next" type="button" aria-label="Следующее изображение" @click="move(1)">
          ›
        </button>
      </template>
    </div>
  </div>
</template>
