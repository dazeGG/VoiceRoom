import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { checkWebVueStyles } from '../check-web-vue-styles.mts';

/** A temp repository with an apps/web-vue/src tree of the given files. */
function tree(t: TestContext, files: Record<string, string>) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-room-web-vue-styles-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const src = path.join(repo, 'apps/web-vue/src');
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(src, file)), { recursive: true });
    fs.writeFileSync(path.join(src, file), content);
  }
  return { repo, src };
}

test('a clean tree passes', (t) => {
  const { repo, src } = tree(t, {
    'styles/ui/_dialog.scss': ".dialog__tab[aria-selected='true'] { color: var(--vr-text); }\n",
    'App.vue': '<script setup lang="ts">\nconst x = 1;\n</script>\n\n<template><p>{{ x }}</p></template>\n',
    'shared/ui/Dialog.vue': '<script setup lang="ts">\nimport { DialogRoot } from \'reka-ui\';\n</script>\n'
  });
  assert.deepEqual(checkWebVueStyles(src, repo), []);
});

test('a [data-*] rule in a .scss file fails with file:line', (t) => {
  const { repo, src } = tree(t, { 'styles/home/_x.scss': '.a {\n  color: red;\n}\n.x[data-x] {\n  color: blue;\n}\n' });
  const problems = checkWebVueStyles(src, repo);
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? '', /^apps\/web-vue\/src\/styles\/home\/_x\.scss:4 /);
});

test('[DATA-*] in any case fails', (t) => {
  const { repo, src } = tree(t, { 'styles/home/_x.scss': '.x[DATA-x] {\n  color: blue;\n}\n' });
  const problems = checkWebVueStyles(src, repo);
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? '', /_x\.scss:1 \[data-\*\] selector/);
});

test('a .css or .sass file under src fails', (t) => {
  const { repo, src } = tree(t, {
    'styles/home/legacy.css': '.a { color: red; }\n',
    'styles/home/legacy.sass': '.a\n  color: red\n',
    'styles/home/_ok.scss': '.a { color: red; }\n'
  });
  const problems = checkWebVueStyles(src, repo).sort();
  assert.equal(problems.length, 2);
  assert.match(problems[0] ?? '', /^apps\/web-vue\/src\/styles\/home\/legacy\.css:1 stylesheet must be a \.scss/);
  assert.match(problems[1] ?? '', /^apps\/web-vue\/src\/styles\/home\/legacy\.sass:1 stylesheet must be a \.scss/);
});

test('a comment may name the old Svelte selector', (t) => {
  const { repo, src } = tree(t, {
    'styles/home/_x.scss': "// Svelte: [data-active='true']\n/* [data-x] */\n.x[aria-current] { color: red; }\n"
  });
  assert.deepEqual(checkWebVueStyles(src, repo), []);
});

test('a <style> block in a .vue file fails unless the file is allowlisted with a comment', (t) => {
  const withStyle = '<template><p /></template>\n\n<style scoped>\np { color: red; }\n</style>\n';
  const { repo, src } = tree(t, { 'pages/A.vue': withStyle });
  const file = 'apps/web-vue/src/pages/A.vue';

  const failing = checkWebVueStyles(src, repo);
  assert.equal(failing.length, 1);
  assert.match(failing[0] ?? '', new RegExp(`^${file}:3 `));

  const allowlist = [{ file, reason: 'third-party markup' }];
  const uncommented = checkWebVueStyles(src, repo, allowlist);
  assert.equal(uncommented.length, 1);
  assert.match(uncommented[0] ?? '', /needs a one-line comment/);

  fs.writeFileSync(
    path.join(src, 'pages/A.vue'),
    '<template><p /></template>\n<!-- scoped: styles third-party markup -->\n<style scoped>\np { color: red; }\n</style>\n'
  );
  assert.deepEqual(checkWebVueStyles(src, repo, allowlist), []);
});

test('an allowlisted, commented <style> block still may not carry a [data-*] selector', (t) => {
  const { repo, src } = tree(t, {
    'pages/A.vue':
      '<template><p /></template>\n<!-- scoped: styles third-party markup -->\n<style scoped>\n.a {\n  color: red;\n}\n.x[data-x] {\n  color: blue;\n}\n</style>\n'
  });
  const problems = checkWebVueStyles(src, repo, [
    { file: 'apps/web-vue/src/pages/A.vue', reason: 'third-party markup' }
  ]);
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? '', /^apps\/web-vue\/src\/pages\/A\.vue:7 \[data-\*\] selector/);
});

test('an allowlist entry whose file has no <style> block is reported', (t) => {
  const { repo, src } = tree(t, { 'pages/A.vue': '<template><p /></template>\n' });
  const problems = checkWebVueStyles(src, repo, [{ file: 'apps/web-vue/src/pages/A.vue', reason: 'old' }]);
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? '', /allowlist entry without a <style> block/);
});

test('a reka-ui import fails outside shared/ui and passes inside it', (t) => {
  const { repo, src } = tree(t, {
    'features/A.vue': '<script setup lang="ts">\nimport { DialogRoot } from \'reka-ui\';\n</script>\n',
    'features/b.ts': "export { SelectRoot } from 'reka-ui/select';\n",
    'features/c.ts': "const load = () => import('reka-ui');\n",
    'features/d.ts': "// import { Dialog } from 'reka-ui' is only for shared/ui\nexport const d = 1;\n",
    'shared/ui/Dialog.vue': '<script setup lang="ts">\nimport { DialogRoot } from \'reka-ui\';\n</script>\n',
    'shared/ui/select.ts': "import { SelectRoot } from 'reka-ui/select';\nexport { SelectRoot };\n"
  });
  const problems = checkWebVueStyles(src, repo).sort();
  assert.equal(problems.length, 3);
  assert.match(problems[0] ?? '', /^apps\/web-vue\/src\/features\/A\.vue:2 reka-ui import/);
  assert.match(problems[1] ?? '', /^apps\/web-vue\/src\/features\/b\.ts:1 reka-ui import/);
  assert.match(problems[2] ?? '', /^apps\/web-vue\/src\/features\/c\.ts:1 reka-ui import/);
});
