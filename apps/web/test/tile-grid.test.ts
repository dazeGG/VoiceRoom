import { afterEach, describe, expect, test, vi } from 'vitest';
import { fitTileGrid, fitTiles, MIN_TILE_WIDTH } from '../src/lib/features/room/client/ui/tile-grid';

const GAP = 16;

describe('fitTileGrid', () => {
  test('one person fills the stage in 16:9', () => {
    expect(fitTileGrid({ width: 1200, height: 600, count: 1, gap: GAP })).toEqual({
      columns: 1,
      tileWidth: 1066,
      scroll: false
    });
  });

  test('two people sit side by side on a wide stage and one above the other on a tall one', () => {
    expect(fitTileGrid({ width: 1200, height: 600, count: 2, gap: GAP })).toMatchObject({ columns: 2, tileWidth: 592 });
    expect(fitTileGrid({ width: 400, height: 800, count: 2, gap: GAP })).toMatchObject({ columns: 1, tileWidth: 400 });
  });

  test('between layouts with tiles of the same size the fuller rows win', () => {
    // On a 1280x720 stage five or six across give the same tile: five rows of five, not a lone last tile.
    expect(fitTileGrid({ width: 1240, height: 535, count: 25, gap: GAP }).columns).toBe(5);
    // Three or four across give the same tile too: four and three, not three, three and one.
    expect(fitTileGrid({ width: 1240, height: 535, count: 7, gap: GAP }).columns).toBe(4);
  });

  test('three and four people on a laptop stage make two rows of two', () => {
    expect(fitTileGrid({ width: 1240, height: 620, count: 3, gap: GAP }).columns).toBe(2);
    expect(fitTileGrid({ width: 1240, height: 620, count: 4, gap: GAP }).columns).toBe(2);
  });

  test('on an ultrawide stage people line up in one row', () => {
    expect(fitTileGrid({ width: 3400, height: 560, count: 4, gap: GAP }).columns).toBe(4);
  });

  test('twenty-five people fit without scrolling on a 1280x720 laptop', () => {
    // The stage of a 1280x720 window: the top bar and the dock take their share.
    expect(fitTileGrid({ width: 1240, height: 480, count: 25, gap: GAP }).scroll).toBe(false);
  });

  test('from one to twenty-five people, on any stage, tiles are the largest that fit or else readable', () => {
    const stages: Array<[width: number, height: number]> = [
      [1240, 480],
      [880, 480],
      [1880, 900],
      [2500, 1300],
      [3400, 560],
      [1500, 520],
      [720, 980],
      [480, 900]
    ];
    for (const [width, height] of stages) {
      for (let count = 1; count <= 25; count += 1) {
        const fit = fitTileGrid({ width, height, count, gap: GAP });
        const rows = Math.ceil(count / fit.columns);
        const label = `${count} people on ${width}x${height}`;
        expect(fit.columns * fit.tileWidth + (fit.columns - 1) * GAP, label).toBeLessThanOrEqual(width);
        if (fit.scroll) {
          expect(fit.tileWidth, label).toBeGreaterThanOrEqual(MIN_TILE_WIDTH);
          continue;
        }
        expect(rows * ((fit.tileWidth * 9) / 16) + (rows - 1) * GAP, label).toBeLessThanOrEqual(height + 1);
        // No other count of columns gives everyone a bigger tile.
        for (let columns = 1; columns <= count; columns += 1) {
          const otherRows = Math.ceil(count / columns);
          const other = Math.min(
            (width - GAP * (columns - 1)) / columns,
            ((height - GAP * (otherRows - 1)) / otherRows) * (16 / 9)
          );
          expect(other, `${label}, ${columns} columns`).toBeLessThan(fit.tileWidth + 1);
        }
      }
    }
  });

  test('a stage too small for everyone keeps readable tiles and scrolls', () => {
    const fit = fitTileGrid({ width: 800, height: 400, count: 25, gap: GAP });
    expect(fit.scroll).toBe(true);
    expect(fit.tileWidth).toBeGreaterThanOrEqual(MIN_TILE_WIDTH);
    expect(fit.columns * fit.tileWidth + (fit.columns - 1) * GAP).toBeLessThanOrEqual(800);
  });

  test('a stage narrower than one readable tile gives each tile its whole width', () => {
    expect(fitTileGrid({ width: 150, height: 300, count: 6, gap: GAP })).toEqual({
      columns: 1,
      tileWidth: 150,
      scroll: true
    });
  });
});

describe('fitTiles', () => {
  let resized: (() => void) | null = null;

  afterEach(() => {
    resized = null;
    document.body.innerHTML = '';
  });

  function makeGrid(width: number, height: number, tiles: number) {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resized = callback;
        }
        observe(): void {}
        disconnect(): void {}
      }
    );
    const grid = document.createElement('div');
    grid.style.columnGap = `${GAP}px`;
    let size = { width, height };
    Object.defineProperty(grid, 'clientWidth', { get: () => size.width });
    Object.defineProperty(grid, 'clientHeight', { get: () => size.height });
    const resizeTo = (next: { width: number; height: number }) => {
      size = next;
    };
    for (let index = 0; index < tiles; index += 1) grid.append(document.createElement('div'));
    document.body.append(grid);
    return { grid, resizeTo };
  }

  test('sizes the tiles to the grid, again when it resizes and when someone joins', async () => {
    const { grid, resizeTo } = makeGrid(1200, 600, 2);
    const stop = fitTiles(grid);
    expect(grid.style.getPropertyValue('--tile-width')).toBe('592px');
    expect(grid.style.getPropertyValue('--tile-gutter')).toBe('0px');
    expect(grid.dataset.scroll).toBe('false');

    resizeTo({
      width: 400,
      height: 800
    });
    resized?.();
    expect(grid.style.getPropertyValue('--tile-width')).toBe('400px');

    grid.append(document.createElement('div'), document.createElement('div'));
    await vi.waitFor(() => expect(grid.style.getPropertyValue('--tile-width')).toBe('334px'));
    // One column of 334px in 400px: the row is held to it and centred by its margins.
    expect(grid.style.getPropertyValue('--tile-gutter')).toBe('33px');
    for (let index = 0; index < 21; index += 1) grid.append(document.createElement('div'));
    await vi.waitFor(() => expect(grid.dataset.scroll).toBe('true'));

    stop();
    expect(grid.style.getPropertyValue('--tile-width')).toBe('');
    expect(grid.style.getPropertyValue('--tile-gutter')).toBe('');
    expect(grid.dataset.scroll).toBeUndefined();
  });

  test('leaves a hidden grid to the stylesheet', () => {
    const { grid } = makeGrid(0, 0, 3);
    fitTiles(grid);
    expect(grid.style.getPropertyValue('--tile-width')).toBe('');
  });
});
