// Reads what a link preview needs from the <head> of a page: Open Graph and
// Twitter card tags, the description meta tag and <title>. Only the head is
// scanned, and nothing from the page is ever rendered as HTML.

const HEAD_SCAN_LIMIT = 256 * 1024;
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  laquo: '«',
  raquo: '»',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  copy: '©',
  reg: '®',
  trade: '™'
};

export type LinkPreviewMetadata = {
  title: string;
  description: string;
  siteName: string;
  imageUrl: string | null;
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      const valid = Number.isInteger(code) && code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff);
      return valid ? String.fromCodePoint(code) : '';
    }
    return Object.hasOwn(NAMED_ENTITIES, body.toLowerCase()) ? (NAMED_ENTITIES[body.toLowerCase()] as string) : entity;
  });
}

function clean(value: unknown): string {
  return decodeEntities(String(value)).replace(/\s+/g, ' ').trim();
}

function parseAttributes(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  const inner = tag.replace(/^<\s*[a-z]+/i, '').replace(/\/?\s*>$/, '');
  for (const match of inner.matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    const name = (match[1] as string).toLowerCase();
    if (!attributes.has(name)) attributes.set(name, match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attributes;
}

function resolveHttpUrl(value: string, base: string | URL | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function extractLinkPreviewMetadata(html: unknown, pageUrl?: string | URL): LinkPreviewMetadata {
  const source = String(html || '');
  const headEnd = source.search(/<\/head\s*>/i);
  const head = source.slice(0, headEnd >= 0 ? headEnd : HEAD_SCAN_LIMIT).slice(0, HEAD_SCAN_LIMIT);
  const meta = new Map<string, string>();
  for (const [tag] of head.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = parseAttributes(tag);
    const key = (attributes.get('property') || attributes.get('name') || '').toLowerCase();
    const content = attributes.get('content');
    if (!key || content === undefined || meta.has(key)) continue;
    meta.set(key, clean(content));
  }
  const pick = (...keys: string[]): string => keys.map((key) => meta.get(key)).find(Boolean) || '';
  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(head);
  return {
    title: pick('og:title', 'twitter:title') || (titleTag ? clean(titleTag[1]) : ''),
    description: pick('og:description', 'twitter:description', 'description'),
    siteName: pick('og:site_name', 'application-name'),
    imageUrl: resolveHttpUrl(
      pick('og:image:secure_url', 'og:image:url', 'og:image', 'twitter:image', 'twitter:image:src'),
      pageUrl
    )
  };
}

// Many Russian sites still serve windows-1251, declared either in the
// Content-Type header or in a <meta> tag near the top of the page.
function decodeHtmlBody(buffer: Buffer, contentType: unknown): string {
  const declared = /charset\s*=\s*"?([\w.:-]+)"?/i.exec(String(contentType || ''));
  let charset = declared ? (declared[1] as string) : '';
  if (!charset) {
    const meta = /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(buffer.subarray(0, 4096).toString('latin1'));
    charset = meta ? (meta[1] as string) : 'utf-8';
  }
  try {
    return new TextDecoder(charset.toLowerCase()).decode(buffer);
  } catch {
    return new TextDecoder('utf-8').decode(buffer);
  }
}

export { decodeHtmlBody, extractLinkPreviewMetadata };
