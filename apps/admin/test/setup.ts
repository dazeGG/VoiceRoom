import { cleanup } from '@testing-library/vue';
import { afterEach, beforeEach, vi } from 'vitest';

afterEach(cleanup);

beforeEach(() => {
  // Reka positions and scrolls overlays through browser APIs that jsdom lacks.
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
});
