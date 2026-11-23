// The menu's width and fold, as the app's own lobby menu keeps them
// (apps/web/.../model/use-lobby-sidebar.ts): a width between MIN_WIDTH and
// MAX_WIDTH dragged at its edge (or stepped with the arrow keys there), folded
// to a rail when dragged narrower than COLLAPSE_THRESHOLD, and peeking over the
// content while the mouse is on the folded rail. Both live in localStorage; a
// narrow window with nothing saved starts folded.

import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

const WIDTH_KEY = 'vr-admin-sidebar-width';
const COLLAPSED_KEY = 'vr-admin-sidebar-collapsed';
export const DEFAULT_WIDTH = 280;
export const MIN_WIDTH = 240;
export const MAX_WIDTH = 420;
export const COLLAPSE_THRESHOLD = MIN_WIDTH - 64;
const KEY_STEP = 16;
const NARROW_PX = 900;

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Storage may be off: the defaults hold.
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not remembered, still applied.
  }
}

function savedWidth(): number {
  const saved = Number(read(WIDTH_KEY));
  return saved >= MIN_WIDTH && saved <= MAX_WIDTH ? Math.round(saved) : DEFAULT_WIDTH;
}

function savedCollapsed(): boolean {
  const saved = read(COLLAPSED_KEY);
  return saved === null ? window.innerWidth < NARROW_PX : saved === 'true';
}

export function useSidebar() {
  const preferredWidth = ref(savedWidth());
  const collapsed = ref(savedCollapsed());
  const viewportWidth = ref(window.innerWidth);
  const dragWidth = ref<number | null>(null);
  const hovered = ref(false);
  let drag: { pointerId: number; startX: number; startWidth: number } | null = null;

  const maxWidth = computed(() => Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.floor(viewportWidth.value * 0.45))));
  const clamp = (value: number) => Math.max(MIN_WIDTH, Math.min(maxWidth.value, Math.round(value)));
  const width = computed(() => clamp(dragWidth.value ?? preferredWidth.value));
  const layoutCollapsed = computed(() =>
    dragWidth.value === null ? collapsed.value : dragWidth.value < COLLAPSE_THRESHOLD
  );
  const peeking = computed(() => collapsed.value && hovered.value && dragWidth.value === null);
  const visible = computed(() => !layoutCollapsed.value || peeking.value);
  const resizing = computed(() => dragWidth.value !== null);

  const onResize = () => {
    viewportWidth.value = window.innerWidth;
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') hidePreview();
  };
  onMounted(() => {
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKeyDown);
  });
  onBeforeUnmount(() => {
    window.removeEventListener('resize', onResize);
    window.removeEventListener('keydown', onKeyDown);
  });

  function setWidth(value: number): void {
    const next = clamp(value);
    preferredWidth.value = next;
    write(WIDTH_KEY, String(next));
  }

  function setCollapsed(value: boolean): void {
    hovered.value = false;
    collapsed.value = value;
    write(COLLAPSED_KEY, String(value));
  }

  function toggle(): void {
    if (!drag) setCollapsed(!collapsed.value);
  }

  function showPreview(event: PointerEvent): void {
    if (event.pointerType === 'mouse' && event.buttons === 0 && collapsed.value && !drag) hovered.value = true;
  }

  function hidePreview(): void {
    hovered.value = false;
  }

  function startResize(event: PointerEvent): void {
    if (collapsed.value || event.button !== 0 || !event.isPrimary || drag) return;
    const handle = event.currentTarget;
    if (!(handle instanceof HTMLElement)) return;
    handle.focus({ preventScroll: true });
    handle.setPointerCapture?.(event.pointerId);
    drag = { pointerId: event.pointerId, startX: event.clientX, startWidth: width.value };
  }

  function resize(event: PointerEvent): void {
    const current = drag;
    if (!current || current.pointerId !== event.pointerId) return;
    dragWidth.value = current.startWidth + event.clientX - current.startX;
  }

  function cancelResize(event: PointerEvent): void {
    if (drag?.pointerId !== event.pointerId) return;
    drag = null;
    dragWidth.value = null;
  }

  function finishResize(event: PointerEvent): void {
    const current = drag;
    if (!current || current.pointerId !== event.pointerId) return;
    const delta = event.clientX - current.startX;
    const value = current.startWidth + delta;
    cancelResize(event);
    if (delta === 0) return;
    if (value < COLLAPSE_THRESHOLD) setCollapsed(true);
    else setWidth(value);
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
    collapsed,
    layoutCollapsed,
    peeking,
    visible,
    width,
    maxWidth,
    resizing,
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
