import assert from 'node:assert/strict';
import test from 'node:test';
import { g08Closure } from '../ci/g08-closure.mts';
import { measuredInputs, workspace } from '../ci/routing-inputs.mts';
import { moduleImports } from '../ci/g08-imports.mts';

test('static module edges include multiline imports, re-exports and nested literal imports, not examples', () => {
  const source = [
    "// import './comment'",
    'const example = "export * from \'./example\'";',
    "const pattern = /import('ignore')/;",
    'import type {',
    '  Message',
    "} from /* a comment */ './shape';",
    "export * as locale from './catalog.ts';",
    "import './side-effect.js';",
    "const label = `value: ${(await import('./runtime')).value}`;"
  ].join('\n');
  assert.deepEqual(moduleImports('src/entry.ts', source), ['./shape', './catalog.ts', './side-effect.js', './runtime']);
});

test('both Vue scripts contribute their edges; template text is not an import declaration', () => {
  const sfc = `<script lang="ts">export { x } from './server'</script>
    <template>export { y } from './not-code'</template>
    <script setup>import './client'</script>`;
  assert.deepEqual(moduleImports('src/Feature.vue', sfc), ['./server', './client']);
});

test('a computed dynamic import may not silently drop part of the closure', () => {
  for (const code of ['import(file)', "import('./prefix' + name)", 'import(`./${name}`)']) {
    assert.throws(() => moduleImports('src/feature.js', code));
  }
});

test('a workspace boundary retains all its src and follows its actual export beyond that directory', () => {
  const root = 'apps/web/src/api/auth.ts';
  const policy = measuredInputs({ businessPathPatterns: [root], strictBranchGroups: [] });
  const manifests = [
    workspace('apps/web', { name: '@voiceroom/web', dependencies: { '@voiceroom/ui': '*' } }),
    workspace('packages/ui', { name: '@voiceroom/ui', exports: { './log': './src/log.ts' } })
  ];
  const input = new Map([
    [root, "export * from '@voiceroom/ui/log'"],
    ['packages/ui/src/log.ts', "export * from '../extras/record'"],
    ['packages/ui/extras/record.ts', 'export const x = 1'],
    ['packages/ui/extras/record/index.ts', "import './not-a-runtime-dependency'"]
  ]);
  const resolve = () =>
    g08Closure(policy, [...input.keys()], manifests, (p) => {
      const source = input.get(p);
      assert.notEqual(source, undefined, p);
      return source ?? '';
    });
  const closure = resolve();
  assert.ok(closure.prefixes.includes('packages/ui/src/'));
  assert.ok(closure.exact.includes('packages/ui/extras/record.ts'));
  assert.ok(!closure.exact.includes('packages/ui/extras/record/index.ts'));
  input.set(root, "export * from '@voiceroom/ui/missing-export'");
  assert.throws(resolve, /missing-export/);
  input.set(root, "import 'unknown-package'");
  assert.throws(resolve, /unknown-package/);
});

test('a JSON leaf still needs a readable regular file in that tree', () => {
  const root = 'apps/web/src/api/auth.ts';
  const policy = measuredInputs({ businessPathPatterns: [root], strictBranchGroups: [] });
  const paths = [root, 'apps/web/src/api/messages.json'];
  assert.throws(
    () =>
      g08Closure(policy, paths, [], (path) => {
        if (path === root) return "import './messages.json';";
        throw new Error('not a tracked regular file: ' + path);
      }),
    /messages\.json/
  );
});
