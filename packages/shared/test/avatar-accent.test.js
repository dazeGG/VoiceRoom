'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { deriveAvatarAccent } = require('@voice-room/shared/avatar-accent');

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
