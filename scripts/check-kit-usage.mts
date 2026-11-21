#!/usr/bin/env node
// Everything is built from the UI kit (DESIGN.md and AGENTS.md, "Kit only").
// Run by `npm run check`. Exits 1 and lists every violation as `file:line reason`.
//
// In the templates of every app and of the call views (the kit itself,
// packages/ui/src, is exempt — that is where these elements live):
//   - a native control: <button>, <input>, <select>, <textarea>, <dialog>,
//     <details> — use the kit component (Button, IconButton, Pressable,
//     TextField, Select, Dialog, …);
//   - a widget role on a plain element (role="dialog", "menu", "tab",
//     "switch", "tooltip", …) — that widget is a kit component;
//   - a `ui-*` class written by hand — only kit components put those on.
// In the stylesheets of every app and of packages/call:
//   - a `.ui-*` selector — restyling a kit component from an app makes a second
//     source of truth; add a variant or a prop to the component instead.
// In every stylesheet, the kit's included:
//   - a literal border-radius — use --radius-*;
//   - a control height or width written in px that is a grid step — use --size-*.
//
// A place that really cannot use the kit goes into KIT_EXCEPTIONS with the reason;
// the list is meant to stay empty, and a stale entry is an error too.

import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import { blank, blankComments } from './lib/blank-comments.mts';
import { walkFiles } from './lib/glob.mts';

export type KitRule = 'native-control' | 'widget-role' | 'kit-class' | 'kit-override' | 'radius' | 'size';

export interface KitException {
  /** Repo-relative path of the file. */
  file: string;
  rule: KitRule;
  reason: string;
}

/** Places allowed to skip a rule. Keep this empty: extend the kit instead. */
export const KIT_EXCEPTIONS: readonly KitException[] = [];

const TEMPLATE_ROOTS = ['apps/web/src', 'apps/admin/src', 'apps/meet/src', 'apps/widget/src', 'packages/call/src'];
const APP_STYLE_ROOTS = ['apps/web/src', 'apps/admin/src', 'apps/meet/src', 'apps/widget/src', 'packages/call/src'];
const KIT_STYLE_ROOT = 'packages/ui/src';

const NATIVE_CONTROLS = ['button', 'input', 'select', 'textarea', 'dialog', 'details'];
const WIDGET_ROLES = [
  'alertdialog',
  'checkbox',
  'combobox',
  'dialog',
  'listbox',
  'menu',
  'menubar',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'radio',
  'radiogroup',
  'separator',
  'slider',
  'spinbutton',
  'switch',
  'tab',
  'tablist',
  'tabpanel',
  'toolbar',
  'tooltip'
];
const GRID_SIZES = new Set([16, 20, 24, 28, 32, 36, 40, 44, 48, 56]);

const TEMPLATE_BLOCK = /<template\b[^>]*>(?<body>[\s\S]*)<\/template>/;
const HTML_COMMENT = /<!--[\s\S]*?-->/g;
const OPEN_TAG = /<(?<tag>[a-z][a-z0-9-]*)(?<attrs>(?:\s[^<>]*?)?)\/?>/g;
const ROLE_ATTR = /(?:^|\s)role\s*=\s*(["'])(?<role>[a-z]+)\1/;
const CLASS_ATTR = /(?:^|\s)(?::class|v-bind:class|class)\s*=\s*(["'])(?<value>[\s\S]*?)\1/g;
const KIT_CLASS = /(?:^|[\s'"`[{,(])ui-[a-z]/;
const KIT_SELECTOR = /\.ui-[a-z]/g;
const DECLARATION = /(?<prop>[a-z-]+)\s*:\s*(?<value>[^;{}]+)/g;
const SIZE_PROPS = new Set([
  'height',
  'min-height',
  'max-height',
  'width',
  'min-width',
  'max-width',
  'block-size',
  'inline-size',
  'min-block-size',
  'min-inline-size'
]);

const lineAt = (source: string, index: number) => source.slice(0, index).split('\n').length;
const repoPath = (repoRoot: string, absolute: string) => relative(repoRoot, absolute).split('\\').join('/');

/** The template of a .vue file with everything else and HTML comments blanked, offsets kept. */
function templateOnly(source: string): string {
  const match = TEMPLATE_BLOCK.exec(source);
  if (!match) return blank(source);
  const body = match.groups?.body ?? '';
  const start = match.index + match[0].indexOf(body);
  const kept = body.replace(HTML_COMMENT, (comment) => blank(comment));
  return blank(source.slice(0, start)) + kept + blank(source.slice(start + body.length));
}

function checkTemplate(source: string, report: (rule: KitRule, index: number, why: string) => void) {
  const template = templateOnly(source);
  for (const match of template.matchAll(OPEN_TAG)) {
    const tag = match.groups?.tag ?? '';
    const attrs = match.groups?.attrs ?? '';
    if (NATIVE_CONTROLS.includes(tag)) {
      report('native-control', match.index, `native <${tag}>; use the kit component`);
    }
    const role = ROLE_ATTR.exec(attrs)?.groups?.role;
    if (role && WIDGET_ROLES.includes(role)) {
      report('widget-role', match.index, `role="${role}" on <${tag}>; that widget is a kit component`);
    }
    for (const cls of attrs.matchAll(CLASS_ATTR)) {
      if (KIT_CLASS.test(cls.groups?.value ?? '')) {
        report('kit-class', match.index, `hand-written ui-* class on <${tag}>; only kit components set them`);
      }
    }
  }
}

function checkStyles(
  source: string,
  isApp: boolean,
  report: (rule: KitRule, index: number, why: string) => void
): void {
  const styles = blankComments(source);
  if (isApp) {
    for (const match of styles.matchAll(KIT_SELECTOR)) {
      report('kit-override', match.index, 'a .ui-* selector restyles a kit component; add a variant or prop to it');
    }
  }
  for (const match of styles.matchAll(DECLARATION)) {
    const prop = match.groups?.prop ?? '';
    const value = match.groups?.value ?? '';
    if (prop === 'border-radius' || /^border-(?:top|bottom|start|end)-(?:left|right|start|end)-radius$/.test(prop)) {
      if (!value.includes('var(') && /\d(?:\.\d+)?(?:px|rem|em)\b/.test(value)) {
        report('radius', match.index, `literal border-radius "${value.trim()}"; use --radius-*`);
      }
      continue;
    }
    if (SIZE_PROPS.has(prop)) {
      const literal = /^\s*(?<n>\d+)px\s*$/.exec(value)?.groups?.n;
      if (literal && GRID_SIZES.has(Number(literal))) {
        report('size', match.index, `${prop}: ${literal}px is a grid step; use --size-${literal}`);
      }
    }
  }
}

/**
 * Violations as `file:line reason`, `file` relative to `repoRoot`.
 * Exceptions are repo-relative too and silence one rule for one file.
 */
export function checkKitUsage(repoRoot: string, exceptions: readonly KitException[] = KIT_EXCEPTIONS): string[] {
  const problems: string[] = [];
  const used = new Set<string>();
  const excused = (file: string, rule: KitRule) => {
    const entry = exceptions.find((candidate) => candidate.file === file && candidate.rule === rule);
    if (entry) used.add(`${entry.file}\0${entry.rule}`);
    return Boolean(entry);
  };
  const reporter = (path: string, source: string) => (rule: KitRule, index: number, why: string) => {
    if (!excused(path, rule)) problems.push(`${path}:${lineAt(source, index)} ${why}`);
  };

  const seen = new Set<string>();
  const roots = [...new Set([...TEMPLATE_ROOTS, ...APP_STYLE_ROOTS, KIT_STYLE_ROOT])];
  for (const root of roots) {
    for (const absolute of walkFiles(resolve(repoRoot, root), () => true)) {
      const path = repoPath(repoRoot, absolute);
      if (seen.has(path)) continue;
      seen.add(path);
      const inKit = path.startsWith(`${KIT_STYLE_ROOT}/`);
      if (absolute.endsWith('.vue') && !inKit && TEMPLATE_ROOTS.some((r) => path.startsWith(`${r}/`))) {
        const source = readFileSync(absolute, 'utf8');
        checkTemplate(source, reporter(path, source));
      } else if (absolute.endsWith('.scss')) {
        const source = readFileSync(absolute, 'utf8');
        checkStyles(source, !inKit, reporter(path, source));
      }
    }
  }

  for (const entry of exceptions) {
    if (!used.has(`${entry.file}\0${entry.rule}`)) {
      problems.push(`${entry.file}:1 stale kit exception for ${entry.rule} (${entry.reason})`);
    }
  }
  return problems;
}

if (import.meta.main) {
  const repoRoot = resolve(import.meta.dirname, '..');
  const problems = checkKitUsage(repoRoot);
  if (problems.length > 0) {
    process.stderr.write(`Build it from the UI kit (DESIGN.md, "Kit only"):\n${problems.sort().join('\n')}\n`);
    process.exit(1);
  }
}
