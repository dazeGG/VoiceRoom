import type { ReactionSummary } from '@voice-room/shared/reactions';

export type ReactionSnapshotView = ReactionSummary & { pending: boolean; error: string };

export function replaceReactionSnapshot(current: ReactionSnapshotView[], summaries: ReactionSummary[]): ReactionSnapshotView[] {
  const previous = new Map(current.map((item) => [item.emoji, item]));
  const next = summaries.flatMap((summary) => {
    const prior = previous.get(summary.emoji);
    const view = { ...summary, count: Math.max(0, summary.count), pending: prior?.pending ?? false, error: '' };
    return view.count === 0 && !view.pending ? [] : [view];
  });
  const present = new Set(summaries.map((item) => item.emoji));
  for (const item of current) if (item.pending && !present.has(item.emoji)) next.push(item);
  return next;
}
