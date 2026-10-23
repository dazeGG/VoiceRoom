// The page every history endpoint serves: list by mode, drop what the viewer
// may not see, project the rest in one go, and point the cursors at both ends.

import type { HistoryMode } from '@voice-room/shared/contracts/messages';
import type { CursorTuple } from '../../platform/cursor-codec.ts';

/** What a history request may carry, as the query string hands it over. */
export type HistoryQueryInput = Readonly<{
  mode?: string | undefined;
  limit?: string | undefined;
  cursor?: string | undefined;
  messageId?: string | undefined;
}>;
type RawPage<M> = { messages: M[]; hasMoreBefore: boolean; hasMoreAfter: boolean };
type AnchoredMode = Exclude<HistoryMode, 'latest'>;

export async function pageHistory<M, D extends { cursor: string }>({
  mode,
  cursor,
  listLatest,
  listAnchored,
  decodeAnchor,
  invalidCursor,
  canView,
  project,
  toDto
}: {
  mode: HistoryMode;
  cursor: string | undefined;
  listLatest: () => Promise<RawPage<M>>;
  listAnchored: (mode: AnchoredMode, anchor: CursorTuple) => Promise<RawPage<M>>;
  decodeAnchor: (cursor: string | undefined) => CursorTuple;
  invalidCursor: () => Error;
  canView: (message: M) => boolean | Promise<boolean>;
  project: (visible: M[]) => Promise<M[]> | M[];
  toDto: (message: M) => D;
}) {
  let page: RawPage<M>;
  if (mode === 'latest') {
    page = await listLatest();
  } else {
    let anchor: CursorTuple;
    try {
      anchor = decodeAnchor(cursor);
    } catch {
      throw invalidCursor();
    }
    page = await listAnchored(mode, anchor);
  }
  const visible: M[] = [];
  for (const message of page.messages) {
    if (await canView(message)) visible.push(message);
  }
  const projected = visible.length > 0 ? await project(visible) : visible;
  const messages = projected.map(toDto);
  const first = messages[0];
  const last = messages.at(-1);
  return {
    contractVersion: 1 as const,
    mode,
    messages,
    pageInfo: {
      ...(first === undefined ? {} : { before: first.cursor }),
      ...(last === undefined ? {} : { after: last.cursor }),
      ...(mode === 'around' && cursor !== undefined ? { around: cursor } : {}),
      hasMoreBefore: page.hasMoreBefore,
      hasMoreAfter: page.hasMoreAfter
    }
  };
}
