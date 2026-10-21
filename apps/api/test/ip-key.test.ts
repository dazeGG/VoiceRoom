// The key stored instead of an IP address: one address gives one key, a key is
// not the address, another secret gives other keys, and an IPv6 address is
// keyed by its /64 network however it is written.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createIpKey, storedIpKey } from '../src/lib/ip-key.ts';

const ipKey = createIpKey('a-server-secret-of-some-length');

test('one address gives one stable key that does not contain the address', () => {
  const key = ipKey('203.0.113.7');
  assert.match(key ?? '', /^[0-9a-f]{16}$/);
  assert.equal(ipKey('203.0.113.7'), key);
  assert.notEqual(ipKey('203.0.113.8'), key);
  assert.equal(ipKey(' 203.0.113.7 '), key, 'surrounding spaces do not change the key');
  assert.equal(ipKey('::ffff:203.0.113.7'), key, 'an IPv4 address mapped into IPv6 is the same address');
  assert.equal((key ?? '').includes('203'), false);
});

test('another secret gives another key', () => {
  assert.notEqual(createIpKey('another-secret')('203.0.113.7'), ipKey('203.0.113.7'));
});

test('an IPv6 address is keyed by its /64 network, however it is written', () => {
  const home = ipKey('2001:db8:85a3:42::1');
  assert.equal(ipKey('2001:db8:85a3:42:abcd:1234:5678:9abc'), home, 'a rotated interface id is the same network');
  assert.equal(ipKey('2001:0DB8:85A3:0042:0000:0000:0000:0001'), home, 'leading zeros and case do not matter');
  assert.equal(ipKey('2001:db8:85a3:42:0:0:192.0.2.1'), home, 'a dotted tail is part of the interface id');
  assert.equal(ipKey('fe80::1%eth0'), ipKey('fe80::2'), 'a zone does not change the network');
  assert.notEqual(ipKey('2001:db8:85a3:43::1'), home);
});

test('anything that is not an address has no key', () => {
  for (const value of ['', 'unknown', '999.1.1.1', '2001:db8::zz']) assert.equal(ipKey(value), null, value);
});

test('the stored form keys an address once, keeps a key and drops anything else', () => {
  const key = ipKey('203.0.113.7') ?? '';
  assert.equal(storedIpKey(ipKey, '203.0.113.7'), key);
  assert.equal(storedIpKey(ipKey, key), key, 'keying a key changes nothing');
  assert.equal(storedIpKey(ipKey, '2001:db8:85a3:42::1'), ipKey('2001:db8:85a3:42::9'));
  for (const value of ['', 'unknown', 'ABCDEF0123456789', null, 42]) assert.equal(storedIpKey(ipKey, value), '');
});
