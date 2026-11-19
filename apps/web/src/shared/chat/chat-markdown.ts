import type { RoomMessageContentV1, RoomMessageSegmentV1 } from '@voice-room/shared/room-message-content';
import { parseChatLinks } from '@/shared/utils/linkify';

type Atom = Exclude<RoomMessageSegmentV1, { type: 'text' }>;
type Emphasis = 'strong' | 'em' | 'del';

export type MarkdownInline =
  | { kind: 'text' | 'code'; text: string }
  | { kind: Emphasis; children: MarkdownInline[] }
  | { kind: 'link'; href: string; label: string }
  | { kind: 'mention'; userId: string; label: string };

export type MarkdownBlock =
  | { kind: 'paragraph' | 'quote'; children: MarkdownInline[] }
  | { kind: 'list'; items: MarkdownInline[][]; firstNumber: number | null }
  | { kind: 'code'; text: string };

interface Source {
  text: string;
  atoms: Map<number, Atom>;
}

function sourceOf(fallback: string, content?: RoomMessageContentV1 | null): Source {
  const atoms = new Map<number, Atom>();
  if (content?.version !== 1 || !Array.isArray(content.segments)) return { text: fallback, atoms };

  let text = '';
  for (const segment of content.segments) {
    if (segment.type === 'text') {
      text += segment.text;
    } else {
      // Positions, rather than the marker itself, identify trusted structured
      // links and mentions. Typed text cannot impersonate either kind of atom.
      atoms.set(text.length, segment);
      text += '\uFFFC';
    }
  }
  return { text, atoms };
}

function literalText(source: Source, start: number, end: number): string {
  return source.text.slice(start, end).replaceAll('\uFFFC', (marker, offset: number) => {
    return source.atoms.get(start + offset)?.label ?? marker;
  });
}

function httpLink(href: string): string | null {
  try {
    const url = new URL(href);
    return url.protocol === 'http:' || url.protocol === 'https:' ? href : null;
  } catch {
    return null;
  }
}

function appendText(nodes: MarkdownInline[], text: string): void {
  const last = nodes.at(-1);
  if (last?.kind === 'text') last.text += text;
  else nodes.push({ kind: 'text', text });
}

function emphasisOf(marker: string): Emphasis {
  if (marker === '~~') return 'del';
  return marker.length === 2 ? 'strong' : 'em';
}

function inlineCodeEnd(text: string, marker: string, start: number, end: number): number {
  let close = text.indexOf(marker, start);
  while (close >= 0 && close + marker.length <= end) {
    if (text[close - 1] !== '`' && text[close + marker.length] !== '`') return close;
    close = text.indexOf(marker, close + marker.length);
  }
  return -1;
}

function bareLinkText(text: string, cursor: number, end: number, openMarkers: readonly { marker: string }[]): string {
  const followingAtom = text.indexOf('\uFFFC', cursor);
  const limit = followingAtom < 0 ? end : Math.min(end, followingAtom);
  const link = parseChatLinks(text.slice(cursor, limit))[0];
  if (link?.kind !== 'link') return '';

  // The URL tokenizer also accepts Markdown characters in paths. Leave
  // trailing markers for the inline parser when they close surrounding text.
  let closingMarkers = '';
  let trim = 0;
  for (let index = openMarkers.length - 1; index >= 0; index -= 1) {
    closingMarkers += openMarkers[index]?.marker ?? '';
    if (closingMarkers.length >= link.text.length) break;
    if (link.text.endsWith(closingMarkers)) trim = closingMarkers.length;
  }
  return link.text.slice(0, link.text.length - trim);
}

function parseInline(source: Source, start: number, end: number): MarkdownInline[] {
  const { text, atoms } = source;
  const root: MarkdownInline[] = [];
  const stack: Array<{ marker: string; nodes: MarkdownInline[] }> = [];
  const current = () => stack.at(-1)?.nodes ?? root;

  let cursor = start;
  while (cursor < end) {
    const atom = atoms.get(cursor);
    if (atom?.type === 'mention') {
      current().push({ kind: 'mention', userId: atom.userId, label: atom.label });
    } else if (atom?.type === 'link') {
      const href = httpLink(atom.href);
      if (href) current().push({ kind: 'link', href, label: atom.label });
      else appendText(current(), atom.label);
    } else {
      const char = text.charAt(cursor);
      const next = text.charAt(cursor + 1);
      const previous = text.charAt(cursor - 1);
      if (char === '\\' && cursor + 1 < end && '\\[]()*_`~>#.+!-'.includes(next)) {
        appendText(current(), next);
        cursor += 2;
        continue;
      }

      if (char === '`') {
        const marker = /^`+/.exec(text.slice(cursor, end))?.[0] ?? '`';
        const body = cursor + marker.length;
        const close = inlineCodeEnd(text, marker, body, end);
        if (close >= 0) {
          const code = literalText(source, body, close).replaceAll('\n', ' ');
          const padded = code.startsWith(' ') && code.endsWith(' ') && code.trim();
          current().push({ kind: 'code', text: padded ? code.slice(1, -1) : code });
          cursor = close + marker.length;
        } else {
          appendText(current(), marker);
          cursor = body;
        }
        continue;
      }

      if (char === '[' && text[cursor - 1] !== '!') {
        const link = /^\[([^\]\n]+)\]\(([^\s()]+(?:\([^\s()]*\)[^\s()]*)*)\)/.exec(text.slice(cursor, end));
        const href = link?.[2] && httpLink(link[2]);
        if (link && href && link[1] !== undefined) {
          const label = literalText(source, cursor + 1, cursor + 1 + link[1].length);
          current().push({ kind: 'link', href, label });
          cursor += link[0].length;
          continue;
        }
      }

      if (
        /[hw]/i.test(char) &&
        !/\w/.test(previous) &&
        /^(?:https?:\/\/|www\.)/i.test(text.slice(cursor, cursor + 8))
      ) {
        const label = bareLinkText(text, cursor, end, stack);
        if (label) {
          appendText(current(), label);
          cursor += label.length;
          continue;
        }
      }

      const frame = stack.at(-1);
      if (
        frame &&
        /\S/.test(previous) &&
        cursor + frame.marker.length <= end &&
        text.startsWith(frame.marker, cursor) &&
        !(char === '_' && /[\p{L}\p{N}]/u.test(text.charAt(cursor + frame.marker.length)))
      ) {
        stack.pop();
        current().push({ kind: emphasisOf(frame.marker), children: frame.nodes });
        cursor += frame.marker.length;
        continue;
      }

      const paired = cursor + 1 < end && char === next;
      const marker = char === '*' || char === '_' || (char === '~' && paired) ? (paired ? char + char : char) : '';
      if (
        marker &&
        cursor + marker.length < end &&
        /\S/.test(text.charAt(cursor + marker.length)) &&
        !(char === '_' && /[\p{L}\p{N}]/u.test(previous))
      ) {
        stack.push({ marker, nodes: [] });
        cursor += marker.length;
        continue;
      }
      appendText(current(), char);
    }
    cursor += 1;
  }

  while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame) break;
    const parent = current();
    appendText(parent, frame.marker);
    for (const node of frame.nodes) {
      if (node.kind === 'text') appendText(parent, node.text);
      else parent.push(node);
    }
  }
  return root;
}

interface Line {
  text: string;
  start: number;
  end: number;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})[^`~]*$/;
const QUOTE = /^ {0,3}> ?/;
const LIST_ITEM = /^ {0,3}(?:[-+*]|(\d{1,9})[.)])[ \t]+/;

function fenceEnd(lines: Line[], start: number, marker: string): number {
  return lines.findIndex(
    ({ text }, index) => index > start && text.trim().startsWith(marker) && /^(`+|~+)$/.test(text.trim())
  );
}

export function parseChatMarkdown(fallback: string, content?: RoomMessageContentV1 | null): MarkdownBlock[] {
  const source = sourceOf(fallback, content);
  let offset = 0;
  const lines = source.text.split('\n').map((text) => {
    const line = { text, start: offset, end: offset + text.length };
    offset = line.end + 1;
    return line;
  });
  const blocks: MarkdownBlock[] = [];
  let paragraphStart = -1;
  let paragraphEnd = -1;

  const flushParagraph = () => {
    if (paragraphStart >= 0) {
      blocks.push({ kind: 'paragraph', children: parseInline(source, paragraphStart, paragraphEnd) });
      paragraphStart = -1;
    }
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) break;
    const fence = FENCE.exec(line.text)?.[1];
    const close = fence ? fenceEnd(lines, index, fence) : -1;
    const closingLine = lines[close];
    if (closingLine) {
      flushParagraph();
      blocks.push({ kind: 'code', text: literalText(source, line.end + 1, closingLine.start - 1) });
      index = close;
      continue;
    }
    const quote = QUOTE.exec(line.text);
    if (quote) {
      flushParagraph();
      const last = blocks.at(-1);
      const children = parseInline(source, line.start + quote[0].length, line.end);
      if (last?.kind === 'quote') last.children.push({ kind: 'text', text: '\n' }, ...children);
      else blocks.push({ kind: 'quote', children });
      continue;
    }
    const item = LIST_ITEM.exec(line.text);
    if (item) {
      flushParagraph();
      const last = blocks.at(-1);
      const firstNumber = item[1] === undefined ? null : Number(item[1]);
      const children = parseInline(source, line.start + item[0].length, line.end);
      if (last?.kind === 'list' && (last.firstNumber === null) === (firstNumber === null)) last.items.push(children);
      else blocks.push({ kind: 'list', firstNumber, items: [children] });
      continue;
    }
    if (paragraphStart < 0) paragraphStart = line.start;
    paragraphEnd = line.end;
  }
  flushParagraph();
  return blocks;
}
