import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(join(webRoot, relative), 'utf8');

test('a DM thread is only shown once its artwork has settled at the newest message', () => {
  const view = read('src/lib/features/home/components/lobby/DmView.svelte');
  const css = read('src/lib/features/home/styles/friends.css');

  // Messages arriving is not the thread being ready: every image that resolves
  // afterwards changes the height, so a scroll taken at that moment stops short.
  assert.match(view, /let threadSettling = \$state\(false\)/);
  assert.match(view, /function pendingArtwork\(root: HTMLElement\)/);
  assert.match(view, /async function settleThread\(token: number\)/);
  assert.match(view, /scrollEl\.scrollTop = scrollEl\.scrollHeight/);
  // A dead image must not hold the thread hostage.
  assert.match(view, /SETTLE_TIMEOUT_MS = \d+/);
  assert.match(view, /Promise\.race\(\[/);
  // Stale settles from a thread the reader has left are dropped.
  assert.match(view, /if \(token !== settleToken\) return;/);

  // It renders behind the placeholder rather than after it, so the images it
  // is waiting for are actually loading.
  assert.match(view, /class:is-settling=\{threadSettling\}/);
  assert.match(view, /\{#if friendsState\.threadLoading \|\| threadSettling\}/);
  assert.match(css, /\.lobby-dm-thread\.is-settling \{ visibility: hidden; \}/);
  assert.match(css, /\.lobby-dm-loading \{/);
});
