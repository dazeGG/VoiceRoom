'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { deriveAvatarAccent, dominantAvatarColor } = require('@voice-room/shared/avatar-accent');

const HEX_COLOR = /^#[0-9a-f]{6}$/;
const BOX_SHADOW = /^0 10px 24px #[0-9a-f]{8}$/;

function assertValidPresentation(presentation) {
  assert.match(presentation.background, HEX_COLOR);
  assert.match(presentation.foreground, HEX_COLOR);
  assert.match(presentation.shadow, BOX_SHADOW);
  assert.equal(presentation.shadow, `0 10px 24px ${presentation.background}52`);
}

test('neutral black, gray, and white inputs share a stable dark accent', () => {
  const black = deriveAvatarAccent({ r: 0, g: 0, b: 0 });
  const gray = deriveAvatarAccent({ r: 127, g: 127, b: 127 });
  const white = deriveAvatarAccent({ r: 255, g: 255, b: 255 });

  assert.deepEqual(gray, black);
  assert.deepEqual(white, black);
  assert.equal(black.background, '#3d3d3d');
  assert.equal(black.foreground, '#ffffff');
  assertValidPresentation(black);
});

test('saturated colors preserve distinct hues while staying dark and readable', () => {
  const red = deriveAvatarAccent({ r: 255, g: 0, b: 0 });
  const green = deriveAvatarAccent({ r: 0, g: 255, b: 0 });
  const blue = deriveAvatarAccent({ r: 0, g: 0, b: 255 });

  assert.notEqual(red.background, green.background);
  assert.notEqual(green.background, blue.background);
  assert.notEqual(blue.background, red.background);
  for (const presentation of [red, green, blue]) {
    assert.equal(presentation.foreground, '#ffffff');
    assertValidPresentation(presentation);
  }
});

test('very dark chromatic input is lifted into the same usable accent band', () => {
  const darkBlue = deriveAvatarAccent({ r: 0, g: 0, b: 8 });
  const neutral = deriveAvatarAccent({ r: 0, g: 0, b: 0 });

  assert.notEqual(darkBlue.background, neutral.background);
  assert.equal(darkBlue.foreground, '#ffffff');
  assertValidPresentation(darkBlue);
});

test('derivation is deterministic and does not mutate its input', () => {
  const rgb = { r: 242, g: 80, b: 170 };
  const snapshot = { ...rgb };

  assert.deepEqual(deriveAvatarAccent(rgb), deriveAvatarAccent(rgb));
  assert.deepEqual(rgb, snapshot);
});

test('all sampled RGB boundaries produce valid CSS without throwing', () => {
  const channels = [0, 1, 15, 31, 63, 95, 127, 159, 191, 223, 254, 255];
  for (const r of channels) {
    for (const g of channels) {
      for (const b of channels) {
        const presentation = deriveAvatarAccent({ r, g, b });
        assertValidPresentation(presentation);
        assert.deepEqual(presentation, deriveAvatarAccent({ r, g, b }));
      }
    }
  }
});

test('out-of-range and invalid channel values are normalized safely', () => {
  assert.deepEqual(
    deriveAvatarAccent({ r: -100, g: 300, b: Number.NaN }),
    deriveAvatarAccent({ r: 0, g: 255, b: 0 })
  );
  assertValidPresentation(deriveAvatarAccent(null));
});

function makeBitmap(size, paint) {
  const pixels = new Uint8ClampedArray(size * size * 4);
  const center = size / 2;
  const radiusSquared = center ** 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const insideCircle = (x + 0.5 - center) ** 2 + (y + 0.5 - center) ** 2 <= radiusSquared;
      const [r, g, b, a] = paint(insideCircle);
      const index = (y * size + x) * 4;
      pixels[index] = r;
      pixels[index + 1] = g;
      pixels[index + 2] = b;
      pixels[index + 3] = a;
    }
  }
  return pixels;
}

test('dominantAvatarColor samples only the inscribed circle, ignoring masked corners', () => {
  // Corners share the same 8×8×8 bucket as the interior (both blue >> 5 === 7):
  // if corner pixels leaked into the average, the result would exceed 224.
  const pixels = makeBitmap(64, (insideCircle) => (insideCircle ? [0, 0, 224, 255] : [0, 0, 255, 255]));
  assert.deepEqual(dominantAvatarColor(pixels, 64, 64), { r: 0, g: 0, b: 224 });
});

test('dominantAvatarColor returns null when nothing opaque falls inside the circle', () => {
  const transparent = makeBitmap(64, () => [0, 0, 0, 0]);
  const cornersOnly = makeBitmap(64, (insideCircle) => (insideCircle ? [0, 0, 0, 0] : [255, 0, 0, 255]));

  assert.equal(dominantAvatarColor(transparent, 64, 64), null);
  assert.equal(dominantAvatarColor(cornersOnly, 64, 64), null);
  assert.equal(dominantAvatarColor(null, 64, 64), null);
  assert.equal(dominantAvatarColor(transparent, 0, 64), null);
});

test('deriveAvatarAccent accepts a null dominant color and falls back to the neutral accent', () => {
  assert.deepEqual(deriveAvatarAccent(null), deriveAvatarAccent({ r: 0, g: 0, b: 0 }));
});

test('CommonJS and ESM copies of the module stay behaviorally identical', async () => {
  const module = await import('@voice-room/shared/avatar-accent');
  assert.equal(typeof module.deriveAvatarAccent, 'function');
  assert.equal(typeof module.dominantAvatarColor, 'function');

  // The low-chroma band is where the neutral threshold lives — a drifted
  // constant in one copy shows up here even when pure hues still agree.
  const channels = [0, 63, 100, 110, 127, 140, 150, 191, 224, 255];
  for (const r of channels) {
    for (const g of channels) {
      for (const b of channels) {
        assert.deepEqual(module.deriveAvatarAccent({ r, g, b }), deriveAvatarAccent({ r, g, b }));
      }
    }
  }
  assert.deepEqual(module.deriveAvatarAccent({ r: -100, g: 300, b: Number.NaN }), deriveAvatarAccent({ r: -100, g: 300, b: Number.NaN }));

  const pixels = makeBitmap(64, (insideCircle) => (insideCircle ? [30, 200, 90, 255] : [255, 0, 0, 255]));
  assert.deepEqual(module.dominantAvatarColor(pixels, 64, 64), dominantAvatarColor(pixels, 64, 64));
});
