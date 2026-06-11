'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readEnvInt, readEnvBool } = require('../src/lib/config');

test('readEnvInt parses a valid integer', () => {
  assert.equal(readEnvInt('PORT', 3000, 1, { PORT: '8080' }), 8080);
});

test('readEnvInt falls back when missing', () => {
  assert.equal(readEnvInt('PORT', 3000, 1, {}), 3000);
});

test('readEnvInt falls back when below min', () => {
  assert.equal(readEnvInt('PORT', 3000, 1024, { PORT: '80' }), 3000);
});

test('readEnvInt falls back on non-numeric value', () => {
  assert.equal(readEnvInt('PORT', 3000, 1, { PORT: 'abc' }), 3000);
});

test('readEnvBool reads truthy strings', () => {
  for (const value of ['1', 'true', 'TRUE', 'yes', 'on', ' true ']) {
    assert.equal(readEnvBool('TRUST_PROXY', false, { TRUST_PROXY: value }), true, value);
  }
});

test('readEnvBool reads falsey strings', () => {
  for (const value of ['0', 'false', 'no', 'off', '']) {
    assert.equal(readEnvBool('TRUST_PROXY', true, { TRUST_PROXY: value }), false, value);
  }
});

test('readEnvBool returns fallback when undefined', () => {
  assert.equal(readEnvBool('TRUST_PROXY', true, {}), true);
  assert.equal(readEnvBool('TRUST_PROXY', false, {}), false);
});
