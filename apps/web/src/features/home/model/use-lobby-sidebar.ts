import { computed, onMounted, onUnmounted, ref } from 'vue';
import { readStorage, writeStorage } from '@/shared/storage';

const WIDTH_KEY = 'voice-room:lobby-sidebar-width';
const COLLAPSED_KEY = 'voice-room:lobby-sidebar-collapsed';
const DEFAULT_WIDTH = 280;
const MIN_WIDTH = 240;
const MAX_WIDTH = 420;
const COLLAPSE_THRESHOLD = MIN_WIDTH - 64;
const KEY_STEP = 16;

export function useLobbySidebar(keepPreviewOpen: () => boolean) {
  const savedWidth = Number(readStorage(WIDTH_KEY));
  const preferredWidth = ref(
    savedWidth >= MIN_WIDTH && savedWidth <= MAX_WIDTH ? Math.round(savedWidth) : DEFAULT_WIDTH
  );
  const collapsed = ref(readStorage(COLLAPSED_KEY) === 'true');
  const viewportWidth = ref(window.innerWidth);
  const maxWidth = computed(() => Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.floor(viewportWidth.value * 0.45))));
  const dragWidth = ref<number | null>(null);
  const hovered = ref(false);
  const width = computed(() => clampWidth(dragWidth.value ?? preferredWidth.value));
  const layoutCollapsed = computed(() =>
    dragWidth.value === null ? collapsed.value : dragWidth.value < COLLAPSE_THRESHOLD
  );
  const peeking = computed(() => collapsed.value && (hovered.value || keepPreviewOpen()) && dragWidth.value === null);
  const visible = computed(() => !layoutCollapsed.value || peeking.value);
  let drag: { pointerId: number; startX: number; startWidth: number } | null = null;

  function updateViewportWidth(): void {
    viewportWidth.value = window.innerWidth;
  }

  function closePreviewOnEscape(event: KeyboardEvent): void {
    if (event.key === 'Escape') hidePreview();
  }

  onMounted(() => {
    window.addEventListener('resize', updateViewportWidth);
    window.addEventListener('keydown', closePreviewOnEscape);
  });
  onUnmounted(() => {
    window.removeEventListener('resize', updateViewportWidth);
    window.removeEventListener('keydown', closePreviewOnEscape);
  });

  function clampWidth(value: number): number {
    return Math.max(MIN_WIDTH, Math.min(maxWidth.value, Math.round(value)));
  }

  function setWidth(value: number): void {
    preferredWidth.value = clampWidth(value);
    writeStorage(WIDTH_KEY, String(preferredWidth.value));
  }

  function setCollapsed(value: boolean): void {
    hidePreview();
    collapsed.value = value;
    writeStorage(COLLAPSED_KEY, String(value));
  }

  function toggle(): void {
    if (!drag) setCollapsed(!collapsed.value);
  }

  function showPreview(event: PointerEvent): void {
    if (event.pointerType === 'mouse' && event.buttons === 0 && collapsed.value && !drag) {
      hovered.value = true;
    }
  }

  function hidePreview(): void {
    hovered.value = false;
  }

  function startResize(event: PointerEvent): void {
    if (collapsed.value || event.button !== 0 || !event.isPrimary || drag) return;
    const handle = event.currentTarget;
    if (!(handle instanceof HTMLElement)) return;
    handle.focus({ preventScroll: true });
    handle.setPointerCapture(event.pointerId);
    drag = { pointerId: event.pointerId, startX: event.clientX, startWidth: width.value };
  }

  function resize(event: PointerEvent): void {
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragWidth.value = drag.startWidth + event.clientX - drag.startX;
  }

  function cancelResize(event: PointerEvent): void {
    if (drag?.pointerId !== event.pointerId) return;
    drag = null;
    dragWidth.value = null;
  }

  function finishResize(event: PointerEvent): void {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const delta = event.clientX - drag.startX;
    const value = drag.startWidth + delta;
    cancelResize(event);
    if (delta === 0) return;
    if (value < COLLAPSE_THRESHOLD) {
      setCollapsed(true);
      return;
    }
    setWidth(value);
  }

  function resizeWithKeyboard(event: KeyboardEvent): void {
    if (collapsed.value || drag || event.altKey || event.ctrlKey || event.metaKey) return;
    switch (event.key) {
      case 'Enter':
        toggle();
        break;
      case 'Home':
        setCollapsed(true);
        break;
      case 'End':
        setWidth(maxWidth.value);
        break;
      case 'ArrowLeft':
        setWidth(width.value - KEY_STEP);
        break;
      case 'ArrowRight':
        setWidth(width.value + KEY_STEP);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  return {
    visible,
    layoutCollapsed,
    peeking,
    width,
    maxWidth,
    dragWidth,
    toggle,
    showPreview,
    hidePreview,
    startResize,
    resize,
    cancelResize,
    finishResize,
    resizeWithKeyboard
  };
}
