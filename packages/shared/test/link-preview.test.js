'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const preview = require('../src/link-preview.mts');

const KEY = `lp_${'a1'.repeat(16)}.webp`;

test('the first http(s) link without credentials is the one previewed', () => {
  assert.equal(preview.firstPreviewableUrl('смотри https://example.com/a?b=1#part.'), 'https://example.com/a?b=1');
  assert.match(preview.firstPreviewableUrl('это www.Example.com/путь!'), /^https:\/\/www\.example\.com\//);
  assert.equal(
    preview.firstPreviewableUrl('ftp://files.example javascript:alert(1) https://user:pw@example.com http://ok.example'),
    'http://ok.example/'
  );
  assert.equal(preview.firstPreviewableUrl('без ссылок'), null);
  assert.equal(preview.firstPreviewableUrl(null), null);
  assert.equal(preview.firstPreviewableUrl(`https://example.com/${'x'.repeat(2100)}`), null);
});

test('a stored preview keeps only clean, bounded fields', () => {
  const normalized = preview.normalizeLinkPreview({
    url: 'https://www.example.com/post#top',
    title: '  Заголовок\u202e  статьи  ',
    description: 'д'.repeat(400),
    siteName: '',
    image: { key: KEY, width: 640, height: 360 },
    extra: 'dropped'
  });
  assert.deepEqual(Object.keys(normalized), ['url', 'title', 'description', 'siteName', 'image']);
  assert.equal(normalized.url, 'https://www.example.com/post');
  assert.equal(normalized.title, 'Заголовок статьи');
  assert.equal(Array.from(normalized.description).length, preview.MAX_LINK_PREVIEW_DESCRIPTION);
  assert.ok(normalized.description.endsWith('…'));
  assert.equal(normalized.siteName, 'example.com');
  assert.deepEqual(normalized.image, { key: KEY, width: 640, height: 360 });
  assert.equal(preview.linkPreviewImageUrl(KEY), `/api/link-previews/${KEY}`);
});

test('previews without text, with a foreign scheme or with a forged image key are dropped', () => {
  assert.equal(preview.normalizeLinkPreview({ url: 'https://example.com', title: ' ', description: '' }), null);
  assert.equal(preview.normalizeLinkPreview({ url: 'javascript:alert(1)', title: 'x' }), null);
  assert.equal(preview.normalizeLinkPreview({ url: 'https://a:b@example.com', title: 'x' }), null);
  assert.equal(preview.normalizeLinkPreview(['https://example.com']), null);
  for (const image of [{ key: '../etc/passwd', width: 1, height: 1 }, { key: KEY, width: 0, height: 10 }, { key: KEY, width: 5000, height: 10 }, { key: KEY, width: 1.5, height: 10 }]) {
    assert.equal(preview.normalizeLinkPreview({ url: 'https://example.com', title: 'x', image }).image, null);
  }
  assert.equal(preview.linkPreviewImageUrl('lp_../../x.webp'), null);
});

test('the browser module behaves exactly like the server module', async () => {
  const esm = await import(pathToFileURL(path.join(__dirname, '../src/link-preview.mts')).href);
  const texts = ['https://example.com/a#b', 'www.example.com', 'нет', 'ftp://x https://y.example/z.'];
  for (const text of texts) assert.equal(esm.firstPreviewableUrl(text), preview.firstPreviewableUrl(text));
  const input = { url: 'https://example.com', title: 't\u200f', description: 'd', siteName: 's', image: { key: KEY, width: 2, height: 3 } };
  assert.deepEqual(esm.normalizeLinkPreview(input), preview.normalizeLinkPreview(input));
  assert.equal(esm.MAX_LINK_PREVIEW_TITLE, preview.MAX_LINK_PREVIEW_TITLE);
});
