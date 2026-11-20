import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import type { RoomSurface } from '../domains/rooms/room-surface.policy.ts';
import type { WsHandler } from '../realtime/ws-handler.ts';

const socketPaths: Record<RoomSurface, string> = { main: '/api/ws', widget: '/api/widget/ws', meet: '/api/meet/ws' };

export function registerCallWebSocket(
  app: FastifyInstance,
  surface: RoomSurface,
  handler: WsHandler,
  allows?: (socket: WebSocket, request: FastifyRequest) => boolean
): void {
  // Wait for @fastify/websocket to install its route hook.
  app.after(() => {
    app.get(socketPaths[surface], { websocket: true }, (socket, request) => {
      if (allows && !allows(socket, request)) return;
      void handler.handleConnection(socket, request.raw);
    });
  });
}
