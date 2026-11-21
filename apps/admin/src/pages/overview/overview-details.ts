import type { LiveRoom } from '@voiceroom/shared/contracts/admin';
import { CALL_FEEDBACK_BAD_TAGS } from '@voiceroom/shared/contracts/feedback';
import { CALL_FEEDBACK_TAG_LABELS } from '@voiceroom/shared/feedback-labels';

const badTags: ReadonlySet<string> = new Set(CALL_FEEDBACK_BAD_TAGS);

export function badFeedbackTags<T extends { tag: string; count: number }>(tags: readonly T[]): T[] {
  return tags.filter(({ tag }) => badTags.has(tag)).sort((a, b) => b.count - a.count);
}

export function tagLabel(tag: string): string {
  const labels: Record<string, string> = CALL_FEEDBACK_TAG_LABELS;
  return labels[tag] ?? tag;
}

export const roomName = (room: Pick<LiveRoom, 'roomId' | 'name'>) => room.name || room.roomId;
