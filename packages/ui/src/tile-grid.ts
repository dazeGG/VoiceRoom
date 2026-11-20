// The room's tiles keep the 16:9 shape at any count and on any screen, as in
// Discord: the number of columns is picked for the largest tile that lets
// everyone fit, and a short last row sits centred under the others. Past the
// smallest readable tile the grid stops shrinking and scrolls instead.

/** Below this width a tile is too small to read its name, so the grid scrolls. */
export const MIN_TILE_WIDTH = 150;
const TILE_ASPECT = 16 / 9;

export interface TileGridFit {
  columns: number;
  /** Whole pixels, so a row of them and its gaps never wraps by a rounding error. */
  tileWidth: number;
  scroll: boolean;
}

interface TileGridBox {
  width: number;
  height: number;
  count: number;
  gap: number;
}

export function fitTileGrid({ width, height, count, gap }: TileGridBox, minTileWidth = MIN_TILE_WIDTH): TileGridFit {
  const across = (columns: number): number => (width - gap * (columns - 1)) / columns;
  let best = { columns: 1, tileWidth: 0, empty: Infinity };
  for (let columns = 1; columns <= Math.max(1, count); columns += 1) {
    const rows = Math.ceil(count / columns);
    const tileWidth = Math.min(across(columns), ((height - gap * (rows - 1)) / rows) * TILE_ASPECT);
    const empty = rows * columns - count;
    // Between tiles of the same size the fuller rows win: seven people make
    // four and three, not three, three and one.
    const tie = Math.abs(tileWidth - best.tileWidth) <= 0.5;
    if ((!tie && tileWidth > best.tileWidth) || (tie && empty < best.empty)) best = { columns, tileWidth, empty };
  }
  if (best.tileWidth >= minTileWidth)
    return { columns: best.columns, tileWidth: Math.floor(best.tileWidth), scroll: false };
  const columns = Math.max(1, Math.min(count, Math.floor((width + gap) / (minTileWidth + gap))));
  return { columns, tileWidth: Math.floor(across(columns)), scroll: true };
}

export function fitWidgetTileGrid(box: TileGridBox): TileGridFit {
  const { count, width, height, gap } = box;
  const minWidth = 32;
  if (count < 9 || width < 3 * minWidth + 2 * gap) return fitTileGrid(box, minWidth);
  const columns = 3;
  const rows = Math.ceil(count / columns);
  const byWidth = (width - gap * (columns - 1)) / columns;
  const byHeight = ((height - gap * (rows - 1)) / rows) * TILE_ASPECT;
  return {
    columns,
    tileWidth: Math.floor(Math.min(byWidth, Math.max(minWidth, byHeight))),
    scroll: byHeight < minWidth
  };
}

/** Sizes the tiles of a grid to its own box, again whenever it resizes or a tile comes or goes. */
export function fitTiles(grid: HTMLElement, fitGrid = fitTileGrid): () => void {
  const widget = fitGrid === fitWidgetTileGrid;
  const apply = (): void => {
    // The size is read once, before anything is written: a new tile width lays
    // the grid out again, which can bring its scrollbar in or out and change
    // clientWidth. A margin taken from that second width no longer matches the
    // columns, the row wraps, the scrollbar flips and the grid refits forever.
    let width = widget ? grid.offsetWidth : grid.clientWidth;
    let height = grid.clientHeight;
    // A hidden grid has no size to fit to; the tiles keep the stylesheet's own.
    if (width === 0 || height === 0) return;
    if (!widget) {
      // Client dimensions can round a fractional box up. Keep enough room
      // for the chosen columns and gutter to fit without an extra flex row.
      width -= 1;
      height -= 1;
    }
    const gap = Number.parseFloat(getComputedStyle(grid).columnGap) || 0;
    const count = grid.childElementCount;
    let fit = fitGrid({ width, height, count, gap });
    // Fit against the full widget width first. Only a stage that must scroll uses the narrower scrollport.
    if (widget && fit.scroll && grid.clientWidth > 0 && grid.clientWidth < width) {
      width = grid.clientWidth;
      fit = fitGrid({ width, height, count, gap });
    }
    const row = fit.columns * fit.tileWidth + (fit.columns - 1) * gap;
    grid.style.setProperty('--tile-width', `${fit.tileWidth}px`);
    grid.style.setProperty('--tile-gutter', `${Math.floor((width - row) / 2)}px`);
    grid.dataset.scroll = String(fit.scroll);
    if (widget) {
      grid.classList.toggle('tile-grid--scroll', fit.scroll);
      grid.classList.toggle('widget-call__tiles--fit', !fit.scroll);
    }
  };
  const resize = new ResizeObserver(apply);
  const tiles = new MutationObserver(apply);
  resize.observe(grid);
  tiles.observe(grid, { childList: true });
  apply();
  return () => {
    resize.disconnect();
    tiles.disconnect();
    grid.style.removeProperty('--tile-width');
    grid.style.removeProperty('--tile-gutter');
    delete grid.dataset.scroll;
    if (widget) grid.classList.remove('tile-grid--scroll', 'widget-call__tiles--fit');
  };
}

export function fitWidgetTiles(grid: HTMLElement): () => void {
  return fitTiles(grid, fitWidgetTileGrid);
}
