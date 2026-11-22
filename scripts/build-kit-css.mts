#!/usr/bin/env node
// Compiles the UI kit to one plain CSS file for pages that are not built with
// Vue, such as the desktop shell's own windows. Writes
// packages/ui-kit/dist/standalone/voiceroom-kit.css and the fonts it needs next
// to it in fonts/, with the font URLs rewritten to ./fonts/<file>.
//
//   npm --workspace @voiceroom/ui-kit run build:css
//
// The desktop repository copies this folder in with its `kit:sync` script.

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodePackageImporter, compile } from 'sass';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const kit = join(root, 'packages/ui-kit');
const FONT_URL = /url\((['"]?)@voiceroom\/ui-kit\/fonts\/([\w.-]+\.woff2)\1\)/g;

export interface KitCss {
  css: string;
  fonts: string[];
}

/** The compiled kit stylesheet and the font files it references. */
export function compileKitCss(): KitCss {
  const { css } = compile(join(kit, 'src/styles/_standalone.scss'), {
    importers: [new NodePackageImporter(kit)],
    style: 'expanded',
    sourceMap: false
  });
  const fonts = new Set<string>();
  const rewritten = css.replace(FONT_URL, (_match, _quote: string, file: string) => {
    fonts.add(file);
    return `url('./fonts/${file}')`;
  });
  return { css: rewritten, fonts: [...fonts].sort() };
}

function sourceRevision(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

/** Writes the stylesheet and its fonts into `outDir`, replacing what was there. */
export function buildKitCss(outDir = join(kit, 'dist/standalone')): KitCss {
  const result = compileKitCss();
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(outDir, 'fonts'), { recursive: true });
  const header = `/* Generated from @voiceroom/ui-kit (VoiceRoom ${sourceRevision()}) by scripts/build-kit-css.mts. Do not edit. */\n`;
  writeFileSync(join(outDir, 'voiceroom-kit.css'), header + result.css + '\n');
  const fontDir = join(kit, 'src/assets/fonts');
  const available = new Set(readdirSync(fontDir));
  for (const font of result.fonts) {
    if (!available.has(font)) throw new Error(`the kit stylesheet references a missing font: ${font}`);
    copyFileSync(join(fontDir, font), join(outDir, 'fonts', font));
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outDir = process.argv[2] ? resolve(process.argv[2]) : undefined;
  const { css, fonts } = buildKitCss(outDir);
  console.log(`voiceroom-kit.css: ${Math.round(css.length / 1024)} KiB, ${fonts.length} fonts`);
}
