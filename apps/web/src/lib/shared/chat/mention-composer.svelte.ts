import type { MembershipMember } from '@voice-room/shared/membership';
import { MAX_MENTION_CANDIDATES, MAX_MENTIONS_PER_MESSAGE } from '@voice-room/shared/mentions';
import type { RoomMessageContentV1, RoomMessageSegmentV1 } from '@voice-room/shared/room-message-content';

export type SelectedMention = Pick<MembershipMember, 'userId' | 'displayName' | 'login'>;

function mentionToken(member: SelectedMention): string {
  return `@${member.login}`;
}

export function createMentionComposer() {
  let query = $state('');
  let anchorStart = $state(-1);
  let activeIndex = $state(0);
  let candidates = $state<MembershipMember[]>([]);
  let selected = $state<SelectedMention[]>([]);
  let composing = $state(false);

  function update(text: string, caret: number): string {
    if (composing) return '';
    const before = text.slice(0, caret);
    const match = before.match(/(?:^|\s)@([^\s@]{0,80})$/u);
    anchorStart = match ? caret - match[1].length - 1 : -1;
    query = match?.[1] ?? '';
    activeIndex = 0;
    if (!match) candidates = [];
    return query;
  }

  function setCandidates(value: MembershipMember[]): void {
    const chosen = new Set(selected.map((item) => item.userId));
    candidates = value.filter((item) => !chosen.has(item.userId)).slice(0, MAX_MENTION_CANDIDATES);
    activeIndex = Math.min(activeIndex, Math.max(0, candidates.length - 1));
  }

  function choose(text: string, caret: number, member = candidates[activeIndex]): { text: string; caret: number } | null {
    if (!member || anchorStart < 0 || selected.length >= MAX_MENTIONS_PER_MESSAGE) return null;
    const replacement = `${mentionToken(member)} `;
    const next = text.slice(0, anchorStart) + replacement + text.slice(caret);
    if (!selected.some((item) => item.userId === member.userId)) selected = [...selected, member];
    close();
    return { text: next, caret: anchorStart + replacement.length };
  }

  function remove(userId: string): void { selected = selected.filter((item) => item.userId !== userId); }
  function toContent(text: string): RoomMessageContentV1 {
    const pending = selected.map((member) => ({ member, token: mentionToken(member) }));
    const segments: RoomMessageSegmentV1[] = [];
    let offset = 0;
    while (offset < text.length) {
      let nextIndex = -1;
      let next = -1;
      for (let index = 0; index < pending.length; index += 1) {
        const found = text.indexOf(pending[index].token, offset);
        if (found >= 0 && (nextIndex < 0 || found < nextIndex)) { nextIndex = found; next = index; }
      }
      if (next < 0) { segments.push({ type: 'text', text: text.slice(offset) }); break; }
      if (nextIndex > offset) segments.push({ type: 'text', text: text.slice(offset, nextIndex) });
      const match = pending.splice(next, 1)[0];
      segments.push({ type: 'mention', userId: match.member.userId, label: match.token });
      offset = nextIndex + match.token.length;
    }
    if (segments.length === 0) segments.push({ type: 'text', text });
    return { version: 1, segments };
  }
  function move(delta: number): void { if (candidates.length) activeIndex = (activeIndex + delta + candidates.length) % candidates.length; }
  function close(): void { query = ''; anchorStart = -1; activeIndex = 0; candidates = []; }
  function reset(): void { close(); selected = []; composing = false; }

  return {
    get activeIndex() { return activeIndex; }, get candidates() { return candidates; }, get isOpen() { return anchorStart >= 0 && candidates.length > 0; },
    get query() { return query; }, get selected() { return selected; },
    choose, close, move, remove, reset, setCandidates, setComposing(value: boolean) { composing = value; }, toContent, update
  };
}
