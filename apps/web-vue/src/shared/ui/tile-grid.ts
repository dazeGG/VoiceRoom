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

export function fitTileGrid({
  width,
  height,
  count,
  gap
}: {
  width: number;
  height: number;
  count: number;
  gap: number;
}): TileGridFit {
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
  if (best.tileWidth >= MIN_TILE_WIDTH)
    return { columns: best.columns, tileWidth: Math.floor(best.tileWidth), scroll: false };
  const columns = Math.max(1, Math.min(count, Math.floor((width + gap) / (MIN_TILE_WIDTH + gap))));
  return { columns, tileWidth: Math.floor(across(columns)), scroll: true };
}

/** Sizes the tiles of a grid to its own box, again whenever it resizes or a tile comes or goes. */
export function fitTiles(grid: HTMLElement): () => void {
  const apply = (): void => {
    // The size is read once, before anything is written: a new tile width lays
    // the grid out again, which can bring its scrollbar in or out and change
    // clientWidth. A margin taken from that second width no longer matches the
    // columns, the row wraps, the scrollbar flips and the grid refits forever.
    const width = grid.clientWidth;
    const height = grid.clientHeight;
    // A hidden grid has no size to fit to; the tiles keep the stylesheet's own.
    if (width === 0 || height === 0) return;
    const gap = Number.parseFloat(getComputedStyle(grid).columnGap) || 0;
    const fit = fitTileGrid({ width, height, count: grid.childElementCount, gap });
    const row = fit.columns * fit.tileWidth + (fit.columns - 1) * gap;
    grid.style.setProperty('--tile-width', `${fit.tileWidth}px`);
    // The rows are held to the chosen columns, or the tiles would fill them past it.
    grid.style.setProperty('--tile-gutter', `${Math.floor((width - row) / 2)}px`);
    grid.dataset.scroll = String(fit.scroll);
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
  };
}
