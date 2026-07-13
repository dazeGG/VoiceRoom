import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

test('brand assets keep platform and in-app icon roles separate', () => {
  const icon = read('static/voiceroom-icon.svg');
  const mascot = read('static/voiceroom-mascot.svg');
  const appHtml = read('src/app.html');
  const serviceWorker = read('src/service-worker.ts');
  const topbar = read('src/lib/shared/components/Topbar.svelte');
  const sidebar = read('src/lib/features/home/components/lobby/Sidebar.svelte');

  assert.match(icon, /<rect width="100" height="100" rx="26" fill="#080800">/);
  assert.match(icon, /<rect x="10" y="44" width="80" height="22" fill="#080800">/);
  assert.match(icon, /<circle cx="38" cy="55" r="6\.5" fill="#c1f100">/);
  assert.match(icon, /fill="#c1f100"/);
  assert.match(mascot, /<mask id="band">/);
  assert.match(mascot, /<rect x="10" y="44" width="80" height="22" fill="black">/);
  assert.doesNotMatch(mascot, /<rect width="100" height="100" rx=/);

  assert.match(appHtml, /href="\/voiceroom-icon\.svg"/);
  assert.match(serviceWorker, /icon:\s*'\/voiceroom-icon\.svg'/);
  assert.match(topbar, /src="\/voiceroom-mascot\.svg"/);
  assert.match(sidebar, /src="\/voiceroom-mascot\.svg"/);
});
