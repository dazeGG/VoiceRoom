import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';
import * as sass from 'sass';

type RGB = readonly [number, number, number];
type Color = { rgb: RGB; alpha: number };
const root = resolve(import.meta.dirname, '../..');
function declarations(css: string): Map<string, string> {
  return new Map([...css.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [match[1] ?? '', match[2] ?? '']));
}
function required(values: Map<string, string>, name: string): string {
  const value = values.get(name);
  assert.ok(value, `Missing CSS token ${name}`);
  return value.replace(/var\((--[\w-]+)\)/g, (_, token: string) => required(values, token));
}
function color(value: string): Color {
  let result: Color | undefined;
  // Evaluate the emitted CSS color-mix in Sass using its declared color space.
  const expression = value.replace(
    /^color-mix\(in ([\w-]+), (.+), (.+)\)$/,
    (_, space: string, first: string, second: string) => {
      const weighted = /^(.*) ([\d.]+)%$/.exec(second);
      const last = weighted?.[1] ?? second;
      const weight = weighted ? 100 - Number(weighted[2]) : 50;
      return `color.mix(${first}, ${last}, $weight: ${weight}%, $method: ${space})`;
    }
  );
  sass.compileString(`@use 'sass:color'; .probe { color: capture(${expression}); }`, {
    functions: {
      'capture($value)': (args) => {
        const argument = args[0];
        assert.ok(argument);
        const value = argument.assertColor('value').toSpace('srgb');
        const channel = (name: 'red' | 'green' | 'blue') => Math.max(0, Math.min(1, value.channel(name) ?? 0));
        result = { rgb: [channel('red'), channel('green'), channel('blue')], alpha: value.alpha };
        return sass.sassNull;
      }
    }
  });
  assert.ok(result);
  return result;
}
function luminance(rgb: RGB): number {
  const linear = (value: number) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return linear(rgb[0]) * 0.2126 + linear(rgb[1]) * 0.7152 + linear(rgb[2]) * 0.0722;
}
function over(foreground: Color, background: RGB): RGB {
  const mix = (channel: 0 | 1 | 2) =>
    foreground.rgb[channel] * foreground.alpha + background[channel] * (1 - foreground.alpha);
  return [mix(0), mix(1), mix(2)];
}
const surfaces = [
  '--vr-bg',
  '--vr-surface',
  '--vr-surface-2',
  '--vr-surface-3',
  '--vr-surface-2-hover',
  '--vr-surface-3-hover',
  '--vr-video-bg',
  '--vr-badge-muted-bg'
];
const overlays = [
  '--vr-hover',
  '--vr-accent-soft',
  '--vr-accent-soft-hover',
  '--vr-danger-soft',
  '--vr-danger-off',
  '--vr-danger-hover'
];
const styles = process.argv.includes('--site')
  ? ['apps/site/src/styles/site.scss']
  : ['packages/ui/src/styles/_tokens.scss', 'apps/admin/src/styles/theme.css'];
for (const path of styles) {
  const css = sass.compile(resolve(root, path), { importers: [new sass.NodePackageImporter(root)] }).css;
  const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1] ?? '',
    body: match[2] ?? ''
  }));
  const base = new Map<string, string>();
  for (const block of blocks) {
    if (block.selector.includes(':root') || block.selector.trim() === '.site') {
      for (const [key, value] of declarations(block.body)) base.set(key, value);
    }
  }
  for (const theme of path.includes('/admin/') ? ['volt'] : ['volt', 'ice', 'coral']) {
    test(`${path}: ${theme} readable text on surfaces and composed states`, () => {
      const values = new Map(base);
      for (const block of blocks) {
        if (block.selector.includes(`.theme--graphite-${theme}`)) {
          for (const [key, value] of declarations(block.body)) values.set(key, value);
        }
      }
      const text = color(required(values, path.includes('/site/') ? '--site-text-3' : '--vr-text-muted')).rgb;
      let minimum = Infinity;
      const check = (label: string, background: RGB, foreground = text) => {
        const ratio = (luminance(foreground) + 0.05) / (luminance(background) + 0.05);
        minimum = Math.min(minimum, ratio);
        assert.ok(ratio >= 4.5, `${label}: ${ratio.toFixed(3)}:1`);
      };
      if (path.includes('/site/')) {
        const property = (selector: string, name: string) => {
          const block = blocks.find((block) => block.selector.trim() === selector);
          assert.ok(block, selector);
          const declaration = new RegExp(`(?:^|;)\\s*${name}:\\s*([^;]+)`).exec(block.body)?.[1];
          assert.ok(declaration, `${selector} ${name}`);
          return declaration.replace(/var\((--[\w-]+)\)/g, (_, token: string) => required(values, token));
        };
        // Site consumers: hero/captions/compare note and unselected download tabs
        // on bg; invite rows, download metadata/footer and join hint on surface.
        for (const name of ['--vr-bg', '--vr-surface', '--vr-surface-2', '--vr-surface-3']) {
          check(`site page/card envelope ${name}`, color(required(values, name)).rgb);
        }
        check(
          'comparison no icon in highlighted column',
          over(
            color(property('.compare__table td.compare__ours', 'background')),
            color(required(values, '--vr-bg')).rgb
          )
        );
        check(
          'selected download tab small text',
          color(property('.download__input:checked + .download__tab', 'background')).rgb,
          color(property('.download__input:checked + .download__tab small', 'color')).rgb
        );
        check(
          'site footer text on actual mixed background',
          color(required(values, '--site-footer-bg')).rgb,
          color(property('.site-footer__about', 'color')).rgb
        );
        console.info(`${path} ${theme}: minimum ${minimum.toFixed(3)}:1`);
        return;
      }
      for (const name of surfaces) {
        const background = color(required(values, name)).rgb;
        check(name, background);
        for (const overlay of overlays) {
          // Highlighted message and soft button layers sit on the page/panel,
          // not on another hovered control or badge.
          if (overlay.includes('accent') && !['--vr-bg', '--vr-surface', '--vr-surface-2'].includes(name)) continue;
          check(`${name} + ${overlay}`, over(color(required(values, overlay)), background));
        }
        // Admin selected rows use a literal 4% white background.
        check(`${name} + selected`, over(color('rgb(255 255 255 / 0.04)'), background));
        check(
          `${name} + neutral verdict`,
          over({ ...color(required(values, '--vr-text-3')), alpha: 0.09 }, background)
        );
      }
      // A white video frame is the brightest backing for the translucent scrim.
      check(
        'primary overlay label on scrim over white video',
        over(color(required(values, '--vr-scrim')), [1, 1, 1]),
        color(required(values, '--vr-text')).rgb
      );
      console.info(`${path} ${theme}: minimum ${minimum.toFixed(3)}:1`);
    });
  }
}
