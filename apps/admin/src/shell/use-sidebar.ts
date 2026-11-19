// The menu's width and fold, as the app's own lobby menu keeps them
// (apps/web/.../model/use-lobby-sidebar.ts): a width between MIN_WIDTH and
// MAX_WIDTH dragged at its edge (or stepped with the arrow keys there), folded
// to a rail when dragged narrower than COLLAPSE_THRESHOLD, and peeking over the
// content while the mouse is on the folded rail. Both live in localStorage; a
// narrow window with nothing saved starts folded.

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

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
  const [preferredWidth, setPreferredWidth] = useState(savedWidth);
  const [collapsed, setCollapsedState] = useState(savedCollapsed);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const [hovered, setHovered] = useState(false);
  const drag = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);

  const maxWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.floor(viewportWidth * 0.45)));
  const clamp = useCallback((value: number) => Math.max(MIN_WIDTH, Math.min(maxWidth, Math.round(value))), [maxWidth]);
  const width = clamp(dragWidth ?? preferredWidth);
  const layoutCollapsed = dragWidth === null ? collapsed : dragWidth < COLLAPSE_THRESHOLD;
  const peeking = collapsed && hovered && dragWidth === null;
  const visible = !layoutCollapsed || peeking;

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setHovered(false);
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  function setWidth(value: number): void {
    const next = clamp(value);
    setPreferredWidth(next);
    write(WIDTH_KEY, String(next));
  }

  function setCollapsed(value: boolean): void {
    setHovered(false);
    setCollapsedState(value);
    write(COLLAPSED_KEY, String(value));
  }

  function toggle(): void {
    if (!drag.current) setCollapsed(!collapsed);
  }

  function showPreview(event: PointerEvent): void {
    if (event.pointerType === 'mouse' && event.buttons === 0 && collapsed && !drag.current) setHovered(true);
  }

  function hidePreview(): void {
    setHovered(false);
  }

  function startResize(event: PointerEvent<HTMLElement>): void {
    if (collapsed || event.button !== 0 || !event.isPrimary || drag.current) return;
    const handle = event.currentTarget;
    handle.focus({ preventScroll: true });
    handle.setPointerCapture?.(event.pointerId);
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width };
  }

  function resize(event: PointerEvent): void {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    setDragWidth(current.startWidth + event.clientX - current.startX);
  }

  function cancelResize(event: PointerEvent): void {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragWidth(null);
  }

  function finishResize(event: PointerEvent): void {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const delta = event.clientX - current.startX;
    const value = current.startWidth + delta;
    cancelResize(event);
    if (delta === 0) return;
    if (value < COLLAPSE_THRESHOLD) setCollapsed(true);
    else setWidth(value);
  }

  function resizeWithKeyboard(event: KeyboardEvent): void {
    if (collapsed || drag.current || event.altKey || event.ctrlKey || event.metaKey) return;
    switch (event.key) {
      case 'Enter':
        toggle();
        break;
      case 'Home':
        setCollapsed(true);
        break;
      case 'End':
        setWidth(maxWidth);
        break;
      case 'ArrowLeft':
        setWidth(width - KEY_STEP);
        break;
      case 'ArrowRight':
        setWidth(width + KEY_STEP);
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
    resizing: dragWidth !== null,
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
