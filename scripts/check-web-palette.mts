#!/usr/bin/env node
// Style check for the web apps, run by `npm run check`: backgrounds use the
// canonical palette tokens declared in theme.css (apps/web) or _tokens.scss
// (apps/web-vue) instead of one-off colours.
// Exits 1 and lists every violation as `file:line selector -> value`.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, relative, resolve } from 'node:path';

import { blankComments } from './lib/blank-comments.mts';

/** One app whose styles are checked. */
export interface PaletteApp {
  /** App directory; reported paths are relative to it. */
  root: string;
  /** Directory scanned for backgrounds, relative to `root`. */
  sourceDir: string;
  /** File that declares the surface tokens, relative to `root`. */
  tokensFile: string;
  /** Extensions scanned for backgrounds. */
  sources: RegExp;
  /** SCSS: rules nest, so a stylesheet is scanned with the nesting resolved. */
  nested: boolean;
  /** First line of the report when the app has violations. */
  heading: string;
}

export const webApp = (root: string): PaletteApp => ({
  root,
  sourceDir: 'src',
  tokensFile: 'src/lib/shared/styles/theme.css',
  sources: /\.(?:css|svelte)$/,
  nested: false,
  heading: 'Backgrounds must use the palette tokens in theme.css'
});

export const webVueApp = (root: string): PaletteApp => ({
  root,
  sourceDir: 'src',
  tokensFile: 'src/styles/_tokens.scss',
  sources: /\.(?:scss|vue)$/,
  nested: true,
  heading: 'apps/web-vue: backgrounds must use the palette tokens in _tokens.scss'
});

// Surface tokens of the default theme; the tokens file must declare exactly these.
const SURFACE_TOKEN_VALUES: Record<string, string> = {
  '--vr-bg': 'oklch(15.5% 0.005 260)',
  '--vr-surface': 'oklch(17.5% 0.005 260)',
  '--vr-surface-2': 'oklch(19.5% 0.006 260)',
  '--vr-surface-3': 'oklch(24% 0.006 260)'
};
const SURFACE_TOKENS = Object.keys(SURFACE_TOKEN_VALUES);

const SEMANTIC_TOKEN =
  /var\(--(?:vr-(?:accent|online|away|dnd|offline|danger|success|warning|info|text|line|hover|badge|backdrop|scrim|dock|video|on)[\w-]*|avatar-[\w-]+|focus-border|participant-[\w-]+|preview-[\w-]+|profile-cover-accent|slider-fill|toast-accent)/;
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

interface Declaration {
  selector: string;
  value: string;
  /** Offset of the declaration in the fragment body. */
  index: number;
}

function sourceFiles(path: string, sources: RegExp): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(path)) {
    const absolute = resolve(path, entry);
    if (statSync(absolute).isDirectory()) files.push(...sourceFiles(absolute, sources));
    else if (sources.test(entry)) files.push(absolute);
  }
  return files;
}

const lineAt = (source: string, index: number) => source.slice(0, index).split('\n').length;

function styleFragments(path: string, source: string): Fragment[] {
  if (path.endsWith('.css') || path.endsWith('.scss')) return [{ body: source, offset: 0, context: '' }];
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

const normalizeValue = (value: string) => value.trim().replace(/\s+/g, ' ');

/** Background declarations of a plain stylesheet, where a rule never holds another rule. */
function flatDeclarations(fragment: Fragment): Declaration[] {
  const blocks = fragment.context
    ? [{ selector: fragment.context, body: fragment.body, index: 0 }]
    : [...fragment.body.matchAll(/(?<selector>[^{}]+)\{(?<body>[^{}]*)\}/g)].map((match) => ({
        selector: (match.groups?.selector ?? '').trim().replace(/\s+/g, ' '),
        body: match.groups?.body ?? '',
        index: match.index + match[0].indexOf(match.groups?.body ?? '')
      }));
  return blocks.flatMap((block) =>
    [...block.body.matchAll(/\bbackground(?:-color|-image)?\s*:\s*(?<value>[^;}]+)/g)].map((declaration) => ({
      selector: block.selector,
      value: normalizeValue(declaration.groups?.value ?? ''),
      index: block.index + declaration.index
    }))
  );
}

/** `&` takes the parent selector; an at-rule block (@media, @include) keeps the parent's. */
function resolveSelector(parent: string, prelude: string): string {
  if (prelude.startsWith('@')) return parent;
  if (parent === '') return prelude;
  return prelude.includes('&') ? prelude.replaceAll('&', parent) : `${parent} ${prelude}`;
}

/** Background declarations of SCSS, where rules nest and `&` stands for the parent selector. */
function nestedDeclarations(fragment: Fragment): Declaration[] {
  const text = blankComments(fragment.body);
  const found: Declaration[] = [];
  const selectors: string[] = [];
  let start = 0;
  let interpolation = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);
    if (char === '"' || char === "'") {
      const end = text.indexOf(char, index + 1);
      index = end === -1 ? text.length : end;
    } else if (char === '#' && text.charAt(index + 1) === '{') {
      interpolation += 1;
      index += 1;
    } else if (interpolation > 0) {
      if (char === '}') interpolation -= 1;
    } else if (char === '{') {
      const prelude = text.slice(start, index).trim().replace(/\s+/g, ' ');
      selectors.push(resolveSelector(selectors.at(-1) ?? '', prelude));
      start = index + 1;
    } else if (char === ';' || char === '}') {
      const statement = text.slice(start, index);
      const match = /^\s*background(?:-color|-image)?\s*:(?<value>[\s\S]+)$/.exec(statement);
      if (match) {
        found.push({
          selector: selectors.at(-1) ?? '',
          value: normalizeValue(match.groups?.value ?? ''),
          index: start + statement.search(/\S/)
        });
      }
      if (char === '}') selectors.pop();
      start = index + 1;
    }
  }
  return found;
}

/** Every palette violation of one app as `file:line selector -> value`, unsorted. */
export function paletteProblems(app: PaletteApp): string[] {
  const problems: string[] = [];
  const tokensName = basename(app.tokensFile);

  const tokensPath = resolve(app.root, app.tokensFile);
  const tokens = existsSync(tokensPath) ? readFileSync(tokensPath, 'utf8') : '';
  for (const token of Object.keys(SURFACE_TOKEN_VALUES)) {
    const value = tokens.match(new RegExp(`${token}\\s*:\\s*([^;]+)`))?.[1]?.trim();
    if (!value) problems.push(`${tokensName} does not declare ${token}`);
    else if (value !== SURFACE_TOKEN_VALUES[token])
      problems.push(`${token}: expected ${SURFACE_TOKEN_VALUES[token]}, found ${value}`);
  }

  for (const absolute of sourceFiles(resolve(app.root, app.sourceDir), app.sources)) {
    const path = relative(app.root, absolute).split('\\').join('/');
    const source = readFileSync(absolute, 'utf8');
    for (const fragment of styleFragments(path, source)) {
      const declarations = app.nested && !fragment.context ? nestedDeclarations(fragment) : flatDeclarations(fragment);
      for (const declaration of declarations) {
        if (isAllowedBackground(declaration.selector, declaration.value)) continue;
        problems.push(
          `${path}:${lineAt(source, fragment.offset + declaration.index)} ${declaration.selector} -> ${declaration.value}`
        );
      }
    }
  }
  return problems;
}

if (import.meta.main) {
  const repoRoot = resolve(import.meta.dirname, '..');
  let failed = false;
  for (const app of [webApp(resolve(repoRoot, 'apps/web')), webVueApp(resolve(repoRoot, 'apps/web-vue'))]) {
    const problems = paletteProblems(app);
    if (problems.length === 0) continue;
    failed = true;
    process.stderr.write(`${app.heading}:\n${problems.sort().join('\n')}\n`);
  }
  if (failed) process.exit(1);
}
