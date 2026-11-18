// The generated snippet contains only two HTML tags and a JSON attribute.
const syntax =
  /(?<tag><\/?(?:div|script)\b|>)|(?<attribute>\b(?:data-voiceroom-widget|data-config|type|src|defer)\b)|(?<string>"(?:[^"\\]|\\.)*"|')|(?<literal>\b(?:true|false|\d+)\b)/g;

type CodePart = { text: string; kind?: string | undefined };

export function widgetCodeParts(source: string): CodePart[] {
  const parts: CodePart[] = [];
  let start = 0;
  for (const match of source.matchAll(syntax)) {
    if (start < match.index) parts.push({ text: source.slice(start, match.index) });
    const kind = Object.entries(match.groups ?? {}).find(([, value]) => value !== undefined)?.[0];
    parts.push({ text: match[0], kind });
    start = match.index + match[0].length;
  }
  if (start < source.length) parts.push({ text: source.slice(start) });
  return parts;
}
