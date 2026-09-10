import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

export async function loadMessagingModule(relativeUrl, { replaceSvelteTick = false } = {}) {
  let source = readFileSync(relativeUrl, 'utf8');
  if (replaceSvelteTick) source = source.replace("import { tick } from 'svelte';", 'const tick = async () => {};');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
    fileName: basename(relativeUrl.pathname)
  }).outputText;
  const dir = mkdtempSync(join(tmpdir(), 'voice-room-messaging-test-'));
  const file = join(dir, 'module.mjs');
  writeFileSync(file, 'globalThis.$state ??= (value) => value;\n' + output);
  try { return await import(`${pathToFileURL(file).href}?v=${Date.now()}-${Math.random()}`); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}
