// A real WebSocket client for tests against a listening API: every frame the
// server sends is kept, typed by the realtime contract, and tests wait for
// the one they expect.

import net from 'node:net';
import type { IncomingMessage } from 'node:http';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import type { ClientCommands, ClientCommandType, ServerFrame } from '@voice-room/shared/contracts/realtime';

export type FrameType = ServerFrame['type'];

function parseFrame(raw: WebSocket.RawData): ServerFrame {
  const bytes = Array.isArray(raw) ? Buffer.concat(raw) : Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  return JSON.parse(bytes.toString('utf8')) as ServerFrame;
}
export type FrameOf<Type extends FrameType> = Extract<ServerFrame, { type: Type }>;

export interface WsSession {
  ws: WebSocket;
  frames: ServerFrame[];
  ready: Promise<FrameOf<'ready'>>;
}

/** Opens a socket on a TCP port or a Unix socket path; `ready` resolves on the server's ready frame. */
function openWs(
  target: number | string,
  { cookie, headers = {}, path = '/api/ws' }: { cookie?: string; headers?: Record<string, string>; path?: string } = {}
): WsSession {
  const frames: ServerFrame[] = [];
  const requestHeaders = { ...headers, ...(cookie ? { Cookie: cookie } : {}) };
  const ws =
    typeof target === 'number'
      ? new WebSocket(`ws://127.0.0.1:${target}${path}`, { headers: requestHeaders })
      : new WebSocket(`ws://localhost${path}`, {
          createConnection: () => net.createConnection(target),
          headers: requestHeaders
        });

  const ready = new Promise<FrameOf<'ready'>>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WS did not deliver ready')), 5000);
    ws.on('message', (raw: WebSocket.RawData) => {
      const frame = parseFrame(raw);
      frames.push(frame);
      if (frame.type === 'ready') {
        clearTimeout(timer);
        resolve(frame);
      }
    });
    ws.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

  return { ws, frames, ready };
}

function waitForWsType<Type extends FrameType>(
  frames: ServerFrame[],
  type: Type,
  predicate: (frame: FrameOf<Type>) => boolean = () => true,
  timeoutMs = 5000,
  sinceIndex = 0
): Promise<FrameOf<Type>> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const found = frames
        .slice(sinceIndex)
        .find((frame): frame is FrameOf<Type> => frame.type === type && predicate(frame as FrameOf<Type>));
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

/** Sends one well-formed command. */
function sendWs<Type extends ClientCommandType>(ws: WebSocket, type: Type, payload: ClientCommands[Type]): void {
  ws.send(JSON.stringify({ type, payload }));
}

/** Sends a frame as given, for tests of what the server does with a bad one. */
function sendRawWs(ws: WebSocket, frame: unknown): void {
  ws.send(typeof frame === 'string' ? frame : JSON.stringify(frame));
}

function joinVoiceRoom(session: Pick<WsSession, 'ws' | 'frames'>, join: ClientCommands['room.join']) {
  sendWs(session.ws, 'room.join', join);
  return waitForWsType(session.frames, 'room.snapshot', (frame) => frame.payload.roomId === join.roomId);
}

/** Subscribes to a room preview and resolves with its snapshot, or room.not_found. */
function subscribeRoomPreview(
  session: Pick<WsSession, 'ws' | 'frames'>,
  roomId: string
): Promise<FrameOf<'room.snapshot'> | FrameOf<'room.not_found'>> {
  sendWs(session.ws, 'room.preview.subscribe', { roomId });
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const found = session.frames.find(
        (frame): frame is FrameOf<'room.snapshot'> | FrameOf<'room.not_found'> =>
          (frame.type === 'room.snapshot' || frame.type === 'room.not_found') && frame.payload.roomId === roomId
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

/**
 * A socket to an in-process app (Fastify injectWS, no listening server),
 * signed in with `cookie`; resolves once the server's ready frame arrived.
 */
async function injectWs(
  app: FastifyInstance,
  { cookie, remoteAddress = '127.0.0.1' }: { cookie?: string; remoteAddress?: string } = {}
): Promise<Pick<WsSession, 'ws' | 'frames'>> {
  const frames: ServerFrame[] = [];
  const ws = await app.injectWS(
    '/api/ws',
    // injectWS reads only the address from the socket it is handed.
    { headers: cookie ? { cookie } : {}, socket: { remoteAddress } as IncomingMessage['socket'] },
    {
      onInit(socket: WebSocket) {
        socket.on('message', (raw: WebSocket.RawData) => frames.push(parseFrame(raw)));
      }
    }
  );
  await waitForWsType(frames, 'ready', () => true, 1000);
  return { ws, frames };
}

/** Resolves with the close code once the server closes the socket. */
function waitForClose(ws: WebSocket, timeoutMs = 5000): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Socket was not closed')), timeoutMs);
    ws.on('close', (code: number) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

function countWsType(frames: ServerFrame[], type: FrameType, sinceIndex = 0): number {
  return frames.slice(sinceIndex).filter((frame) => frame.type === type).length;
}

export {
  openWs,
  injectWs,
  waitForClose,
  sendWs,
  sendRawWs,
  waitForWsType,
  joinVoiceRoom,
  subscribeRoomPreview,
  countWsType
};
