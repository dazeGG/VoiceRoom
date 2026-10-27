export interface ComposerSelection {
  start: number | null | undefined;
  end: number | null | undefined;
}

/**
 * Puts text where the caret was, replacing a selection, the way typing it
 * would. Returns null when the result would not fit the field.
 */
export function insertIntoDraft(
  draft: string,
  insert: string,
  selection: ComposerSelection,
  maxLength = Number.POSITIVE_INFINITY
): { text: string; caret: number } | null {
  const clamp = (value: number | null | undefined, fallback: number) =>
    Math.min(Math.max(Number.isInteger(value) ? Number(value) : fallback, 0), draft.length);
  const start = clamp(selection.start, draft.length);
  const end = Math.max(start, clamp(selection.end, start));
  const text = `${draft.slice(0, start)}${insert}${draft.slice(end)}`;
  if (text.length > maxLength) return null;
  return { text, caret: start + insert.length };
}
