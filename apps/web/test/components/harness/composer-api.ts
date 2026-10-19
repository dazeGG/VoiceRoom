// What ComposerHarness hands its test: typed here, since a test reads
// component exports from a .svelte file as untyped.
export type ComposerApi = {
  insert(text: string, caret?: number): boolean;
  setValue(next: string): void;
};
