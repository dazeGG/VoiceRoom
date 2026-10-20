// jsdom lays nothing out: a chart's plot box gets a width, and the size
// observer a stand-in, so the chart draws.

import { vi } from 'vitest';

export const PLOT_WIDTH = 600;

/** Call from beforeEach; the returned function undoes it (afterEach). */
export function stubChartBox(): () => void {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('chart-plot') ? PLOT_WIDTH : 0;
    }
  });
  return () => {
    Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
  };
}
