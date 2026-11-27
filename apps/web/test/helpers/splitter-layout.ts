import { vi } from 'vitest';

// jsdom has no layout. Give the panel group and its exposed handle the boxes
// they would have in a 1024px viewport so Reka can calculate real pixel deltas.
export function stubSplitterLayout(): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('ui-splitter')) return new DOMRect(0, 0, 1024, 640);
    if (this.getAttribute('role') === 'separator' && this.hasAttribute('aria-valuetext')) {
      const size = Number.parseInt(this.getAttribute('aria-valuetext') ?? '', 10);
      return this.getAttribute('aria-orientation') === 'horizontal'
        ? new DOMRect(0, size - 4, 1024, 8)
        : new DOMRect(size - 4, 0, 8, 640);
    }
    return new DOMRect();
  });
}
