'use strict';

const {
  parseClientEnvelope,
  buildServerEnvelope,
  buildServerErrorEnvelope,
  validateClientCommand
} = require('@voice-room/shared/realtime');

function serializeEnvelope(envelope) {
  return JSON.stringify(envelope);
}

function sendWsEnvelope(socket, envelope) {
  if (!socket || socket.readyState !== 1) return false;
  try {
    socket.send(serializeEnvelope(envelope));
    return true;
  } catch {
    return false;
  }
}

function parseInboundMessage(raw) {
  const parsed = parseClientEnvelope(raw);
  if (!parsed.ok) return parsed;
  return validateClientCommand(parsed.envelope);
}

module.exports = {
  buildServerEnvelope,
  buildServerErrorEnvelope,
  parseInboundMessage,
  sendWsEnvelope
};