'use strict';

const {
  normalizeRoomMessageContent,
  projectRoomMessageContent
} = require('@voice-room/shared/room-message-content');

function projectStoredRoomMessage(row) {
  if (!row) return null;
  const content = normalizeRoomMessageContent(row.content);
  return {
    ...row,
    content,
    text: projectRoomMessageContent(content, row.text)
  };
}

module.exports = { projectStoredRoomMessage };
