'use strict';

function requireMethod(store, name) {
  if (!store || typeof store[name] !== 'function') {
    throw new TypeError(`Room message store must implement ${name}()`);
  }
  return store[name].bind(store);
}

function createRoomMessageRepository({ store } = {}) {
  if (!store) throw new TypeError('Room message repository requires a store');
  const delegate = (name) => (...args) => requireMethod(store, name)(...args);

  return Object.freeze({
    appendMessage: delegate('appendMessage'),
    editMessage: delegate('editMessage'),
    getMessage: delegate('getMessage'),
    listMessages: delegate('listMessages'),
    markRoomChatRead: delegate('markRoomChatRead'),
    softDeleteMessage: delegate('softDeleteMessage')
  });
}

module.exports = { createRoomMessageRepository };
