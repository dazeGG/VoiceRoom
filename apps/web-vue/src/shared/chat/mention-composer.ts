import { reactive } from 'vue';
import type { MembershipMember } from '@voice-room/shared/contracts/membership';
import { MAX_MENTION_CANDIDATES, MAX_MENTIONS_PER_MESSAGE } from '@voice-room/shared/mentions';
import type { RoomMessageContentV1, RoomMessageSegmentV1 } from '@voice-room/shared/room-message-content';
import { keysOf } from '@/shared/utils/collections';

export type SelectedMention = Pick<MembershipMember, 'userId' | 'displayName' | 'login'>;

function mentionToken(member: SelectedMention): string {
  return `@${member.login}`;
}

export function createMentionComposer() {
  const state = reactive<{
    query: string;
    anchorStart: number;
    activeIndex: number;
    candidates: MembershipMember[];
    selected: SelectedMention[];
    composing: boolean;
  }>({ query: '', anchorStart: -1, activeIndex: 0, candidates: [], selected: [], composing: false });

  function update(text: string, caret: number): string {
    if (state.composing) return '';
    const before = text.slice(0, caret);
    const typed = before.match(/(?:^|\s)@([^\s@]{0,80})$/u)?.[1];
    state.anchorStart = typed === undefined ? -1 : caret - typed.length - 1;
    state.query = typed ?? '';
    state.activeIndex = 0;
    if (typed === undefined) state.candidates = [];
    return state.query;
  }

  function setCandidates(value: MembershipMember[]): void {
    const chosen = keysOf(state.selected, (item) => item.userId);
    state.candidates = value.filter((item) => !chosen.has(item.userId)).slice(0, MAX_MENTION_CANDIDATES);
    state.activeIndex = Math.min(state.activeIndex, Math.max(0, state.candidates.length - 1));
  }

  function choose(
    text: string,
    caret: number,
    member = state.candidates[state.activeIndex]
  ): { text: string; caret: number } | null {
    if (!member || state.anchorStart < 0 || state.selected.length >= MAX_MENTIONS_PER_MESSAGE) return null;
    const replacement = `${mentionToken(member)} `;
    const next = text.slice(0, state.anchorStart) + replacement + text.slice(caret);
    // Computed before close(), which resets the anchor.
    const nextCaret = state.anchorStart + replacement.length;
    if (!state.selected.some((item) => item.userId === member.userId)) state.selected = [...state.selected, member];
    close();
    return { text: next, caret: nextCaret };
  }

  function remove(userId: string): void {
    state.selected = state.selected.filter((item) => item.userId !== userId);
  }
  function toContent(text: string): RoomMessageContentV1 {
    const pending = state.selected.map((member) => ({ member, token: mentionToken(member) }));
    const segments: RoomMessageSegmentV1[] = [];
    let offset = 0;
    while (offset < text.length) {
      let nextIndex = -1;
      let next = -1;
      for (const [index, mention] of pending.entries()) {
        const found = text.indexOf(mention.token, offset);
        if (found >= 0 && (nextIndex < 0 || found < nextIndex)) {
          nextIndex = found;
          next = index;
        }
      }
      const [match] = next < 0 ? [] : pending.splice(next, 1);
      if (!match) {
        segments.push({ type: 'text', text: text.slice(offset) });
        break;
      }
      if (nextIndex > offset) segments.push({ type: 'text', text: text.slice(offset, nextIndex) });
      segments.push({ type: 'mention', userId: match.member.userId, label: match.token });
      offset = nextIndex + match.token.length;
    }
    if (segments.length === 0) segments.push({ type: 'text', text });
    return { version: 1, segments };
  }
  function move(delta: number): void {
    if (state.candidates.length)
      state.activeIndex = (state.activeIndex + delta + state.candidates.length) % state.candidates.length;
  }
  function close(): void {
    state.query = '';
    state.anchorStart = -1;
    state.activeIndex = 0;
    state.candidates = [];
  }
  function reset(): void {
    close();
    state.selected = [];
    state.composing = false;
  }
  // Brings back the mentions of a restored draft so they still notify on send.
  function restore(value: readonly SelectedMention[]): void {
    close();
    state.selected = value.slice(0, MAX_MENTIONS_PER_MESSAGE).map((member) => ({ ...member }));
  }

  return {
    get activeIndex() {
      return state.activeIndex;
    },
    get candidates() {
      return state.candidates;
    },
    get isOpen() {
      return state.anchorStart >= 0 && state.candidates.length > 0;
    },
    get query() {
      return state.query;
    },
    get selected() {
      return state.selected;
    },
    choose,
    close,
    move,
    remove,
    reset,
    restore,
    setCandidates,
    setComposing(value: boolean) {
      state.composing = value;
    },
    toContent,
    update
  };
}
