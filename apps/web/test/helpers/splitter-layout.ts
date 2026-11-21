import { vi } from 'vitest';

// jsdom has no layout. Give the panel group and its exposed handle the boxes
// they would have in a 1024px viewport so Reka can calculate real pixel deltas.
export function stubSplitterLayout(): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('ui-splitter')) return new DOMRect(0, 0, 1024, 640);
    if (this.getAttribute('role') === 'separator' && this.hasAttribute('aria-valuetext')) {
      const width = Number.parseInt(this.getAttribute('aria-valuetext') ?? '', 10);
      return new DOMRect(width - 4, 0, 8, 640);
    }
    return new DOMRect();
  });
}
