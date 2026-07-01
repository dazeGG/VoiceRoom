'use strict';

const crypto = require('node:crypto');

function createTransportId() {
  return crypto.randomBytes(16).toString('hex');
}

function createWsTransport(send) {
  const id = createTransportId();
  return {
    id,
    kind: 'ws',
    send,
    close() {
      // WS lifecycle is owned by the connection registry.
    }
  };
}

module.exports = {
  createWsTransport,
  createTransportId
};