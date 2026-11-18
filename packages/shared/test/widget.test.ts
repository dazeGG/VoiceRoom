import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  defaultWidgetConfig,
  decodeWidgetConfig,
  encodeWidgetConfig,
  normalizeWidgetColor,
  parseWidgetBootstrap,
  parseWidgetConfig,
  parseWidgetMessage,
  widgetOrigin
} from '../src/contracts/widget.ts';
test('widget configuration round trips and rejects unknown properties and executable colors', () => {
  assert.deepEqual(decodeWidgetConfig(encodeWidgetConfig(defaultWidgetConfig)), defaultWidgetConfig);
  const voiceOnly = { ...defaultWidgetConfig, camera: false };
  assert.deepEqual(decodeWidgetConfig(encodeWidgetConfig(voiceOnly)), voiceOnly);
  for (const invalid of [
    { ...defaultWidgetConfig, width: 279 },
    { ...defaultWidgetConfig, version: 2 },
    { ...defaultWidgetConfig, background: 'url(https://evil.test)' },
    { ...defaultWidgetConfig, title: 'a'.repeat(81) },
    { ...defaultWidgetConfig, camera: 'false' },
    { ...defaultWidgetConfig, css: 'x' }
  ])
    assert.throws(() => parseWidgetConfig(invalid));
  assert.throws(() => decodeWidgetConfig(' '.repeat(2049)));
});
test('widget colors normalize hex and RGB into the existing six-digit contract', () => {
  assert.equal(normalizeWidgetColor(' #ABC '), '#aabbcc');
  assert.equal(normalizeWidgetColor('rgb(1, 34, 255)'), '#0122ff');
  assert.equal(normalizeWidgetColor('RGB(255 34 1)'), '#ff2201');
  assert.equal(normalizeWidgetColor('rgb(256, 34, 1)'), null);
  assert.equal(normalizeWidgetColor('#00ff0080'), null);
});
test('bootstrap requires a canonical tuple origin and unique bounded runtime fields', () => {
  const fields = new URLSearchParams({
    config: encodeWidgetConfig(defaultWidgetConfig),
    parentOrigin: 'https://game.test',
    nonce: 'ab'.repeat(24)
  });
  assert.equal(parseWidgetBootstrap(`#${fields}`).parentOrigin, 'https://game.test');
  assert.throws(() => parseWidgetBootstrap(`${fields}&nonce=${'ab'.repeat(24)}`));
  for (const origin of ['null', 'https://game.test/', 'https://game.test:443', 'http://game.test', 'data:text/html,x'])
    assert.throws(() => widgetOrigin(origin));
  assert.equal(widgetOrigin('http://localhost:5180'), 'http://localhost:5180');
});
test('messages reject unsupported versions, commands and extra data', () => {
  const message = { version: 1, nonce: 'ab'.repeat(24), type: 'ready' };
  assert.deepEqual(parseWidgetMessage(message), message);
  assert.equal(parseWidgetMessage({ ...message, type: 'enableChat' }), null);
  assert.equal(parseWidgetMessage({ ...message, version: 2 }), null);
  assert.equal(parseWidgetMessage({ ...message, token: 'secret' }), null);
  assert.deepEqual(parseWidgetMessage({ ...message, type: 'requestExpand' }), { ...message, type: 'requestExpand' });
  assert.deepEqual(parseWidgetMessage({ ...message, type: 'expandState', active: true }), {
    ...message,
    type: 'expandState',
    active: true
  });
});
