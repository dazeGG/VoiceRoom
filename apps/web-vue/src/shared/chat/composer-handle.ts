// What a parent may do with a mounted EmojiComposer, typed so the calls are
// checked (a bare component instance type reads as `any` to the linter).

export interface TextSelection {
  start: number;
  end: number;
}

export interface ComposerHandle {
  focus(): void;
  getSelection(): TextSelection;
  setSelection(start: number, end?: number): void;
  /** Puts text where the caret was; false when the field refused it. */
  insertText(text: string): boolean;
}
