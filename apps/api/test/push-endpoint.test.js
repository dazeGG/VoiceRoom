'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanPushEndpoint, describePushEndpoint } = require('../src/lib/push-endpoint');

test('push endpoints accept only known browser push services', () => {
  for (const endpoint of [
    'https://fcm.googleapis.com/fcm/send/device-token',
    'https://updates.push.services.mozilla.com/wpush/v2/device-token',
    'https://web.push.apple.com/QWxhZGRpbjpvcGVuIHNlc2FtZQ',
    'https://db3.notify.windows.com/w/?token=device-token'
  ]) assert.equal(cleanPushEndpoint(endpoint), endpoint);
});

test('push endpoints reject SSRF and URL parser bypasses', () => {
  for (const endpoint of [
    'http://fcm.googleapis.com/fcm/send/token',
    'https://127.0.0.1/push',
    'https://[::1]/push',
    'https://localhost/push',
    'https://fcm.googleapis.com.evil.example/push',
    'https://evil.example/?next=fcm.googleapis.com',
    'https://user:password@fcm.googleapis.com/push',
    'https://fcm.googleapis.com:444/push',
    'https://fcm.googleapis.com./push',
    'https://fcm.googleapis.com/push#fragment'
  ]) assert.equal(cleanPushEndpoint(endpoint), null, endpoint);
});

test('push endpoint log descriptors never contain capability URLs', () => {
  const endpoint = 'https://fcm.googleapis.com/fcm/send/secret-capability-token';
  const descriptor = describePushEndpoint(endpoint);
  assert.equal(descriptor.pushHost, 'fcm.googleapis.com');
  assert.match(descriptor.pushEndpointHash, /^[a-f0-9]{16}$/);
  assert.doesNotMatch(JSON.stringify(descriptor), /secret-capability-token/);
  assert.equal(describePushEndpoint('https://internal.example/secret').pushHost, 'rejected');
});
