import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const sourceRoot = resolve(root, 'src');

const SURFACE_TOKEN_VALUES = {
  '--paper-deep': 'oklch(8.5% 0.032 112)',
  '--paper': 'oklch(13% 0.038 112)',
  '--panel': 'oklch(19% 0.042 112)',
  '--panel-strong': 'oklch(25% 0.045 112)',
  '--control': 'oklch(22% 0.043 112)',
  '--warm-800': '#16140f',
  '--warm-900': '#0c0b08',
  '--warm-950': '#0a0907'
};

const SURFACE_TOKENS = Object.keys(SURFACE_TOKEN_VALUES);

const SEMANTIC_TOKEN = /var\(--(?:accent(?:-[\w-]+)?|amber|avatar-[\w-]+|blue|coral|focus-border|green|ink|line|muted|participant-[\w-]+|preview-[\w-]+|profile-cover-accent|room-avatar-bg|slider-fill|stream-live(?:-hover)?|toast-accent|warm-(?:faint|ink(?:-dim)?|muted(?:-dim)?))\b/;
const SEMANTIC_SELECTOR = /(?:\[aria-pressed|accent|action|active|avatar|away|check|connected|danger|decline|delete|destructive|dnd|dock-bar|error|exit|idle|launch|leave|live|not-found|offline|online|owner|record|remove|room-chat-unread|screen-source-pop-dot|status|stop|submit|success|thumb|toggle|warning)/i;
const IMAGE_SELECTOR = /(?:404|art|artwork|avatar|brand|crop-stage|illustration|image|logo|preview|screen-video|stream-tile-video|swatch|visual|watermark)/i;
const RAW_COLOR_LITERAL = /#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(|\b(?:black|white)\b/i;

function readSource(path) {
  return readFileSync(resolve(root, path), 'utf8');
}

function sourceFiles(path) {
  const files = [];
  for (const entry of readdirSync(path)) {
    const absolute = resolve(path, entry);
    if (statSync(absolute).isDirectory()) files.push(...sourceFiles(absolute));
    else if (/\.(?:css|svelte)$/.test(entry)) files.push(absolute);
  }
  return files;
}

function lineAt(source, index) {
  return source.slice(0, index).split('\n').length;
}

function styleFragments(path, source) {
  if (path.endsWith('.css')) return [{ body: source, offset: 0, context: '' }];

  const fragments = [];
  for (const match of source.matchAll(/<style(?:\s[^>]*)?>(?<body>[\s\S]*?)<\/style>/g)) {
    const bodyOffset = match.index + match[0].indexOf(match.groups.body);
    fragments.push({ body: match.groups.body, offset: bodyOffset, context: '' });
  }
  for (const match of source.matchAll(/\bstyle\s*=\s*(["'])(?<body>[\s\S]*?)\1/g)) {
    const bodyOffset = match.index + match[0].indexOf(match.groups.body);
    fragments.push({ body: match.groups.body, offset: bodyOffset, context: 'inline style' });
  }
  return fragments;
}

function hasSurfaceToken(value) {
  return SURFACE_TOKENS.some((token) => new RegExp(`var\\(${token}\\b`).test(value));
}

function isAllowedBackground(selector, value) {
  const normalized = value.trim();
  if (/^(?:none|transparent|inherit|initial|unset)$/i.test(normalized)) return true;
  if (RAW_COLOR_LITERAL.test(normalized)) return false;
  if (/(?:gradient|image-set|url)\(/i.test(normalized)) return true;
  if (SEMANTIC_TOKEN.test(normalized)) return true;
  if (SEMANTIC_SELECTOR.test(selector) || IMAGE_SELECTOR.test(selector)) return true;
  if (hasSurfaceToken(normalized) && /color-mix\(/i.test(normalized)) return true;
  if (hasSurfaceToken(normalized) && !/(?:#[\da-f]{3,8}\b|\b(?:black|white)\b|\b(?:rgb|hsl|oklch|oklab|lab|lch)\()/i.test(normalized)) return true;
  return false;
}

function paletteViolations() {
  const violations = [];
  for (const absolute of sourceFiles(sourceRoot)) {
    const path = absolute.slice(root.length + 1);
    const source = readFileSync(absolute, 'utf8');
    for (const fragment of styleFragments(path, source)) {
      const blocks = fragment.context
        ? [{ selector: fragment.context, body: fragment.body, index: 0 }]
        : [...fragment.body.matchAll(/(?<selector>[^{}]+)\{(?<body>[^{}]*)\}/g)].map((match) => ({
            selector: match.groups.selector.trim().replace(/\s+/g, ' '),
            body: match.groups.body,
            index: match.index + match[0].indexOf(match.groups.body)
          }));

      for (const block of blocks) {
        for (const declaration of block.body.matchAll(/\bbackground(?:-color|-image)?\s*:\s*(?<value>[^;}]+)/g)) {
          const value = declaration.groups.value.trim().replace(/\s+/g, ' ');
          if (isAllowedBackground(block.selector, value)) continue;
          const index = fragment.offset + block.index + declaration.index;
          violations.push(`${path}:${lineAt(source, index)} ${block.selector} -> ${value}`);
        }
      }
    }
  }
  return violations.sort();
}

test('application backgrounds use the canonical palette tokens', () => {
  const appCss = readSource('src/lib/shared/styles/app.css');
  const missingTokens = SURFACE_TOKENS.filter((token) => !new RegExp(`${token}\\s*:`).test(appCss));
  const mismatchedTokens = SURFACE_TOKENS.flatMap((token) => {
    const value = appCss.match(new RegExp(`${token}\\s*:\\s*([^;]+)`))?.[1].trim();
    return value && value !== SURFACE_TOKEN_VALUES[token]
      ? [`${token}: expected ${SURFACE_TOKEN_VALUES[token]}, received ${value}`]
      : [];
  });

  assert.deepEqual(
    { missingTokens, mismatchedTokens, violations: paletteViolations() },
    { missingTokens: [], mismatchedTokens: [], violations: [] },
    'declare every canonical surface token and replace one-off background colors with palette tokens'
  );
});
