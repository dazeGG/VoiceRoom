import type { TextSelection } from './composer-handle';

const emphasisMarkers = { bold: '**', italic: '*', strike: '~~' };
export type MarkdownFormat = keyof typeof emphasisMarkers | 'code';

export interface ComposerEdit {
  text: string;
  selection: TextSelection;
}

function codeMarkers(before: string, selected: string, after: string) {
  const run = Math.max(0, ...Array.from(selected.matchAll(/`+/g), ([match]) => match.length));
  if (selected.includes('\n')) {
    const fence = '`'.repeat(Math.max(3, run + 1));
    const start = before.length && !before.endsWith('\n') ? '\n' : '';
    const end = after.length && !after.startsWith('\n') ? '\n' : '';
    return { open: `${start}${fence}\n`, close: `\n${fence}${end}` };
  }
  const fence = '`'.repeat(run + 1);
  const pad = selected.startsWith('`') || selected.endsWith('`') || /^ .* $/.test(selected) ? ' ' : '';
  return { open: fence + pad, close: pad + fence };
}

function surroundingCode(before: string, after: string) {
  const block = before.match(/(?:^|\n)(`{3,})\n$/)?.[1];
  if (block && after.startsWith(`\n${block}`) && /^(?:\n|$)/.test(after.slice(block.length + 1))) {
    return { open: `${block}\n`, close: `\n${block}` };
  }
  const open = before.match(/`+ ?$/)?.[0];
  const close = after.match(/^ ?`+/)?.[0];
  return open && close && open.trimEnd() === close.trimStart() && open.endsWith(' ') === close.startsWith(' ')
    ? { open, close }
    : undefined;
}

export function formattingAt({ text, selection }: ComposerEdit, format: MarkdownFormat) {
  const selected = text.slice(selection.start, selection.end);
  if (!selected.trim()) return null;
  const start = format === 'code' ? selection.start : selection.start + selected.length - selected.trimStart().length;
  const end = format === 'code' ? selection.end : start + selected.trim().length;
  const before = text.slice(0, start);
  const content = text.slice(start, end);
  const after = text.slice(end);
  const marker = format === 'code' ? null : emphasisMarkers[format];
  const surrounding = marker
    ? before.endsWith(marker) &&
      after.startsWith(marker) &&
      (format !== 'italic' || (!/(?:^|[^*])\*\*$/.test(before) && !/^\*\*(?:[^*]|$)/.test(after)))
    : surroundingCode(before, after);
  const bounds = marker ? { open: marker, close: marker } : codeMarkers(before, content, after);
  const wrapped = typeof surrounding === 'object' ? surrounding : bounds;
  const left = surrounding ? before.slice(0, -wrapped.open.length) : before + wrapped.open;
  const right = surrounding ? after.slice(wrapped.close.length) : wrapped.close + after;
  return {
    active: Boolean(surrounding),
    edit: { text: left + content + right, selection: { start: left.length, end: left.length + content.length } }
  };
}
