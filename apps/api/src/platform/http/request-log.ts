// The one "request completed" line per HTTP request. A slow or failed request
// is the one worth finding later, so it is raised above the steady info
// stream instead of only being counted in the Prometheus histogram.

import type { FastifyRequest } from 'fastify';
import type { IncomingMessage } from 'node:http';
import { LOG_EVENTS } from '../../lib/log-events.ts';

type RawRequest = IncomingMessage & { voiceRoomUserId?: string };

export function requestRouteLabel(request: {
  routeOptions?: { url?: string };
  routerPath?: string;
  url?: string;
}): string {
  return request.routeOptions?.url || request.routerPath || request.url || 'unknown';
}

export function createRequestLog({
  clientIp,
  hashIp
}: {
  clientIp(req: IncomingMessage): string;
  hashIp(ip: string): string;
}) {
  return function logHttpRequest(request: FastifyRequest, statusCode: number, durationMs: number): void {
    const route = requestRouteLabel(request as FastifyRequest & { routerPath?: string });
    if (route === '/api/healthz') return;
    const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
    const raw = request.raw as RawRequest | undefined;
    request.log?.[level]?.(
      {
        evt: LOG_EVENTS.HTTP_REQUEST,
        method: request.method,
        route,
        statusCode,
        userId: raw?.voiceRoomUserId || undefined,
        ipHash: hashIp(clientIp(raw || (request as unknown as IncomingMessage))),
        durationMs: Math.round(durationMs * 100) / 100
      },
      'request completed'
    );
  };
}
