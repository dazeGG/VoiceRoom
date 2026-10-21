// Fitting the tiles lays the grid out again, and that can bring its scrollbar
// in or out. The margin that holds the row to the chosen columns must come
// from the same width the columns were chosen for, or the row wraps, the
// scrollbar flips and the grid refits forever (tiles jumping between two
// layouts many times a second on a small stage).

import { afterEach, expect, test, vi } from 'vitest';
import { fitTileGrid, fitTiles } from '../src/lib/features/room/client/ui/tile-grid';

const GAP = 16;
const SCROLLBAR = 10;

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

test('the row margin comes from the width the columns were fitted to, even when the scrollbar flips', () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    }
  );
  const grid = document.createElement('div');
  grid.style.columnGap = `${GAP}px`;
  for (let index = 0; index < 3; index += 1) grid.append(document.createElement('div'));
  // The grid is 620x235 until its tiles are resized; the new layout then
  // overflows for a moment and a scrollbar takes its width.
  Object.defineProperty(grid, 'clientWidth', {
    get: () => (grid.style.getPropertyValue('--tile-width') ? 620 - SCROLLBAR : 620)
  });
  Object.defineProperty(grid, 'clientHeight', { get: () => 235 });
  document.body.append(grid);

  const stop = fitTiles(grid);

  const fit = fitTileGrid({ width: 620, height: 235, count: 3, gap: GAP });
  const row = fit.columns * fit.tileWidth + (fit.columns - 1) * GAP;
  expect(grid.style.getPropertyValue('--tile-width')).toBe(`${fit.tileWidth}px`);
  expect(grid.style.getPropertyValue('--tile-gutter')).toBe(`${Math.floor((620 - row) / 2)}px`);
  stop();
});
