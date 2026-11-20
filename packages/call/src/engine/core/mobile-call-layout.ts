// Where people go on a phone in portrait: the arithmetic of the mobile call
// layout, kept apart from the components so it can be checked on its own.

export const GRID_PAGE_SIZE = 9;

/** Above this many tiles the focus strip scrolls instead of sharing its width. */
export const STRIP_FITTING_TILES = 3;

export type MobileCallView = 'grid' | 'focus';
export type PipCorner = 'tl' | 'tr' | 'bl' | 'br';

/** Tiles per row, top to bottom, for a page of that many people. */
const GRID_ROWS: Record<number, number[]> = {
  1: [1],
  2: [1, 1],
  3: [1, 2],
  4: [2, 2],
  5: [1, 2, 2],
  6: [2, 2, 2],
  7: [2, 2, 3],
  8: [2, 3, 3],
  9: [3, 3, 3]
};

export function gridRows(count: number): number[] {
  return GRID_ROWS[Math.max(1, Math.min(GRID_PAGE_SIZE, count))] ?? [1];
}

/**
 * The grid's pages, each split into rows. Everyone else comes first and I am
 * the last tile of the first page; whoever does not fit goes to the next pages.
 */
export function gridPages(selfId: string, otherIds: string[]): string[][][] {
  const order = selfId
    ? [...otherIds.slice(0, GRID_PAGE_SIZE - 1), selfId, ...otherIds.slice(GRID_PAGE_SIZE - 1)]
    : [...otherIds];
  const pages: string[][][] = [];
  for (let start = 0; start < order.length; start += GRID_PAGE_SIZE) {
    const page = order.slice(start, start + GRID_PAGE_SIZE);
    let taken = 0;
    pages.push(
      gridRows(page.length).map((size) => {
        const row = page.slice(taken, taken + size);
        taken += size;
        return row;
      })
    );
  }
  return pages;
}

/**
 * Who follows the active speaker: the one talking now, or else the last one who
 * talked while they are still here. I am never the active speaker.
 */
export function nextActiveSpeaker(current: string, others: Array<{ id: string; speaking: boolean }>): string {
  const stillHere = others.some((person) => person.id === current);
  if (stillHere && others.some((person) => person.id === current && person.speaking)) return current;
  const talking = others.find((person) => person.speaking);
  if (talking) return talking.id;
  return stillHere ? current : (others[0]?.id ?? '');
}

/** The big tile in focus: whoever is pinned, else the active speaker. */
export function focusSpotlight({
  selfId,
  otherIds,
  pinnedId,
  activeSpeakerId
}: {
  selfId: string;
  otherIds: string[];
  pinnedId: string;
  activeSpeakerId: string;
}): string {
  if (pinnedId && (pinnedId === selfId || otherIds.includes(pinnedId))) return pinnedId;
  if (otherIds.includes(activeSpeakerId)) return activeSpeakerId;
  return otherIds[0] ?? selfId;
}

/** The corner a dropped picture-in-picture snaps to: the quarter its centre is in. */
export function nearestCorner(
  centre: { x: number; y: number },
  viewport: { width: number; height: number }
): PipCorner {
  return `${centre.y < viewport.height / 2 ? 't' : 'b'}${centre.x < viewport.width / 2 ? 'l' : 'r'}`;
}
