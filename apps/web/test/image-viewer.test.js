import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(join(webRoot, relative), 'utf8');

test('the viewer takes plain sources, so a pending image opens in it too', () => {
  const lightbox = read('src/lib/shared/chat/AttachmentLightbox.svelte');
  const mosaic = read('src/lib/shared/chat/AttachmentMosaic.svelte');
  const composer = read('src/lib/shared/chat/AttachmentComposer.svelte');

  // Taking attachment records would have tied the viewer to messages already
  // sent; the moment you most want a closer look is before sending.
  assert.match(lightbox, /export interface LightboxItem/);
  assert.match(lightbox, /items: LightboxItem\[\]/);
  assert.doesNotMatch(lightbox, /MessageAttachment/);
  assert.match(mosaic, /<AttachmentLightbox \{items\}/);
  assert.match(composer, /<AttachmentLightbox \{items\}/);
  assert.match(composer, /class="attachment-draft-open"/);
  assert.match(composer, /draft\.previewUrl \|\| attachmentVariantUrl\(draft\.id, 'preview'\)/);
});

test('the viewer zooms and pans by transform rather than by scrolling', () => {
  const lightbox = read('src/lib/shared/chat/AttachmentLightbox.svelte');
  const css = read('src/lib/shared/chat/attachment.css');

  assert.match(lightbox, /MAX_SCALE = \d/);
  assert.match(lightbox, /function onWheel\(event: WheelEvent\)/);
  assert.match(lightbox, /function onPointerDown\(event: PointerEvent\)/);
  assert.match(lightbox, /translate\(\$\{offsetX\}px, \$\{offsetY\}px\) scale\(\$\{scale\}\)/);
  // Zooming back out recentres: at fit size there is nowhere left to pan to.
  assert.match(lightbox, /if \(!zoomed\) \{\s*\n\s*offsetX = 0;\s*\n\s*offsetY = 0;/);
  assert.match(css, /\.attachment-lightbox-stage \{[^}]*overflow: hidden/);

  // Keyboard reaches every control the mouse does.
  assert.match(lightbox, /event\.key === 'Escape'/);
  assert.match(lightbox, /event\.key === 'ArrowLeft'/);
  assert.match(lightbox, /event\.key === '\+' \|\| event\.key === '='/);
  assert.match(lightbox, /event\.key === '0'/);
});
