// Operational routes: health, metrics, the room-creation proof-of-work
// challenge, the desktop release manifest and browser log intake. Response
// shapes are declared as TypeBox schemas.

import { Type, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import type { ApiContext } from '../../app/context.ts';
import { failure } from '../../platform/http/http-kit.ts';
import { LOG_EVENTS } from '../../lib/log-events.ts';
import { CLIENT_LOG_LIMITS, normalizeClientLogBatch } from '../../lib/client-log-intake.ts';
import type { DesktopReleaseService } from './desktop-release.service.ts';

interface ReadinessSnapshot {
  manifest?: { contractVersion?: string | null; schemaVersion?: number | null; digest?: string | null } | null;
  replica?: { reason?: string | null } | null;
  replicaConsensus?: boolean;
}

interface RateLimiter {
  check(key: string): { allowed: boolean; retryAfterSeconds: number };
}

export interface OpsRouteDeps {
  readiness: { getSnapshot(): ReadinessSnapshot | null | undefined };
  livekitEnabled(): boolean;
  /** Prometheus exposition text for /api/metrics (Caddy restricts who can read it). */
  renderMetrics(): string;
  pow: { prune(): void; createChallenge(ip: string, now: number): string | null };
  powDifficulty: number;
  powTtlMs: number;
  clientLogs: { enabled: boolean; limiter: RateLimiter };
  desktopRelease: DesktopReleaseService;
}

const Failure = Type.Object({ ok: Type.Literal(false), error: Type.String(), code: Type.Optional(Type.String()) });

const Health = Type.Object({
  livekit: Type.Boolean(),
  ok: Type.Literal(true),
  capabilityManifest: Type.Object({
    contractVersion: Type.Union([Type.String(), Type.Null()]),
    schemaVersion: Type.Union([Type.Number(), Type.Null()]),
    digest: Type.Union([Type.String(), Type.Null()]),
    replicaConsensus: Type.String(),
    manifestRawSha256: Type.Union([Type.String(), Type.Null()])
  })
});

const PowChallenge = Type.Union([
  Type.Object({ ok: Type.Literal(true), required: Type.Literal(false) }),
  Type.Object({
    ok: Type.Literal(true),
    algorithm: Type.Literal('sha256'),
    challenge: Type.String(),
    difficulty: Type.Number(),
    expiresAt: Type.Number(),
    required: Type.Literal(true)
  })
]);

const Asset = Type.Union([Type.Object({ url: Type.String(), size: Type.Number() }), Type.Null()]);
const DesktopRelease = Type.Object({
  ok: Type.Literal(true),
  version: Type.String(),
  htmlUrl: Type.String(),
  assets: Type.Object({ 'mac-arm64': Asset, 'mac-x64': Asset, 'win-x64': Asset })
});

const ClientLogsAccepted = Type.Object({
  ok: Type.Literal(true),
  accepted: Type.Number(),
  dropped: Type.Number(),
  limits: Type.Record(Type.String(), Type.Number())
});

export function registerOpsRoutes(root: FastifyInstance, ctx: ApiContext, deps: OpsRouteDeps): void {
  const app = root.withTypeProvider<TypeBoxTypeProvider>();

  app.get('/api/healthz', { schema: { response: { 200: Health, 503: Failure } } }, async (_request, reply) => {
    let readiness: ReadinessSnapshot | null | undefined;
    try {
      readiness = deps.readiness.getSnapshot();
    } catch {
      return reply.code(503).send(failure('Readiness snapshot unavailable', { code: 'readiness_unavailable' }));
    }
    // Public and unauthenticated: it answers "is this replica serving?" and
    // nothing about the topology behind it. The internal LiveKit address, the
    // manifest's filesystem path and live room/peer counts stay in /api/metrics.
    return {
      livekit: deps.livekitEnabled(),
      ok: true as const,
      capabilityManifest: {
        contractVersion: readiness?.manifest?.contractVersion || null,
        schemaVersion: readiness?.manifest?.schemaVersion || null,
        digest: readiness?.manifest?.digest || null,
        replicaConsensus: readiness?.replica?.reason || (readiness?.replicaConsensus ? 'agree' : 'disagree'),
        manifestRawSha256: readiness?.manifest?.digest || null
      }
    };
  });

  app.get('/api/metrics', async (_request, reply) => {
    return reply.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8').send(deps.renderMetrics());
  });

  app.get('/api/pow-challenge', { schema: { response: { 200: PowChallenge } } }, async (request) => {
    deps.pow.prune();
    if (deps.powDifficulty <= 0) return { ok: true as const, required: false as const };
    const now = Date.now();
    return {
      ok: true as const,
      algorithm: 'sha256' as const,
      // Null only without a difficulty, which returned above.
      challenge: deps.pow.createChallenge(ctx.clientIp(request.raw), now)!,
      difficulty: deps.powDifficulty,
      expiresAt: now + deps.powTtlMs,
      required: true as const
    };
  });

  app.get(
    '/api/desktop/latest',
    { schema: { response: { 200: DesktopRelease, 502: Failure } } },
    async (_request, reply) => {
      const result = await deps.desktopRelease.latest();
      if (result.status !== 'ok') return reply.code(502).send(failure('Не удалось получить данные о релизе'));
      return reply.header('Cache-Control', result.cacheControl).send({ ok: true as const, ...result.release });
    }
  );

  // Browser log intake. The room client buffers what it saw locally and posts
  // the buffer when a call fails, which is the only way a microphone, screen
  // share or reconnect failure on someone else's machine becomes visible here.
  // Records are re-emitted into the same stream as server records rather than
  // stored, so they age out with the rest of the logs and need no schema.
  app.post(
    '/api/client-logs',
    { schema: { response: { 202: ClientLogsAccepted, 404: Failure, 429: Failure } } },
    async (request, reply) => {
      if (!deps.clientLogs.enabled) return reply.code(404).send(failure('Not found'));

      const clientIp = ctx.clientIp(request.raw);
      const rate = deps.clientLogs.limiter.check(`client-logs:${clientIp}`);
      if (!rate.allowed) {
        return reply
          .code(429)
          .header('Retry-After', String(rate.retryAfterSeconds))
          .send(failure('Слишком много попыток, попробуйте позже'));
      }

      const session = await ctx.resolveSession(request.raw);
      const batch = normalizeClientLogBatch(request.body ?? {});
      if (batch.dropped > 0) {
        request.log.warn(
          { evt: LOG_EVENTS.CLIENT_REPORT_REJECTED, dropped: batch.dropped, accepted: batch.events.length },
          'client log records were rejected'
        );
      }

      // The shared fields are bound once so each record carries the identity of
      // the reporter without the client being able to claim one.
      const reporter = {
        source: 'web',
        clientSessionId: batch.sessionId || undefined,
        userId: session?.user?.id || undefined,
        ipHash: ctx.hashIp(clientIp)
      };
      for (const event of batch.events) {
        const level = event.level as 'debug' | 'info' | 'warn' | 'error';
        request.log[level](
          {
            evt: LOG_EVENTS.CLIENT_REPORT,
            ...reporter,
            ns: event.ns,
            at: event.at,
            stale: event.stale || undefined,
            ctx: event.ctx
          },
          event.msg
        );
      }

      return reply.code(202).send({
        ok: true as const,
        accepted: batch.events.length,
        dropped: batch.dropped,
        limits: { ...CLIENT_LOG_LIMITS }
      });
    }
  );
}
