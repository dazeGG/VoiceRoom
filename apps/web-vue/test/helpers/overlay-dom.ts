// Reka positions and scrolls overlays through browser APIs that jsdom lacks.
import { vi } from 'vitest';

export function stubOverlayDom(): void {
  for (const method of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture', 'scrollIntoView']) {
    Object.defineProperty(Element.prototype, method, { value: () => false, configurable: true });
  }
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
}

/** Lets Reka's presence and focus hand-over settle after an open or a close. */
export function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}
