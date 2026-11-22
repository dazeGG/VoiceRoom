import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildKitCss } from '../build-kit-css.mts';

test('the standalone kit stylesheet carries tokens, components and its own fonts', (t) => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'voiceroom-kit-css-'));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));

  const { fonts } = buildKitCss(out);
  const css = fs.readFileSync(path.join(out, 'voiceroom-kit.css'), 'utf8');

  assert.match(css, /--vr-bg:/);
  assert.match(css, /--space-16:/);
  for (const block of ['.ui-button', '.ui-icon-button', '.ui-switch', '.ui-progress', '.ui-dialog', '.ui-callout']) {
    assert.ok(css.includes(block), `${block} is in the bundle`);
  }
  assert.doesNotMatch(css, /@voiceroom\/ui-kit\/fonts/);
  assert.ok(fonts.includes('onest-latin.woff2'));
  for (const font of fonts) {
    assert.ok(css.includes(`url('./fonts/${font}')`), `${font} is referenced relatively`);
    assert.ok(fs.statSync(path.join(out, 'fonts', font)).size > 0, `${font} is copied`);
  }
});
