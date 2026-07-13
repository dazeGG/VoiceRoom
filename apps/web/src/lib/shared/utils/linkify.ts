export interface ChatSegment {
  kind: 'text' | 'link';
  text: string;
  href?: string;
}

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'`(){}[\]]+/gi;
const TRAILING_PUNCTUATION_RE = /[.,;:!?]+$/;

/**
 * Split chat text into safe text and link segments.
 * Only recognizes http(s):// and www. prefixes.
 * Never produces javascript: or other schemes.
 * Safe to render without {@html}.
 */
export function parseChatLinks(input: string): ChatSegment[] {
  const src = String(input ?? '');
  if (!src) return [{ kind: 'text', text: '' }];

  const parts: ChatSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // Reset lastIndex for global regex reuse safety in case
  URL_RE.lastIndex = 0;

  while ((match = URL_RE.exec(src)) !== null) {
    const start = match.index;
    if (start > lastIndex) {
      parts.push({ kind: 'text', text: src.slice(lastIndex, start) });
    }

    const matched = match[0];
    const trailing = matched.match(TRAILING_PUNCTUATION_RE)?.[0] ?? '';
    const raw = trailing ? matched.slice(0, -trailing.length) : matched;
    let href = raw;
    if (/^www\./i.test(raw)) {
      href = 'https://' + raw;
    }
    // Final guard: only http/https ever get link treatment
    if (/^https?:\/\//i.test(href)) {
      parts.push({ kind: 'link', text: raw, href });
    } else {
      parts.push({ kind: 'text', text: raw });
    }
    if (trailing) parts.push({ kind: 'text', text: trailing });
    lastIndex = URL_RE.lastIndex;
  }

  if (lastIndex < src.length) {
    parts.push({ kind: 'text', text: src.slice(lastIndex) });
  }

  return parts.length > 0 ? parts : [{ kind: 'text', text: src }];
}
