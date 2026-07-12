'use strict';

const crypto = require('node:crypto');

const EXACT_PUSH_HOSTS = new Set([
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com'
]);

function isAllowedPushHost(hostname) {
  return EXACT_PUSH_HOSTS.has(hostname)
    || hostname === 'notify.windows.com'
    || hostname.endsWith('.notify.windows.com');
}

function cleanPushEndpoint(value) {
  const endpoint = String(value || '').trim();
  if (!endpoint || endpoint.length > 4096) return null;

  try {
    const url = new URL(endpoint);
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== 'https:'
      || url.username
      || url.password
      || url.port
      || url.hash
      || hostname.endsWith('.')
      || !isAllowedPushHost(hostname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function describePushEndpoint(value) {
  const endpoint = String(value || '');
  let pushHost = 'invalid';
  try {
    const hostname = new URL(endpoint).hostname.toLowerCase();
    pushHost = isAllowedPushHost(hostname) ? hostname : 'rejected';
  } catch {
    // Keep invalid endpoint details out of logs.
  }
  return {
    pushHost,
    pushEndpointHash: crypto.createHash('sha256').update(endpoint).digest('hex').slice(0, 16)
  };
}

module.exports = { cleanPushEndpoint, describePushEndpoint, isAllowedPushHost };
