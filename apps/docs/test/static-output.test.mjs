import { strict as assert } from 'node:assert';
import { existsSync, globSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const readPage = (path) => readFileSync(join(dist, path), 'utf8');

test('the home links to the published Russian installation guide', () => {
  assert.match(readPage('index.html'), /href="\/widgets\/install"/);

  const guide = readPage('widgets/install/index.html');
  assert.match(guide, /<html\b[^>]*\blang="ru"/);
  assert.match(guide, /<link\b[^>]*\brel="canonical"[^>]*\bhref="https:\/\/docs\.voiceroom\.ru\/widgets\/install"/);
  assert.match(guide, /https:\/\/voiceroom\.ru\/widget\/v1\/loader\.js/);
  assert.doesNotMatch(guide, /<script\b[^>]*\bsrc="https:\/\/voiceroom\.ru\/widget\/v1\/loader\.js"/);
});

test('internal navigation resolves to generated pages', () => {
  const pages = globSync('**/*.html', { cwd: dist });
  assert.ok(pages.length >= 2, 'The docs build must include its home and an article');

  for (const page of pages) {
    for (const [, href] of readPage(page).matchAll(/<a\b[^>]*\bhref="(\/(?!\/)[^"]*)"/g)) {
      const { pathname } = new URL(href, 'https://docs.voiceroom.ru');
      const target = pathname.slice(1);
      const candidates = target ? [`${target}.html`, `${target}/index.html`, target] : ['index.html'];
      assert.ok(
        candidates.some((path) => statSync(join(dist, path), { throwIfNoEntry: false })?.isFile()),
        `${page} links to missing page ${href}`
      );
    }
  }
});

test('Pagefind generated a local Russian search index', () => {
  const metadata = JSON.parse(readPage('pagefind/pagefind-entry.json'));
  assert.ok(metadata.languages.ru, 'The index must include Russian pages');
  assert.ok(existsSync(join(dist, 'pagefind/pagefind.js')));
});
