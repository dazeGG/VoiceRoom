// The phone push-token body names a known provider and a bounded token; the
// client policy names the minimum Android version or null.

import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from 'typebox/value';

import { ClientPolicy } from '../src/contracts/client.ts';
import {
  DEVICE_PUSH_PROVIDERS,
  DEVICE_TOKEN_MAX_LENGTH,
  DEVICE_TOKEN_PATTERN,
  DeviceTokenBody
} from '../src/contracts/devices.ts';

test('a device token is a non-empty, bounded token from a known provider', () => {
  assert.deepEqual(DEVICE_PUSH_PROVIDERS, ['rustore']);
  assert.equal(DEVICE_TOKEN_MAX_LENGTH, 1024);
  assert.equal(Value.Check(DeviceTokenBody, { provider: 'rustore', token: 'x' }), true);
  assert.equal(Value.Check(DeviceTokenBody, { provider: 'rustore', token: 'x'.repeat(1024) }), true);

  assert.equal(Value.Check(DeviceTokenBody, { provider: 'rustore', token: '' }), false);
  assert.equal(Value.Check(DeviceTokenBody, { provider: 'rustore', token: 'x'.repeat(1025) }), false);
  assert.equal(Value.Check(DeviceTokenBody, { provider: 'fcm', token: 'x' }), false);
  assert.equal(Value.Check(DeviceTokenBody, { provider: 'rustore' }), false);
});

test('a well-formed device token is one word of printable ASCII, 1024 bytes at most', () => {
  for (const token of ['x', 'aB0-_:.~!/', '!'.repeat(1024), '~'.repeat(1024)]) {
    assert.equal(DEVICE_TOKEN_PATTERN.test(token), true, token);
  }
  for (const token of ['', 'x'.repeat(1025), 'two words', 'tab\there', 'nul\u0000', 'del\u007f', 'токен', 'émoji🙂']) {
    assert.equal(DEVICE_TOKEN_PATTERN.test(token), false, JSON.stringify(token));
  }
});

test('the client policy names the minimum Android version, or null for none', () => {
  assert.equal(Value.Check(ClientPolicy, { contractVersion: 1, android: { minVersion: '1.2.0' } }), true);
  assert.equal(Value.Check(ClientPolicy, { contractVersion: 1, android: { minVersion: null } }), true);
  assert.equal(Value.Check(ClientPolicy, { contractVersion: 2, android: { minVersion: null } }), false);
  assert.equal(Value.Check(ClientPolicy, { contractVersion: 1, android: {} }), false);
});

test('channel capabilities are optional, bounded known IDs', () => {
  const body = { provider: 'rustore', token: 'x' };
  for (const notificationChannels of [[], ['messages'], ['messages', 'mentions'], ['calls']])
    assert.equal(Value.Check(DeviceTokenBody, { ...body, notificationChannels }), true);
  for (const notificationChannels of [
    null,
    'mentions',
    ['unknown'],
    ['mentions', 'mentions'],
    ['messages', 'mentions', 'calls', 'messages']
  ])
    assert.equal(Value.Check(DeviceTokenBody, { ...body, notificationChannels }), false);
});
