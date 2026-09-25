import type { RoomPeerMessage } from './legacy-events.ts';
import crypto from 'node:crypto';

export type WsTransport = { id: string; kind: 'ws'; send: (message: RoomPeerMessage) => boolean; close(): void };

function createTransportId(): string {
  return crypto.randomBytes(16).toString('hex');
}

function createWsTransport(send: (message: RoomPeerMessage) => boolean): WsTransport {
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

export { createWsTransport, createTransportId };
