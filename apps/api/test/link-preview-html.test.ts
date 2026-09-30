import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeHtmlBody, extractLinkPreviewMetadata } from '../src/lib/link-preview-html.ts';

test('Open Graph tags win, in any attribute order and quoting, with entities decoded', () => {
  const html = `<!doctype html><html><head>
    <title>Запасной заголовок</title>
    <meta content="Статья &laquo;про&raquo; котов &amp; собак" property="og:title">
    <meta property='og:description' content='Коротко &#8212; и&#x20;ясно'>
    <meta name="description" content="не это">
    <meta property="og:site_name" content="Журнал">
    <meta property="og:image" content="/images/cover.jpg">
    <meta property="og:image" content="/images/second.jpg">
  </head><body><meta property="og:title" content="из body"></body></html>`;
  assert.deepEqual(extractLinkPreviewMetadata(html, 'https://example.com/posts/1'), {
    title: 'Статья «про» котов & собак',
    description: 'Коротко — и ясно',
    siteName: 'Журнал',
    imageUrl: 'https://example.com/images/cover.jpg'
  });
});

test('title, twitter and description tags fill in, and unsafe image links are ignored', () => {
  const html = `<head><title>
      Просто   страница
    </title>
    <meta name="twitter:description" content="Описание из twitter">
    <meta name="twitter:image" content="javascript:alert(1)">
  </head>`;
  assert.deepEqual(extractLinkPreviewMetadata(html, 'https://example.com/'), {
    title: 'Просто страница',
    description: 'Описание из twitter',
    siteName: '',
    imageUrl: null
  });
  assert.deepEqual(extractLinkPreviewMetadata('', 'https://example.com/'), {
    title: '',
    description: '',
    siteName: '',
    imageUrl: null
  });
});

test('pages in windows-1251 are decoded from the header or the meta tag', () => {
  const privet = Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]);
  const titled = (prefix: string) =>
    Buffer.concat([
      Buffer.from(prefix, 'latin1'),
      Buffer.from('<title>', 'latin1'),
      privet,
      Buffer.from('</title>', 'latin1')
    ]);

  assert.match(decodeHtmlBody(titled(''), 'text/html; charset=windows-1251'), /<title>Привет<\/title>/);
  assert.match(
    decodeHtmlBody(titled('<meta http-equiv="Content-Type" content="text/html; charset=windows-1251">'), 'text/html'),
    /Привет/
  );
  assert.match(decodeHtmlBody(titled('<meta charset="cp1251">'), 'text/html'), /Привет/);
  assert.equal(decodeHtmlBody(Buffer.from('<title>Привет</title>'), 'text/html'), '<title>Привет</title>');
  assert.equal(
    decodeHtmlBody(Buffer.from('<title>ok</title>'), 'text/html; charset=no-such-charset'),
    '<title>ok</title>'
  );
});
