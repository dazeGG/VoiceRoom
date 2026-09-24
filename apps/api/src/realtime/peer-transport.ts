import crypto from 'node:crypto';

export type WsTransport = { id: string; kind: 'ws'; send: (payload: unknown) => unknown; close(): void };

function createTransportId(): string {
  return crypto.randomBytes(16).toString('hex');
}

function createWsTransport(send: (payload: unknown) => unknown): WsTransport {
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
