// What every built page owes, checked when `astro build` finishes so a page that
// breaks it fails the build instead of reaching search engines or the browser:
//
// - no inline script, inline event handler or javascript: URL: the site is
//   served under the app's policy (script-src 'self', Caddyfile,
//   apps/web/scripts/emit-caddy-csp.ts), which blocks all three. JSON-LD is
//   data, not a script, and is allowed;
// - a title and a description, and a canonical address unless the page is noindex.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';

// A start tag with its attributes; a quoted value may hold `>`.
const START_TAG = /<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/g;
const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
// Attributes whose value a browser may load or navigate to.
const URL_ATTRIBUTES = new Set(['href', 'src', 'action', 'formaction', 'xlink:href']);

interface Tag {
  name: string;
  /** By lower-case name; '' for a bare attribute. */
  attributes: Map<string, string>;
  source: string;
}

function tags(html: string): Tag[] {
  return Array.from(html.matchAll(START_TAG), (match) => {
    const attributes = new Map<string, string>();
    for (const attribute of (match[2] ?? '').matchAll(ATTRIBUTE)) {
      attributes.set((attribute[1] ?? '').toLowerCase(), attribute[2] ?? attribute[3] ?? attribute[4] ?? '');
    }
    return { name: (match[1] ?? '').toLowerCase(), attributes, source: match[0] };
  });
}

function metaContent(pageTags: readonly Tag[], name: string): string {
  const meta = pageTags.find((tag) => tag.name === 'meta' && tag.attributes.get('name') === name);
  return meta?.attributes.get('content') ?? '';
}

function canonicalHref(pageTags: readonly Tag[]): string {
  const link = pageTags.find((tag) => tag.name === 'link' && tag.attributes.get('rel') === 'canonical');
  return link?.attributes.get('href') ?? '';
}

/** A browser drops whitespace and control characters (up to U+0020) from a URL before reading its scheme. */
function isJavascriptUrl(value: string): boolean {
  const compact = Array.from(value)
    .filter((char) => (char.codePointAt(0) ?? 0) > 0x20)
    .join('');
  return compact.toLowerCase().startsWith('javascript:');
}

/** What the page at `file` (a name for the report) breaks; empty when nothing. */
export function pageProblems(file: string, html: string): string[] {
  const problems: string[] = [];
  const pageTags = tags(html);
  for (const tag of pageTags) {
    const isData = tag.attributes.get('type')?.toLowerCase() === 'application/ld+json';
    if (tag.name === 'script' && !tag.attributes.has('src') && !isData) {
      problems.push(`${file}: inline ${tag.source}, which script-src 'self' blocks`);
    }
    for (const [name, value] of tag.attributes) {
      if (name.startsWith('on')) {
        problems.push(`${file}: inline event handler ${name} on <${tag.name}>, which script-src 'self' blocks`);
      }
      if (URL_ATTRIBUTES.has(name) && isJavascriptUrl(value)) {
        problems.push(`${file}: a javascript: URL in <${tag.name} ${name}>, which script-src 'self' blocks`);
      }
    }
  }
  if (!/<title>[^<]*\S[^<]*<\/title>/i.test(html)) problems.push(`${file}: no <title>`);
  if (!metaContent(pageTags, 'description').trim()) problems.push(`${file}: no meta description`);
  const noindex = metaContent(pageTags, 'robots').includes('noindex');
  if (!noindex && !canonicalHref(pageTags).startsWith('https://')) problems.push(`${file}: no absolute canonical link`);
  return problems;
}

function htmlFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return htmlFiles(path);
    return entry.name.endsWith('.html') ? [path] : [];
  });
}

/** Every problem of the pages built into `directory`. */
export function buildProblems(directory: string): string[] {
  return htmlFiles(directory).flatMap((file) =>
    pageProblems(relative(directory, file).split('\\').join('/'), readFileSync(file, 'utf8'))
  );
}

export function buildContract(): AstroIntegration {
  return {
    name: 'voiceroom-build-contract',
    hooks: {
      'astro:build:done': ({ dir }) => {
        const problems = buildProblems(fileURLToPath(dir));
        if (problems.length > 0) throw new Error(`The site breaks its build contract:\n${problems.join('\n')}`);
      }
    }
  };
}
