'use strict';

const WebSocket = require('ws');

function openWs(target, { cookie, path = '/api/ws' } = {}) {
  const frames = [];
  const isPort = typeof target === 'number';
  const ws = isPort
    ? new WebSocket(`ws://127.0.0.1:${target}${path}`, {
        headers: cookie ? { Cookie: cookie } : undefined
      })
    : new WebSocket(`ws+unix://${target}:${path}`, {
        headers: cookie ? { Cookie: cookie } : undefined
      });

  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WS did not deliver ready')), 5000);
    ws.on('message', (raw) => {
      const parsed = JSON.parse(String(raw));
      frames.push(parsed);
      if (parsed.type === 'ready') {
        clearTimeout(timer);
        resolve(parsed);
      }
    });
    ws.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

  return { ws, frames, ready };
}

function waitForWsType(frames, type, predicate = () => true, timeoutMs = 5000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const found = frames.find((frame) => frame.type === type && predicate(frame));
      if (found) {
        resolve(found);
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`Timed out waiting for WS message type: ${type}`));
        return;
      }
      setTimeout(check, 20);
    };
    check();
  });
}

function sendWs(ws, type, payload = {}) {
  ws.send(JSON.stringify({ type, payload }));
}

async function joinVoiceRoom(session, { roomId, peerId, sessionToken, name }) {
  sendWs(session.ws, 'room.join', { roomId, peerId, sessionToken, name });
  return waitForWsType(session.frames, 'room.snapshot', (frame) => frame.payload?.roomId === roomId);
}

async function subscribeRoomPreview(session, roomId) {
  sendWs(session.ws, 'room.preview.subscribe', { roomId });
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const found = session.frames.find(
        (frame) =>
          (frame.type === 'room.snapshot' || frame.type === 'room.not_found') && frame.payload?.roomId === roomId
      );
      if (found) {
        resolve(found);
        return;
      }
      if (Date.now() - started > 5000) {
        reject(new Error(`Timed out waiting for preview snapshot for ${roomId}`));
        return;
      }
      setTimeout(check, 20);
    };
    check();
  });
}

function countWsType(frames, type, sinceIndex = 0) {
  return frames.slice(sinceIndex).filter((frame) => frame.type === type).length;
}

module.exports = {
  openWs,
  sendWs,
  waitForWsType,
  joinVoiceRoom,
  subscribeRoomPreview,
  countWsType
};