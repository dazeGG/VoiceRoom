import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8');

test('room and preview participant tiles use the persisted avatar accent as their surface', () => {
  const css = read('src/lib/features/room/styles/participants.css');
  const roomTile = read('src/lib/features/room/components/ParticipantTile.svelte');
  const preview = read('src/lib/features/home/components/lobby/RoomPreviewView.svelte');
  const browse = read('src/lib/features/home/components/lobby/RoomBrowseView.svelte');

  assert.match(roomTile, /style:--participant-pastel=\{avatar\.background\}/);
  assert.match(preview, /style:--participant-pastel=\{avatar\.background\}/);
  assert.match(browse, /style:--participant-pastel=\{avatar\.background\}/);
  assert.match(css, /background: color-mix\(in oklch, var\(--participant-pastel\)/);
  assert.match(css, /\.avatar\s*\{[\s\S]*box-shadow: none/);
  assert.doesNotMatch(css, /linear-gradient\(160deg, oklch\(12%/);
});

test('avatar presentation uses server-provided colors without client-side identity mixing', () => {
  const presentation = read('src/lib/features/room/client/ui/avatar-presentation.ts');

  assert.match(presentation, /background = accent/);
  assert.match(presentation, /background = palette\.background/);
  assert.doesNotMatch(presentation, /Math\.imul|uniqueAccent|color-mix/);
});

test('preview avatar images cover the initials without displacing them from the avatar grid', () => {
  const css = read('src/lib/features/room/styles/participants.css');
  const preview = read('src/lib/features/home/components/lobby/RoomPreviewView.svelte');

  assert.match(preview, /\{avatar\.initials\}\{#if avatar\.src\}<img/);
  assert.match(css, /\.avatar\s*\{[\s\S]*position: relative/);
  assert.match(css, /\.avatar > img\s*\{[\s\S]*position: absolute;[\s\S]*inset: 0/);
});
