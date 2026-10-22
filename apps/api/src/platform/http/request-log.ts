// The one "request completed" line per HTTP request. A slow or failed request
// is the one worth finding later, so it is raised above the steady info
// stream instead of only being counted in the Prometheus histogram.

import type { FastifyRequest } from 'fastify';
import type { IncomingMessage } from 'node:http';
import { LOG_EVENTS } from '../../lib/log-events.ts';
import { fieldOf } from '../record.ts';

export function requestRouteLabel(request: {
  routeOptions?: { url?: string | undefined };
  routerPath?: string;
  url?: string;
}): string {
  return request.routeOptions?.url || request.routerPath || request.url || 'unknown';
}

export function createRequestLog({
  clientIp,
  hashIp
}: {
  clientIp: (req: Pick<IncomingMessage, 'socket' | 'headers'>) => string;
  hashIp: (ip: string) => string;
}) {
  return function logHttpRequest(request: FastifyRequest, statusCode: number, durationMs: number): void {
    const route = requestRouteLabel(request);
    if (route === '/api/healthz') return;
    const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
    // A request built without its Node message (a test's) still logs.
    const raw: IncomingMessage | undefined = request.raw;
    // The session resolver marks the message with the account it signed in.
    const userId = fieldOf(raw, 'voiceRoomUserId');
    request.log?.[level]?.(
      {
        evt: LOG_EVENTS.HTTP_REQUEST,
        method: request.method,
        route,
        statusCode,
        userId: typeof userId === 'string' && userId ? userId : undefined,
        ipHash: hashIp(clientIp(raw ?? request)),
        durationMs: Math.round(durationMs * 100) / 100
      },
      'request completed'
    );
  };
}
