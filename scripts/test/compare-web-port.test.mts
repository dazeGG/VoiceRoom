import assert from 'node:assert/strict';
import test from 'node:test';
import { compareWithOriginal, importDifferences, webOriginalOf } from '../compare-web-port.mts';

const ORIGINAL = `import { readable } from '$lib/shared/store.ts';
import {
  first,
  second
} from '$lib/api/client.ts';
import type { Room } from '$lib/entities/room/types.ts';
export { helper } from './helper.ts';

/** Says hello. */
export function hello(name: string) {
  return \`hello \${name}\`;
}

export async function load() {
  const module = await import('$lib/shared/late.ts');
  return module.value;
}

const local = 1;
export { local };
`;

test('a port that changes only imports, re-exports and blank lines passes', () => {
  const port = `import { readable } from '@/shared/store.ts';
import { first, second } from '@/api/client.ts';
import type { Room } from '@/entities/room/types.ts';
import './side-effect.ts';
export { helper } from './helper.ts';
/** Says hello. */
export function hello(name: string) {
  return \`hello \${name}\`;
}


export async function load() {
  const module = await import('@/shared/late.ts');
  return module.value;
}
const local = 1;
export { local };
`;
  assert.deepEqual(compareWithOriginal(ORIGINAL, port), []);
});

test('a changed, added or removed code line fails with its line number', () => {
  const port = ORIGINAL.replace('return `hello ${name}`;', 'return `hi ${name}`;')
    .replace('const local = 1;\n', 'const local = 2;\n')
    .replace('export { local };\n', '');
  assert.deepEqual(compareWithOriginal(ORIGINAL, port), [
    '- 11:   return `hello ${name}`;',
    '+ 11:   return `hi ${name}`;',
    '- 19: const local = 1;',
    '- 20: export { local };',
    '+ 19: const local = 2;'
  ]);
});

test('a local export list is code, not an import', () => {
  const port = ORIGINAL.replace('export { local };\n', 'export { local as renamed };\n');
  assert.equal(compareWithOriginal(ORIGINAL, port).length, 2);
});

test('imports that differ only by alias, extension or layout produce no note; a real change does', () => {
  const port = `import { readable } from '@/shared/store.ts';
import { first, second } from '@/api/client.ts';
import type { Room } from '@/entities/room/types.ts';
import './side-effect.ts';
export { helper } from './helper.ts';
`;
  assert.deepEqual(importDifferences(ORIGINAL, port), ["+ import './side-effect.ts'"]);
  assert.deepEqual(importDifferences(ORIGINAL, ORIGINAL.replaceAll('$lib/', '@/')), []);
  const moved = ORIGINAL.replace('$lib/api/client.ts', '@/api/other.ts');
  assert.deepEqual(importDifferences(ORIGINAL, moved), [
    "- import { first, second } from '@/api/client.ts'",
    "+ import { first, second } from '@/api/other.ts'"
  ]);
});

test('.svelte.ts and the test path prefix are normalised', () => {
  const original =
    "import { state } from '$lib/shared/theme/theme.svelte.ts';\nimport { a } from '../src/lib/api/a.ts';\n";
  const port = "import { state } from '@/shared/theme/theme.ts';\nimport { a } from '../src/api/a.ts';\n";
  assert.deepEqual(importDifferences(original, port, true), []);
  assert.equal(importDifferences(original, port, false).length, 2);
});

test('the original is found by path', () => {
  assert.equal(webOriginalOf('apps/web-vue/src/api/client.ts'), 'apps/web/src/lib/api/client.ts');
  assert.equal(webOriginalOf('apps\\web-vue\\src\\platform\\desktop.ts'), 'apps/web/src/lib/platform/desktop.ts');
  assert.equal(webOriginalOf('apps/web-vue/test/new-id.test.ts'), 'apps/web/test/new-id.test.ts');
  assert.throws(() => webOriginalOf('apps/web/src/lib/api/client.ts'), /not under/);
});
