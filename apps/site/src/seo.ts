// robots.txt, sitemap.xml and the structured data of the pages. Plain functions,
// so the endpoints in src/pages only serve what these return.

import { APP_HREF, SITE_ORIGIN, canonicalUrl, type SitePage } from './site.ts';

/**
 * Every crawler may read the site, the search and answer bots of AI services
 * included. The app's own pages (/app, /r/*) stay crawlable on purpose: they
 * answer with X-Robots-Tag noindex (Caddyfile), which a crawler has to fetch to see.
 */
export function robotsTxt(origin: string = SITE_ORIGIN): string {
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    '',
    `Sitemap: ${new URL('/sitemap.xml', origin).href}`,
    ''
  ].join('\n');
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (char) => `&#${String(char.codePointAt(0))};`);
}

export function sitemapXml(pages: readonly SitePage[]): string {
  const urls = pages.map((page) => `  <url><loc>${escapeXml(canonicalUrl(page.path))}</loc></url>`);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    ''
  ].join('\n');
}

export interface FaqItem {
  question: string;
  answer: string;
}

/** FAQPage data for the questions a page shows; the text must be the visible text. */
export function faqJsonLd(items: readonly FaqItem[]) {
  return {
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer }
    }))
  };
}

/**
 * The JSON of a <script type="application/ld+json">. `<` is escaped, so text
 * holding "</script>" cannot close the tag; JSON reads < as the same character.
 */
export function jsonLdScript(...nodes: readonly object[]): string {
  const data =
    nodes.length === 1
      ? { '@context': 'https://schema.org', ...nodes[0] }
      : { '@context': 'https://schema.org', '@graph': nodes };
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

/** The script that sends the desktop app's window from the site on to the app (APP_HREF). */
export function desktopRedirectScript(appHref: string = APP_HREF): string {
  return `if (window.voiceRoomRuntime && window.voiceRoomRuntime.isDesktop) window.location.replace(${JSON.stringify(appHref)});\n`;
}
