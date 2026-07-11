'use strict';

const ACCENT_LIGHTNESS = 0.36;
const MAX_ACCENT_CHROMA = 0.1;
const NEUTRAL_CHROMA_THRESHOLD = 0.025;
const SHADOW_ALPHA_HEX = '52';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeChannel(value) {
  return Number.isFinite(value) ? clamp(value, 0, 255) / 255 : 0;
}

function srgbToLinear(value) {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(value) {
  return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
}

function rgbToOklch(rgb) {
  const red = srgbToLinear(normalizeChannel(rgb?.r));
  const green = srgbToLinear(normalizeChannel(rgb?.g));
  const blue = srgbToLinear(normalizeChannel(rgb?.b));

  const l = 0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue;
  const m = 0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue;
  const s = 0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue;

  const lRoot = Math.cbrt(l);
  const mRoot = Math.cbrt(m);
  const sRoot = Math.cbrt(s);

  const lightness = 0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot;
  const a = 1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot;
  const b = 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot;

  return {
    lightness,
    chroma: Math.hypot(a, b),
    hue: Math.atan2(b, a)
  };
}

function oklchToLinearRgb(lightness, chroma, hue) {
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);

  const lRoot = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const mRoot = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const sRoot = lightness - 0.0894841775 * a - 1.291485548 * b;

  const l = lRoot ** 3;
  const m = mRoot ** 3;
  const s = sRoot ** 3;

  return {
    red: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    green: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    blue: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  };
}

function isInSrgbGamut(rgb) {
  return rgb.red >= 0 && rgb.red <= 1 && rgb.green >= 0 && rgb.green <= 1 && rgb.blue >= 0 && rgb.blue <= 1;
}

function fitChromaToSrgb(lightness, chroma, hue) {
  if (isInSrgbGamut(oklchToLinearRgb(lightness, chroma, hue))) return chroma;

  let low = 0;
  let high = chroma;
  for (let iteration = 0; iteration < 18; iteration += 1) {
    const candidate = (low + high) / 2;
    if (isInSrgbGamut(oklchToLinearRgb(lightness, candidate, hue))) low = candidate;
    else high = candidate;
  }
  return low;
}

function toHexChannel(value) {
  return Math.round(clamp(linearToSrgb(value), 0, 1) * 255)
    .toString(16)
    .padStart(2, '0');
}

function oklchToHex(lightness, chroma, hue) {
  const fittedChroma = fitChromaToSrgb(lightness, chroma, hue);
  const rgb = oklchToLinearRgb(lightness, fittedChroma, hue);
  return `#${toHexChannel(rgb.red)}${toHexChannel(rgb.green)}${toHexChannel(rgb.blue)}`;
}

/**
 * Derives the dark, hue-preserving presentation used behind a user avatar.
 * Invalid channels are treated as zero so untrusted image metadata cannot
 * produce NaN or malformed CSS values.
 */
function deriveAvatarAccent(rgb) {
  const source = rgbToOklch(rgb);
  const isNeutral = !Number.isFinite(source.hue) || source.chroma < NEUTRAL_CHROMA_THRESHOLD;
  const hue = isNeutral ? 0 : source.hue;
  const chroma = isNeutral ? 0 : Math.min(source.chroma, MAX_ACCENT_CHROMA);
  const background = oklchToHex(ACCENT_LIGHTNESS, chroma, hue);

  return {
    background,
    foreground: '#ffffff',
    shadow: `0 10px 24px ${background}${SHADOW_ALPHA_HEX}`
  };
}

module.exports = {
  deriveAvatarAccent
};
