/**
 * Finds the emoji inside a piece of text, so text can draw them with the same
 * artwork as the picker and reactions instead of leaving them to the platform
 * font (which on Windows draws flags as letters).
 *
 * Only what the artwork covers is recognised — `emoji-coverage.json`, the same
 * catalogue the picker offers — so every part marked as an emoji has a file,
 * and anything newer than the pinned set stays text rather than a broken
 * image.
 */

import coverage from './emoji-coverage.json';

export type EmojiTextPart =
  | { kind: 'text'; text: string }
  /** `text` is exactly what was written; `emoji` is its catalogue spelling. */
  | { kind: 'emoji'; text: string; emoji: string };

interface TrieNode {
  next: Map<number, TrieNode>;
  emoji?: string;
}

const VS16 = 0xfe0f;
const FIRST_PICTOGRAPH = 0x1f000;

function codePoints(value: string): number[] {
  return Array.from(value, (character) => character.codePointAt(0) ?? 0);
}

function buildTrie(emojis: readonly string[]): TrieNode {
  const root: TrieNode = { next: new Map() };
  const add = (points: readonly number[], emoji: string) => {
    let node = root;
    for (const point of points) {
      let child = node.next.get(point);
      if (!child) {
        child = { next: new Map() };
        node.next.set(point, child);
      }
      node = child;
    }
    node.emoji ??= emoji;
  };

  for (const emoji of emojis) {
    const points = codePoints(emoji);
    add(points, emoji);
    // Keyboards and older systems often leave the presentation selector out.
    // A sequence or a pictograph without it is still unmistakably an emoji; a
    // lone text-default character such as ❤ or © stays text, as it was typed.
    const bare = points.filter((point) => point !== VS16);
    if (bare.length !== points.length && (bare.length > 1 || bare[0] >= FIRST_PICTOGRAPH)) add(bare, emoji);
  }
  return root;
}

const TRIE = buildTrie(coverage.emojis);

/** The longest emoji starting at `start`, as its end offset and catalogue spelling. */
function matchAt(text: string, start: number): { end: number; emoji: string } | null {
  let node = TRIE;
  let index = start;
  let match: { end: number; emoji: string } | null = null;

  while (index < text.length) {
    const point = text.codePointAt(index) ?? 0;
    const width = point > 0xffff ? 2 : 1;
    const child = node.next.get(point);
    if (child) {
      node = child;
      index += width;
      if (node.emoji) match = { end: index, emoji: node.emoji };
      continue;
    }
    // A selector the catalogue spelling does not carry at this position is
    // still part of what was written: skip it, and let a match that just
    // ended take it along.
    if (point === VS16) {
      index += width;
      if (match && match.end === index - width) match = { end: index, emoji: match.emoji };
      continue;
    }
    break;
  }
  return match;
}

export function splitEmoji(text: string): EmojiTextPart[] {
  const parts: EmojiTextPart[] = [];
  let pending = '';
  let index = 0;

  while (index < text.length) {
    const match = TRIE.next.has(text.codePointAt(index) ?? 0) ? matchAt(text, index) : null;
    if (match) {
      if (pending) parts.push({ kind: 'text', text: pending });
      pending = '';
      parts.push({ kind: 'emoji', text: text.slice(index, match.end), emoji: match.emoji });
      index = match.end;
      continue;
    }
    const point = text.codePointAt(index) ?? 0;
    const width = point > 0xffff ? 2 : 1;
    pending += text.slice(index, index + width);
    index += width;
  }

  if (pending) parts.push({ kind: 'text', text: pending });
  return parts;
}

/** Whether the text holds anything the artwork draws. */
export function hasEmoji(text: string): boolean {
  return splitEmoji(text).some((part) => part.kind === 'emoji');
}
