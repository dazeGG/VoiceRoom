import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { checkKitUsage } from '../check-kit-usage.mts';

/** A temp repository holding the given repo-relative files. */
function repo(t: TestContext, files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-room-kit-usage-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }
  return root;
}

const vue = (template: string) =>
  `<script setup lang="ts">\nconst a = 1;\n</script>\n\n<template>\n${template}\n</template>\n`;

test('an app built from kit components passes', (t) => {
  const root = repo(t, {
    'apps/web/src/Page.vue': vue(
      '  <Button variant="primary" @click="go">Войти</Button>\n  <Popover role="dialog" aria-label="Период" />\n  <div class="page__body"><TextField v-model="name" /></div>'
    ),
    'apps/web/src/styles/_page.scss': '.page__body {\n  gap: var(--space-8);\n  border-radius: var(--radius-12);\n}\n'
  });
  assert.deepEqual(checkKitUsage(root, []), []);
});

test('a native control in an app template fails with file:line', (t) => {
  const root = repo(t, { 'apps/web/src/Page.vue': vue('  <div>\n    <button type="button">Войти</button>\n  </div>') });
  assert.deepEqual(checkKitUsage(root, []), ['apps/web/src/Page.vue:7 native <button>; use the kit component']);
});

test('every native control kind is caught, in every app and in the call views', (t) => {
  const root = repo(t, {
    'apps/admin/src/A.vue': vue('<input v-model="q" />'),
    'apps/meet/src/B.vue': vue('<select v-model="l"></select>'),
    'apps/widget/src/C.vue': vue('<textarea></textarea>'),
    'packages/call/src/views/D.vue': vue('<dialog open></dialog><details></details>')
  });
  const kinds = checkKitUsage(root, [])
    .map((problem) => /native <(\w+)>/.exec(problem)?.[1])
    .sort();
  assert.deepEqual(kinds, ['details', 'dialog', 'input', 'select', 'textarea']);
});

test('the kit itself may use native elements', (t) => {
  const root = repo(t, {
    'packages/ui-kit/src/components/Button/Button.vue': vue('<button class="ui-button"><slot /></button>')
  });
  assert.deepEqual(checkKitUsage(root, []), []);
});

test('a widget role on a plain element fails, the same prop on a kit component does not', (t) => {
  const root = repo(t, {
    'apps/web/src/Leave.vue': vue(
      '<div class="leave" role="dialog" aria-modal="true"></div>\n<Popover role="dialog" />'
    )
  });
  assert.deepEqual(checkKitUsage(root, []), [
    'apps/web/src/Leave.vue:6 role="dialog" on <div>; that widget is a kit component'
  ]);
});

test('a non-widget role is fine', (t) => {
  const root = repo(t, {
    'apps/web/src/A.vue': vue('<p role="status">Сохранено</p><span role="img" aria-label="Звук" />')
  });
  assert.deepEqual(checkKitUsage(root, []), []);
});

test('a hand-written ui-* class fails in class and :class', (t) => {
  const root = repo(t, {
    'apps/web/src/A.vue': vue(
      '<span class="ui-input ui-input--sm"></span>\n<span :class="[\'ui-badge\', { on }]"></span>\n<span class="gui-x build-ui-y"></span>'
    )
  });
  const problems = checkKitUsage(root, []);
  assert.equal(problems.length, 2);
  assert.ok(problems.every((problem) => problem.includes('hand-written ui-* class')));
});

test('an HTML comment in the template is ignored', (t) => {
  const root = repo(t, { 'apps/web/src/A.vue': vue('<!-- was <button class="ui-button"> -->\n<Button>Ок</Button>') });
  assert.deepEqual(checkKitUsage(root, []), []);
});

test('a .ui-* selector in an app stylesheet fails, a comment naming one does not', (t) => {
  const root = repo(t, {
    'apps/web/src/styles/_x.scss': '// .ui-button was restyled here\n.x .ui-button {\n  color: var(--vr-text);\n}\n',
    'packages/ui-kit/src/styles/components/_button.scss': '.ui-button {\n  border-radius: var(--radius-10);\n}\n'
  });
  assert.deepEqual(checkKitUsage(root, []), [
    'apps/web/src/styles/_x.scss:2 a .ui-* selector restyles a kit component; add a variant or prop to it'
  ]);
});

test('a literal radius and a grid-step size fail everywhere, the kit included', (t) => {
  const root = repo(t, {
    'packages/ui-kit/src/styles/components/_x.scss': '.x {\n  border-radius: 12px;\n  height: 40px;\n}\n',
    'apps/web/src/styles/_y.scss':
      '.y {\n  border-radius: 50%;\n  width: 420px;\n  min-height: var(--size-44);\n  border-radius: calc(var(--radius-12) - 4px);\n}\n'
  });
  assert.deepEqual(checkKitUsage(root, []).sort(), [
    'packages/ui-kit/src/styles/components/_x.scss:2 literal border-radius "12px"; use --radius-*',
    'packages/ui-kit/src/styles/components/_x.scss:3 height: 40px is a grid step; use --size-40'
  ]);
});

test('an exception silences one rule for one file, and a stale one is an error', (t) => {
  const root = repo(t, { 'apps/web/src/A.vue': vue('<input type="file" hidden />') });
  assert.deepEqual(
    checkKitUsage(root, [{ file: 'apps/web/src/A.vue', rule: 'native-control', reason: 'file picker' }]),
    []
  );
  assert.deepEqual(checkKitUsage(root, [{ file: 'apps/web/src/B.vue', rule: 'radius', reason: 'gone' }]), [
    'apps/web/src/A.vue:6 native <input>; use the kit component',
    'apps/web/src/B.vue:1 stale kit exception for radius (gone)'
  ]);
});
