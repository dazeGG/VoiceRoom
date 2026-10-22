// Escape LIKE wildcards in user-supplied search terms (we use ESCAPE '\').
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}
