// Comment handling shared by the style checks.

export const blank = (text: string) => text.replace(/[^\n]/g, ' ');

/**
 * Replaces `//` and block comments with spaces (line breaks kept), so offsets
 * and line numbers stay valid. String literals are skipped, so a `//` inside
 * a quoted URL is not a comment.
 */
export function blankComments(source: string): string {
  let out = '';
  let index = 0;
  while (index < source.length) {
    const char = source.charAt(index);
    const next = source.charAt(index + 1);
    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += blank(source.slice(index, stop));
      index = stop;
    } else if (char === '/' && next === '/') {
      const end = source.indexOf('\n', index);
      const stop = end === -1 ? source.length : end;
      out += blank(source.slice(index, stop));
      index = stop;
    } else if (char === '"' || char === "'" || char === '`') {
      let stop = index + 1;
      while (stop < source.length && source.charAt(stop) !== char && source.charAt(stop) !== '\n') {
        stop += source.charAt(stop) === '\\' ? 2 : 1;
      }
      out += source.slice(index, stop + 1);
      index = stop + 1;
    } else {
      out += char;
      index += 1;
    }
  }
  return out;
}
