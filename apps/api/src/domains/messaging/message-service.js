'use strict';

const { createMessageVisibilityService } = require('./message-visibility-service');

function createMessageService({ directMessages, roomMessages, visibility } = {}) {
  if (!directMessages || !roomMessages) {
    throw new TypeError('Message service requires room and direct message repositories');
  }

  const visibilityPolicy = visibility || createMessageVisibilityService();

  async function withUnitOfWork(operation) {
    if (typeof operation !== 'function') throw new TypeError('Messaging unit of work must be a function');
    return operation({
      directMessages,
      roomMessages,
      visibility: visibilityPolicy
    });
  }

  return Object.freeze({
    direct: directMessages,
    room: roomMessages,
    visibility: visibilityPolicy,
    withUnitOfWork
  });
}

module.exports = { createMessageService };
