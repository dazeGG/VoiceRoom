// The checks `astro build` runs on every page it writes (src/build-contract.ts).

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { buildProblems, pageProblems } from '../src/build-contract.ts';

const HEAD =
  '<title>Page</title><meta name="description" content="About the page"><link rel="canonical" href="https://voiceroom.ru/page">';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  'base64'
);

function promoBuild(t: TestContext, image: string, png?: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), 'site-promo-build-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'promo'));
  mkdirSync(join(dir, 'nested'));
  writeFileSync(join(dir, 'nested', 'page.html'), `<html><head>${HEAD}</head><body>${image}</body></html>`);
  if (png) writeFileSync(join(dir, 'promo', 'room.png'), png);
  return dir;
}

test('built promo images resolve from the output root and match PNG dimensions', (t) => {
  const dir = promoBuild(t, '<img src="/promo/room.png" alt="Room" width="1" height="1">', ONE_PIXEL_PNG);
  assert.deepEqual(buildProblems(dir), []);
});

test('a missing built promo image fails the contract', (t) => {
  const dir = promoBuild(t, '<img src="/promo/room.png" alt="Room" width="1" height="1">');
  assert.deepEqual(buildProblems(dir), ['nested/page.html: cannot read promo PNG /promo/room.png']);
});

test('empty alt and incorrect or missing image dimensions fail the contract', (t) => {
  const dir = promoBuild(t, '<img src="/promo/room.png" alt="  " width="2">', ONE_PIXEL_PNG);
  assert.deepEqual(buildProblems(dir), [
    'nested/page.html: /promo/room.png needs nonempty alt text',
    'nested/page.html: /promo/room.png width/height must match PNG dimensions 1x1'
  ]);
});

test('truncated and non-PNG promo files fail without crashing the build check', (t) => {
  for (const png of [ONE_PIXEL_PNG.subarray(0, 20), Buffer.alloc(50)]) {
    const dir = promoBuild(t, '<img src="/promo/room.png" alt="Room" width="1" height="1">', png);
    assert.deepEqual(buildProblems(dir), ['nested/page.html: invalid PNG header for /promo/room.png']);
  }
});

test('promo paths cannot escape their asset directory', (t) => {
  const dir = promoBuild(t, '<img src="/promo/../room.png" alt="Room" width="1" height="1">');
  assert.deepEqual(buildProblems(dir), ['nested/page.html: invalid promo PNG path /promo/../room.png']);
});

test('unrelated images stay outside the promo-specific contract', (t) => {
  const dir = promoBuild(t, '<img src="/logo.svg" alt="">');
  assert.deepEqual(buildProblems(dir), []);
});

test('a page with a title, a description, a canonical link and only external scripts passes', () => {
  const html = `<html><head>${HEAD}<script src="/desktop-redirect.js"></script><script type="module" src="/_astro/a.js"></script></head></html>`;
  assert.deepEqual(pageProblems('page.html', html), []);
});

test('structured data is allowed inline; a script that runs is not', () => {
  const data = `<html><head>${HEAD}<script type="application/ld+json">{"@type":"FAQPage"}</script></head></html>`;
  assert.deepEqual(pageProblems('page.html', data), []);

  const inline = `<html><head>${HEAD}<script type="module">location.replace('/app')</script></head></html>`;
  assert.match(pageProblems('page.html', inline).join('\n'), /page\.html: inline <script/);

  const plain = `<html><head>${HEAD}<script>alert(1)</script></head></html>`;
  assert.equal(pageProblems('page.html', plain).length, 1);
});

test('an inline event handler is reported', () => {
  const html = `<html><head>${HEAD}</head><body><button onclick="go()">Go</button></body></html>`;
  assert.match(pageProblems('page.html', html).join('\n'), /inline event handler/);
});

test('a missing title, description or canonical link is reported', () => {
  const problems = pageProblems('bare.html', '<html><head><title> </title></head></html>');
  assert.deepEqual(problems, [
    'bare.html: no <title>',
    'bare.html: no meta description',
    'bare.html: no absolute canonical link'
  ]);
});

test('a noindex page needs no canonical link', () => {
  const html =
    '<html><head><title>Not found</title><meta name="description" content="No such page"><meta name="robots" content="noindex"></head></html>';
  assert.deepEqual(pageProblems('404.html', html), []);
});

test('every page of a build is checked, in nested folders too', () => {
  const dir = mkdtempSync(join(tmpdir(), 'site-build-'));
  writeFileSync(join(dir, 'index.html'), `<html><head>${HEAD}</head></html>`);
  mkdirSync(join(dir, 'nested'));
  writeFileSync(join(dir, 'nested', 'page.html'), '<html><head><title>Nested</title></head></html>');
  writeFileSync(join(dir, 'robots.txt'), 'User-agent: *');
  assert.deepEqual(buildProblems(dir), [
    'nested/page.html: no meta description',
    'nested/page.html: no absolute canonical link'
  ]);
});

test('a handler after a quoted `>` and a javascript: link are reported too', () => {
  const handler = `<html><head>${HEAD}</head><body><a title="a > b" onclick="go()">Go</a></body></html>`;
  assert.match(pageProblems('page.html', handler).join('\n'), /inline event handler onclick on <a>/);

  const link = `<html><head>${HEAD}</head><body><a href=" JavaScript:go()">Go</a></body></html>`;
  assert.match(pageProblems('page.html', link).join('\n'), /a javascript: URL in <a href>/);

  const text = `<html><head>${HEAD}</head><body><p>onclick="x" and javascript: in text</p></body></html>`;
  assert.deepEqual(pageProblems('page.html', text), []);
});
