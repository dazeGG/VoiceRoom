import { computed, onMounted, onUnmounted, ref } from 'vue';
import type { SplitterWidth } from '@voiceroom/ui-kit/components';
import { readStorage, writeStorage } from '@/shared/storage';

const WIDTH_KEY = 'voice-room:lobby-sidebar-width';
const COLLAPSED_KEY = 'voice-room:lobby-sidebar-collapsed';
const DEFAULT_WIDTH = 280;
const MIN_WIDTH = 240;
const MAX_WIDTH = 420;

export function useLobbySidebar(keepPreviewOpen: () => boolean) {
  const savedWidth = Number(readStorage(WIDTH_KEY));
  const preferredWidth = ref(
    savedWidth >= MIN_WIDTH && savedWidth <= MAX_WIDTH ? Math.round(savedWidth) : DEFAULT_WIDTH
  );
  const collapsed = ref(readStorage(COLLAPSED_KEY) === 'true');
  const viewportWidth = ref(window.innerWidth);
  const maxWidth = computed(() => Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.floor(viewportWidth.value * 0.45))));
  const dragging = ref(false);
  const dragWidth = ref<number | null>(null);
  const hovered = ref(false);
  const width = computed(() => Math.min(maxWidth.value, preferredWidth.value));
  const peeking = computed(() => collapsed.value && (hovered.value || keepPreviewOpen()) && !dragging.value);
  const visible = computed(() => !collapsed.value || peeking.value);

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

  function setCollapsed(value: boolean): void {
    hidePreview();
    collapsed.value = value;
    writeStorage(COLLAPSED_KEY, String(value));
  }

  function toggle(): void {
    if (!dragging.value) setCollapsed(!collapsed.value);
  }

  function showPreview(event: PointerEvent): void {
    if (event.pointerType === 'mouse' && event.buttons === 0 && collapsed.value && !dragging.value) {
      hovered.value = true;
    }
  }

  function hidePreview(): void {
    hovered.value = false;
  }

  function setDragging(active: boolean): void {
    dragging.value = active;
    if (!active) dragWidth.value = null;
  }

  function resize(pixels: number): void {
    if (dragging.value && pixels >= MIN_WIDTH) dragWidth.value = pixels;
  }

  function commit(next: SplitterWidth): void {
    if (!next.collapsed) {
      preferredWidth.value = next.width;
      writeStorage(WIDTH_KEY, String(next.width));
    }
    setCollapsed(next.collapsed);
  }

  return {
    visible,
    collapsed,
    peeking,
    width,
    minWidth: MIN_WIDTH,
    maxWidth,
    dragging,
    dragWidth,
    toggle,
    showPreview,
    hidePreview,
    setDragging,
    resize,
    commit
  };
}
