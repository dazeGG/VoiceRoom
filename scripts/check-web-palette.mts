#!/usr/bin/env node
// Style check for the web app, run by `npm run check`: backgrounds use the
// canonical palette tokens declared in theme.css instead of one-off colours.
// Exits 1 and lists every violation as `file:line selector -> value`.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const webRoot = resolve(import.meta.dirname, '../apps/web');
const sourceRoot = resolve(webRoot, 'src');

// Surface tokens of the default theme; theme.css must declare exactly these.
const SURFACE_TOKEN_VALUES: Record<string, string> = {
  '--vr-bg': 'oklch(15.5% 0.005 260)',
  '--vr-surface': 'oklch(17.5% 0.005 260)',
  '--vr-surface-2': 'oklch(19.5% 0.006 260)',
  '--vr-surface-3': 'oklch(24% 0.006 260)'
};
const SURFACE_TOKENS = Object.keys(SURFACE_TOKEN_VALUES);

const SEMANTIC_TOKEN =
  /var\(--(?:vr-(?:accent|online|away|dnd|offline|danger|success|warning|info|text|line|hover|badge|backdrop|scrim|dock|on)[\w-]*|avatar-[\w-]+|focus-border|participant-[\w-]+|preview-[\w-]+|profile-cover-accent|slider-fill|toast-accent)/;
const SEMANTIC_SELECTOR =
  /(?:\[aria-pressed|accent|action|active|avatar|away|check|connected|danger|decline|delete|destructive|dnd|dock-bar|error|exit|idle|launch|leave|live|not-found|offline|online|owner|record|remove|room-chat-unread|screen-source-pop-dot|status|stop|submit|success|thumb|toggle|warning)/i;
const IMAGE_SELECTOR =
  /(?:404|art|artwork|avatar|brand|crop-stage|illustration|image|logo|preview|screen-video|stream-tile-video|swatch|visual|watermark)/i;
const RAW_COLOR_LITERAL = /#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(|\b(?:black|white)\b/i;

interface Fragment {
  body: string;
  offset: number;
  context: string;
}

function sourceFiles(path: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(path)) {
    const absolute = resolve(path, entry);
    if (statSync(absolute).isDirectory()) files.push(...sourceFiles(absolute));
    else if (/\.(?:css|svelte)$/.test(entry)) files.push(absolute);
  }
  return files;
}

const lineAt = (source: string, index: number) => source.slice(0, index).split('\n').length;

function styleFragments(path: string, source: string): Fragment[] {
  if (path.endsWith('.css')) return [{ body: source, offset: 0, context: '' }];
  const fragments: Fragment[] = [];
  for (const match of source.matchAll(/<style(?:\s[^>]*)?>(?<body>[\s\S]*?)<\/style>/g)) {
    const body = match.groups?.body ?? '';
    fragments.push({ body, offset: match.index + match[0].indexOf(body), context: '' });
  }
  for (const match of source.matchAll(/\bstyle\s*=\s*(["'])(?<body>[\s\S]*?)\1/g)) {
    const body = match.groups?.body ?? '';
    fragments.push({ body, offset: match.index + match[0].indexOf(body), context: 'inline style' });
  }
  return fragments;
}

const hasSurfaceToken = (value: string) => SURFACE_TOKENS.some((token) => new RegExp(`var\\(${token}\\b`).test(value));

function isAllowedBackground(selector: string, value: string): boolean {
  const normalized = value.trim();
  if (/^(?:none|transparent|inherit|initial|unset)$/i.test(normalized)) return true;
  if (RAW_COLOR_LITERAL.test(normalized)) return false;
  if (/(?:gradient|image-set|url)\(/i.test(normalized)) return true;
  if (SEMANTIC_TOKEN.test(normalized)) return true;
  if (SEMANTIC_SELECTOR.test(selector) || IMAGE_SELECTOR.test(selector)) return true;
  if (hasSurfaceToken(normalized) && /color-mix\(/i.test(normalized)) return true;
  return (
    hasSurfaceToken(normalized) &&
    !/(?:#[\da-f]{3,8}\b|\b(?:black|white)\b|\b(?:rgb|hsl|oklch|oklab|lab|lch)\()/i.test(normalized)
  );
}

const problems: string[] = [];

const themeCss = readFileSync(resolve(sourceRoot, 'lib/shared/styles/theme.css'), 'utf8');
for (const token of Object.keys(SURFACE_TOKEN_VALUES)) {
  const value = themeCss.match(new RegExp(`${token}\\s*:\\s*([^;]+)`))?.[1]?.trim();
  if (!value) problems.push(`theme.css does not declare ${token}`);
  else if (value !== SURFACE_TOKEN_VALUES[token])
    problems.push(`${token}: expected ${SURFACE_TOKEN_VALUES[token]}, found ${value}`);
}

for (const absolute of sourceFiles(sourceRoot)) {
  const path = relative(webRoot, absolute).split('\\').join('/');
  const source = readFileSync(absolute, 'utf8');
  for (const fragment of styleFragments(path, source)) {
    const blocks = fragment.context
      ? [{ selector: fragment.context, body: fragment.body, index: 0 }]
      : [...fragment.body.matchAll(/(?<selector>[^{}]+)\{(?<body>[^{}]*)\}/g)].map((match) => ({
          selector: (match.groups?.selector ?? '').trim().replace(/\s+/g, ' '),
          body: match.groups?.body ?? '',
          index: match.index + match[0].indexOf(match.groups?.body ?? '')
        }));
    for (const block of blocks) {
      for (const declaration of block.body.matchAll(/\bbackground(?:-color|-image)?\s*:\s*(?<value>[^;}]+)/g)) {
        const value = (declaration.groups?.value ?? '').trim().replace(/\s+/g, ' ');
        if (isAllowedBackground(block.selector, value)) continue;
        problems.push(
          `${path}:${lineAt(source, fragment.offset + block.index + declaration.index)} ${block.selector} -> ${value}`
        );
      }
    }
  }
}

if (problems.length > 0) {
  process.stderr.write(`Backgrounds must use the palette tokens in theme.css:\n${problems.sort().join('\n')}\n`);
  process.exit(1);
}
