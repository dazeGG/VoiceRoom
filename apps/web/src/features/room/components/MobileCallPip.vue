<script setup lang="ts">
// The small picture of a call between two people. It can be dragged to any
// corner; a tap grows my own picture to show the camera switch, a second tap
// puts me full screen, and a tap on the other person swaps straight back.
import { computed, ref } from 'vue';
import { nearestCorner, type PipCorner } from '@/features/room/mobile-call-layout';
import { useMobileCallUiStore, type MobileCallScene } from '@/features/room/mobile-call-ui.store';
import MobileCallTile from './MobileCallTile.vue';
import MobileCameraFlip from './MobileCameraFlip.vue';

const props = defineProps<{ scene: Extract<MobileCallScene, { kind: 'duo' }>; corner: PipCorner }>();

const mobileCall = useMobileCallUiStore();

/** Past this many pixels a touch is a drag, not a tap: a finger wobbles a few on its own. */
const DRAG_THRESHOLD_PX = 10;

const box = ref<HTMLElement>();
const dragging = ref(false);
const offsetX = ref(0);
const offsetY = ref(0);
let start: { x: number; y: number } | null = null;
// The click that ends a drag must not count as a tap.
let dragged = false;

/** The shape without a camera picture: an upright phone frame. */
const AVATAR_RATIO = 100 / 178;

const frame = ref<number | null>(null);

const participant = computed(() => props.scene.pip);
// The picture-in-picture takes the shape of what the camera sends, within
// sane bounds for a broken report.
const ratio = computed(() =>
  participant.value.cameraStream && frame.value ? Math.min(Math.max(frame.value, 1 / 3), 3) : AVATAR_RATIO
);
function followFrame(next: number | null): void {
  frame.value = next;
}

const expanded = computed(() => props.scene.pipExpanded);
const canFlip = computed(() => expanded.value && Boolean(participant.value.cameraStream));

function handlePointerDown(event: PointerEvent): void {
  // The stage underneath would take this touch as a tap on the big picture.
  event.stopPropagation();
  mobileCall.restartChromeTimer();
  if (event.button !== 0) return;
  start = { x: event.clientX, y: event.clientY };
  dragged = false;
}

function handlePointerMove(event: PointerEvent): void {
  if (!start) return;
  // A mouse let go outside the box never sent its pointerup here.
  if (event.pointerType === 'mouse' && event.buttons === 0) {
    handlePointerCancel();
    return;
  }
  const x = event.clientX - start.x;
  const y = event.clientY - start.y;
  if (!dragging.value && Math.hypot(x, y) <= DRAG_THRESHOLD_PX) return;
  // Captured only once it is a drag: a captured tap would send its click to
  // this box instead of the tile, and the tap would be lost.
  if (!dragging.value) box.value?.setPointerCapture?.(event.pointerId);
  dragging.value = true;
  offsetX.value = x;
  offsetY.value = y;
}

function handlePointerUp(): void {
  start = null;
  if (!dragging.value) return;
  dragged = true;
  const area = box.value?.parentElement?.getBoundingClientRect();
  const rect = box.value?.getBoundingClientRect();
  if (area && rect) {
    mobileCall.setPipCorner(
      nearestCorner(
        { x: rect.left + rect.width / 2 - area.left, y: rect.top + rect.height / 2 - area.top },
        { width: area.width, height: area.height }
      )
    );
  }
  dragging.value = false;
  offsetX.value = 0;
  offsetY.value = 0;
}

function handlePointerCancel(): void {
  start = null;
  dragging.value = false;
  offsetX.value = 0;
  offsetY.value = 0;
}

function handleTap(): void {
  if (dragged) {
    dragged = false;
    return;
  }
  mobileCall.tapPip(props.scene);
}
</script>

<template>
  <!-- Dragging is for fingers; the tile inside stays a button for everyone. -->
  <div
    ref="box"
    :class="[
      'mobile-call-pip',
      `mobile-call-pip--${corner}`,
      { 'mobile-call-pip--expanded': expanded, 'mobile-call-pip--dragging': dragging }
    ]"
    :style="{
      '--pip-ratio': ratio,
      transform: dragging ? `translate(${offsetX}px, ${offsetY}px)` : undefined
    }"
    @pointerdown="handlePointerDown"
    @pointermove="handlePointerMove"
    @pointerup="handlePointerUp"
    @pointercancel="handlePointerCancel"
  >
    <MobileCallTile :participant="participant" variant="pip" @tap="handleTap" @frame="followFrame" />
    <div v-if="canFlip" class="mobile-call-pip__flip"><MobileCameraFlip variant="round" /></div>
  </div>
</template>
