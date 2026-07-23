'use strict';

function requireMethod(store, name) {
  if (!store || typeof store[name] !== 'function') {
    throw new TypeError(`Direct message store must implement ${name}()`);
  }
  return store[name].bind(store);
}

function createDirectMessageRepository({ store } = {}) {
  if (!store) throw new TypeError('Direct message repository requires a store');
  const delegate = (name) => (...args) => requireMethod(store, name)(...args);

  return Object.freeze({
    editMessage: delegate('editMessage'),
    expirePendingInvites: delegate('expirePendingInvites'),
    getMessage: delegate('getMessage'),
    listThread: delegate('listThread'),
    markRead: delegate('markRead'),
    respondInvite: delegate('respondInvite'),
    sendMessage: delegate('sendMessage'),
    softDeleteMessage: delegate('softDeleteMessage')
  });
}

module.exports = { createDirectMessageRepository };
