// What the site tells search engines: the pages in the sitemap, robots.txt and
// the structured data.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { desktopRedirectScript, faqJsonLd, jsonLdScript, robotsTxt, sitemapXml } from '../src/seo.ts';
import { NAV_PAGES, PAGES, SITEMAP_PAGES, SITE_ORIGIN, canonicalUrl } from '../src/site.ts';

test('robots.txt lets every crawler in, keeps it out of the API and names the sitemap', () => {
  assert.equal(
    robotsTxt('https://voiceroom.ru'),
    'User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: https://voiceroom.ru/sitemap.xml\n'
  );
});

test('the sitemap lists every page at its canonical address', () => {
  const xml = sitemapXml(SITEMAP_PAGES);
  const locations = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  assert.deepEqual(locations, [
    'https://voiceroom.ru/',
    'https://voiceroom.ru/discord-alternative',
    'https://voiceroom.ru/screen-sharing',
    'https://voiceroom.ru/voice-chat-for-games',
    'https://voiceroom.ru/download'
  ]);
  assert.match(
    sitemapXml([{ path: '/a&b', title: 't', description: 'd', nav: 'n' }]),
    /<loc>https:\/\/voiceroom\.ru\/a&#38;b<\/loc>/
  );
});

test('each page has its own title and a description that fits a search snippet', () => {
  const titles = new Set(SITEMAP_PAGES.map((page) => page.title));
  const descriptions = new Set(SITEMAP_PAGES.map((page) => page.description));
  assert.equal(titles.size, SITEMAP_PAGES.length);
  assert.equal(descriptions.size, SITEMAP_PAGES.length);
  for (const page of SITEMAP_PAGES) {
    assert.ok(page.title.length <= 70, `${page.path}: title of ${page.title.length} characters`);
    assert.ok(
      page.description.length >= 70 && page.description.length <= 160,
      `${page.path}: description of ${page.description.length} characters`
    );
  }
});

test('the menu holds every page but the home page', () => {
  assert.deepEqual(
    NAV_PAGES.map((page) => page.path),
    SITEMAP_PAGES.filter((page) => page !== PAGES.home).map((page) => page.path)
  );
  assert.equal(canonicalUrl(PAGES.home.path), `${SITE_ORIGIN}/`);
});

test('structured data is one schema.org document that cannot close its script tag', () => {
  const faq = faqJsonLd([{ question: 'Что это?', answer: 'Ответ </script><script>alert(1)</script>' }]);
  const json = jsonLdScript({ '@type': 'WebApplication', name: 'VoiceRoom' }, faq);
  assert.doesNotMatch(json, /<\/script/i);
  assert.deepEqual(JSON.parse(json), {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebApplication', name: 'VoiceRoom' },
      {
        '@type': 'FAQPage',
        mainEntity: [
          {
            '@type': 'Question',
            name: 'Что это?',
            acceptedAnswer: { '@type': 'Answer', text: 'Ответ </script><script>alert(1)</script>' }
          }
        ]
      }
    ]
  });
  assert.deepEqual(JSON.parse(jsonLdScript(faq)), { '@context': 'https://schema.org', ...faq });
});

test('the desktop app goes on to the app; a browser stays on the site', () => {
  const run = (window: object) => {
    runInNewContext(desktopRedirectScript(), { window });
  };
  const replaced: string[] = [];
  const location = { replace: (href: string) => replaced.push(href) };
  run({ location });
  assert.deepEqual(replaced, []);
  run({ location, voiceRoomRuntime: { isDesktop: true } });
  assert.deepEqual(replaced, ['/app']);
});
