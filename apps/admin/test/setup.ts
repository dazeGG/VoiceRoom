import { cleanup } from '@testing-library/vue';
import { afterEach, beforeAll, beforeEach, vi } from 'vitest';

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

// jsdom has no dialog lifecycle APIs. This adapter only models visibility and
// initial focus; actual modal inertness/Tab/Escape behavior is browser-tested.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
    this.querySelector<HTMLElement>(
      'input:not(:disabled), textarea:not(:disabled), select:not(:disabled), button:not(:disabled)'
    )?.focus();
  };
  HTMLDialogElement.prototype.close = function () {
    if (!this.open) return;
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
});
