'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getClientIp, createRateLimiter } = require('../lib/rate-limit');

function fakeReq({ remoteAddress = '10.0.0.1', forwardedFor } = {}) {
  const headers = {};
  if (forwardedFor !== undefined) headers['x-forwarded-for'] = forwardedFor;
  return { headers, socket: { remoteAddress } };
}

test('getClientIp uses socket address when proxy is not trusted', () => {
  const req = fakeReq({ remoteAddress: '10.0.0.1', forwardedFor: '1.2.3.4' });
  assert.equal(getClientIp(req, false), '10.0.0.1');
});

test('getClientIp ignores a spoofed X-Forwarded-For when proxy is not trusted', () => {
  const req = fakeReq({ remoteAddress: '10.0.0.1', forwardedFor: 'evil, 9.9.9.9' });
  assert.equal(getClientIp(req, false), '10.0.0.1');
});

test('getClientIp uses the last forwarded hop when proxy is trusted', () => {
  const req = fakeReq({ remoteAddress: '10.0.0.1', forwardedFor: '1.2.3.4, 5.6.7.8' });
  assert.equal(getClientIp(req, true), '5.6.7.8');
});

test('getClientIp falls back to socket address when trusted but no header', () => {
  const req = fakeReq({ remoteAddress: '10.0.0.1' });
  assert.equal(getClientIp(req, true), '10.0.0.1');
});

test('rate limiter allows requests under the limit', () => {
  const limiter = createRateLimiter({ limit: 3, windowMs: 60000 });
  const now = 1000;
  assert.equal(limiter.check('ip', now).allowed, true);
  assert.equal(limiter.check('ip', now).allowed, true);
  assert.equal(limiter.check('ip', now).allowed, true);
});

test('rate limiter blocks once the limit is exceeded', () => {
  const limiter = createRateLimiter({ limit: 2, windowMs: 60000 });
  const now = 1000;
  limiter.check('ip', now);
  limiter.check('ip', now);
  const blocked = limiter.check('ip', now);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds > 0);
});

test('rate limiter resets after the window elapses', () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 60000 });
  assert.equal(limiter.check('ip', 1000).allowed, true);
  assert.equal(limiter.check('ip', 1000).allowed, false);
  assert.equal(limiter.check('ip', 1000 + 60001).allowed, true);
});

test('rate limiter keys are independent per client', () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 60000 });
  assert.equal(limiter.check('a', 1000).allowed, true);
  assert.equal(limiter.check('b', 1000).allowed, true);
  assert.equal(limiter.check('a', 1000).allowed, false);
});

test('rate limiter is disabled when limit <= 0', () => {
  const limiter = createRateLimiter({ limit: 0, windowMs: 60000 });
  for (let i = 0; i < 100; i += 1) {
    assert.equal(limiter.check('ip', 1000).allowed, true);
  }
});
