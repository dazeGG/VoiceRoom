import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { paletteProblems, webVueApp } from '../check-web-palette.mts';

const SURFACES = `:root {
  --vr-bg: oklch(15.5% 0.005 260);
  --vr-surface: oklch(17.5% 0.005 260);
  --vr-surface-2: oklch(19.5% 0.006 260);
  --vr-surface-3: oklch(24% 0.006 260);
}
`;

/** A temp apps/web-vue with its tokens file plus the given files. */
function app(t: TestContext, files: Record<string, string>, tokens = SURFACES) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-room-web-vue-palette-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [file, content] of Object.entries({ 'src/styles/_tokens.scss': tokens, ...files })) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }
  return webVueApp(root);
}

test('declared tokens and token-based backgrounds in nested SCSS pass', (t) => {
  const palette = app(t, {
    'src/styles/ui/_dialog.scss': `.dialog {
  background: var(--vr-surface);

  &__card {
    background: var(--vr-surface-2);

    &:hover {
      background: color-mix(in oklch, var(--vr-surface-3), transparent 50%);
    }
  }

  @media (max-width: 600px) {
    &__head {
      background: transparent;
    }
  }
}
`
  });
  assert.deepEqual(paletteProblems(palette), []);
});

test('a raw colour in a nested SCSS rule is reported with its resolved selector', (t) => {
  const palette = app(t, {
    'src/styles/ui/_dialog.scss': '.dialog {\n  color: red;\n\n  &__card {\n    background: #123456;\n  }\n}\n'
  });
  assert.deepEqual(paletteProblems(palette), ['src/styles/ui/_dialog.scss:5 .dialog__card -> #123456']);
});

test('a declaration after a nested rule still belongs to the parent', (t) => {
  const palette = app(t, {
    'src/styles/ui/_card.scss': '.card {\n  &__x {\n    color: red;\n  }\n  background: oklch(10% 0 0);\n}\n'
  });
  assert.deepEqual(paletteProblems(palette), ['src/styles/ui/_card.scss:5 .card -> oklch(10% 0 0)']);
});

test('backgrounds in .vue style blocks and style attributes are checked', (t) => {
  const palette = app(t, {
    'src/pages/A.vue':
      '<template><p style="background: #fff" /></template>\n<style lang="scss">\n.a {\n  background-color: rgb(1, 2, 3);\n}\n</style>\n'
  });
  assert.deepEqual(paletteProblems(palette).sort(), [
    'src/pages/A.vue:1 inline style -> #fff',
    'src/pages/A.vue:4 .a -> rgb(1, 2, 3)'
  ]);
});

test('a surface token with a different value is reported', (t) => {
  const palette = app(t, {}, SURFACES.replace('oklch(24% 0.006 260)', 'oklch(30% 0.006 260)'));
  assert.deepEqual(paletteProblems(palette), [
    '--vr-surface-3: expected oklch(24% 0.006 260), found oklch(30% 0.006 260)'
  ]);
});

test('a missing surface token is reported by name', (t) => {
  const palette = app(t, {}, SURFACES.replace(/ {2}--vr-bg:.*\n/, ''));
  assert.deepEqual(paletteProblems(palette), ['_tokens.scss does not declare --vr-bg']);
});
