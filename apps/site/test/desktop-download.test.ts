// The download page's picker (src/desktop-download.ts): which build suits the
// visitor, and the direct links an /api/desktop/latest answer gives.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DESKTOP_BUILDS, guessBuild, releaseLinks, staticMeta } from '../src/desktop-download.ts';
import { RELEASES_URL } from '../src/site.ts';

const WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Safari/537.36';
const MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const LINUX = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Safari/537.36';

test('Windows gets the Windows build for sure', () => {
  assert.deepEqual(guessBuild(WINDOWS), { id: 'win-x64', sure: true });
});

test('a Mac gets its processor’s build when the browser tells it, else Apple Silicon as a guess', () => {
  assert.deepEqual(guessBuild(MAC, 'arm'), { id: 'mac-arm64', sure: true });
  assert.deepEqual(guessBuild(MAC, 'x86'), { id: 'mac-x64', sure: true });
  assert.deepEqual(guessBuild(MAC), { id: 'mac-arm64', sure: false });
});

test('a phone or Linux gets no build', () => {
  assert.equal(guessBuild(IPHONE), null);
  assert.equal(guessBuild(LINUX), null);
});

test('a release answer gives each build its file, size and version', () => {
  const links = releaseLinks({
    ok: true,
    version: '3.1.0',
    htmlUrl: RELEASES_URL,
    assets: {
      'win-x64': { url: 'https://github.com/x/VoiceRoom-3.1.0-win-x64-setup.exe', size: 98 * 1024 * 1024 },
      'mac-arm64': { url: 'https://github.com/x/VoiceRoom-3.1.0-mac-arm64.dmg', size: 120.4 * 1024 * 1024 },
      'mac-x64': null
    }
  });
  assert.deepEqual(links, {
    'win-x64': { href: 'https://github.com/x/VoiceRoom-3.1.0-win-x64-setup.exe', meta: '.exe · ~98 МБ · v3.1.0' },
    'mac-arm64': { href: 'https://github.com/x/VoiceRoom-3.1.0-mac-arm64.dmg', meta: '.dmg · ~120 МБ · v3.1.0' },
    'mac-x64': { href: RELEASES_URL, meta: '.dmg · Mac на Intel · v3.1.0' }
  });
});

test('an answer of another shape, or a link that is not https, leaves the page as built', () => {
  const assets = { 'win-x64': null, 'mac-arm64': null, 'mac-x64': null };
  assert.equal(releaseLinks(null), null);
  assert.equal(releaseLinks({ ok: false, error: 'x' }), null);
  assert.equal(releaseLinks({ ok: true, version: '3.1.0' }), null);
  assert.equal(
    releaseLinks({
      ok: true,
      version: '3.1.0',
      assets: { ...assets, 'win-x64': { url: 'javascript:alert(1)', size: 1 } }
    }),
    null
  );
  assert.equal(releaseLinks({ ok: true, version: '3.1.0', assets: { 'win-x64': null } }), null);
});

test('before the release is known each build says its file type and what it needs', () => {
  assert.deepEqual(DESKTOP_BUILDS.map(staticMeta), [
    '.exe · Windows 10 и 11',
    '.dmg · Mac на M-процессорах',
    '.dmg · Mac на Intel'
  ]);
});
