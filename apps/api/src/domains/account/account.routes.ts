// /api/auth/*: registration, sign-in, sign-out and recovery (the routes that
// set or clear the session cookie), and the signed-in account's own settings:
// profile, password, recovery codes, devices, sign-in alerts, notices and
// deletion. Texts are the ones the web client shows.

import { Type, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { cleanDisplayName, normalizeLogin } from '@voice-room/shared/validation';
import type { ApiContext, ResolvedSession, SessionRecord, SessionUser } from '../../app/context.ts';
import { selfUser } from '../../lib/user-store.ts';
import { failure, optionalJsonBody } from '../../platform/http/http-kit.ts';
import type { AccountService, Device, OpenedSession } from './account.service.ts';

// Account payloads (self user, sessions, alerts, previews) are shaped by the
// stores; the schemas frame the envelope and keep every field.
const Scheduled = Type.Optional(Type.Number());
const Answer = Type.Object(
  { ok: Type.Literal(true), deletionScheduledFor: Scheduled },
  { additionalProperties: Type.Unknown() }
);
const Refusal = Type.Object({
  ok: Type.Literal(false),
  error: Type.String(),
  code: Type.Optional(Type.String()),
  deletionScheduledFor: Scheduled
});
const Responses = { 200: Answer, 201: Answer, '4xx': Refusal, 503: Refusal };
const Field = Type.Optional(Type.Unknown());

const SIGN_IN_REQUIRED = failure('Требуется вход');
const TOO_MANY_ATTEMPTS = failure('Слишком много попыток, попробуйте позже');
const ACCOUNT_NOT_FOUND = failure('Аккаунт не найден');
const SHORT_PASSWORD = failure('Пароль должен быть не короче 8 символов');
const WRONG_CREDENTIALS = failure('Неверный логин или пароль');
const WRONG_PASSWORD = failure('Неверный пароль');
const DELETION_UNAVAILABLE = failure('Удаление аккаунта сейчас недоступно');

export interface AccountRoutesDeps {
  account: AccountService;
  limiter: { check(key: string): { allowed: boolean; retryAfterSeconds?: number } };
  /** The session cookie that signs a browser in for the session's lifetime. */
  sessionCookie(token: string): string;
  clearedSessionCookie(): string;
  sessionToken(req: FastifyRequest['raw']): string;
  device(req: FastifyRequest['raw']): Promise<Device>;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

type SignedIn = { user: SessionUser; session: SessionRecord };

export function registerAccountRoutes(root: FastifyInstance, ctx: ApiContext, deps: AccountRoutesDeps): void {
  const app = root.withTypeProvider<TypeBoxTypeProvider>();
  const { account } = deps;

  function tooMany(reply: FastifyReply, retryAfterSeconds: number | undefined) {
    return reply.code(429).header('Retry-After', String(retryAfterSeconds)).send(TOO_MANY_ATTEMPTS);
  }

  /** Checks a rate limit bucket; answers 429 itself and returns false when spent. */
  function withinLimit(reply: FastifyReply, key: string): boolean {
    const rate = deps.limiter.check(key);
    if (!rate.allowed) tooMany(reply, rate.retryAfterSeconds);
    return rate.allowed;
  }

  async function signedIn(request: FastifyRequest, reply: FastifyReply): Promise<SignedIn | null> {
    const resolved: ResolvedSession | null = await ctx.resolveSession(request.raw);
    if (resolved?.user && resolved.session) return { user: resolved.user, session: resolved.session };
    reply.code(401).send(SIGN_IN_REQUIRED);
    return null;
  }

  function openSession(
    reply: FastifyReply,
    status: 200 | 201,
    opened: OpenedSession,
    extra: Record<string, unknown> = {}
  ) {
    return reply
      .code(status)
      .header('Set-Cookie', deps.sessionCookie(opened.token))
      .send({ ok: true as const, user: opened.user, ...extra });
  }

  const device = (request: FastifyRequest) => () => deps.device(request.raw);

  // --- sign-in and recovery ---------------------------------------------------

  app.post(
    '/api/auth/register',
    {
      preValidation: optionalJsonBody,
      schema: {
        body: Type.Object({ login: Field, displayName: Field, password: Field, passwordConfirm: Field }),
        response: Responses
      }
    },
    async (request, reply) => {
      if (!withinLimit(reply, `register:${ctx.clientIp(request.raw)}`)) return reply;
      const { body } = request;
      const password = text(body.password);
      const result = await account.register({
        login: normalizeLogin(body.login),
        displayName: cleanDisplayName(body.displayName),
        password,
        passwordConfirm: typeof body.passwordConfirm === 'string' ? body.passwordConfirm : password,
        device: device(request)
      });
      switch (result.status) {
        case 'invalid_login':
          return reply.code(400).send(failure('Логин: 3–32 символа, латиница, цифры, . _ -'));
        case 'invalid_password':
          return reply.code(400).send(SHORT_PASSWORD);
        case 'password_mismatch':
          return reply.code(400).send(failure('Пароли не совпадают'));
        case 'login_taken':
          return reply.code(409).send(failure('Этот логин уже занят'));
        case 'signed_in':
          return openSession(reply, 201, result);
      }
    }
  );

  app.post(
    '/api/auth/login',
    {
      preValidation: optionalJsonBody,
      schema: { body: Type.Object({ login: Field, password: Field }), response: Responses }
    },
    async (request, reply) => {
      if (!withinLimit(reply, `login:${ctx.clientIp(request.raw)}`)) return reply;
      const result = await account.login({
        login: normalizeLogin(request.body.login),
        password: text(request.body.password),
        device: device(request)
      });
      switch (result.status) {
        case 'invalid_credentials':
          return reply.code(401).send(WRONG_CREDENTIALS);
        case 'throttled':
          return tooMany(reply, result.retryAfterSeconds);
        case 'deletion_pending':
          return reply.code(409).send({
            ...failure('Аккаунт ожидает удаления', { code: 'account_deletion_pending' }),
            deletionScheduledFor: result.deletionScheduledFor
          });
        case 'signed_in':
          return openSession(reply, 200, result);
      }
    }
  );

  app.post('/api/auth/logout', { schema: { response: Responses } }, async (request, reply) => {
    await account.logout(deps.sessionToken(request.raw));
    return reply.header('Set-Cookie', deps.clearedSessionCookie()).send({ ok: true as const });
  });

  app.get('/api/auth/me', { schema: { response: Responses } }, async (request) => {
    const resolved = await ctx.resolveSession(request.raw);
    return { ok: true as const, user: resolved ? selfUser(resolved.user) : null };
  });

  app.post(
    '/api/auth/recover',
    {
      preValidation: optionalJsonBody,
      schema: { body: Type.Object({ login: Field, code: Field, newPassword: Field }), response: Responses }
    },
    async (request, reply) => {
      const ipRate = deps.limiter.check(`recover:${ctx.clientIp(request.raw)}`);
      if (!ipRate.allowed) return tooMany(reply, ipRate.retryAfterSeconds);
      const login: string = normalizeLogin(request.body.login);
      // Keyed on the login too, so spreading guesses across addresses does not help.
      if (login && !withinLimit(reply, `recover-login:${login}`)) return reply;
      const result = await account.recover({
        login,
        code: request.body.code,
        newPassword: text(request.body.newPassword),
        device: device(request)
      });
      if (result.status === 'invalid_new_password') return reply.code(400).send(SHORT_PASSWORD);
      if (result.status === 'invalid_code')
        return reply.code(401).send(failure('Неверный логин или код восстановления'));
      return openSession(reply, 200, result, { recoveryCodes: { remaining: result.remaining } });
    }
  );

  app.post(
    '/api/auth/account/restore',
    {
      preValidation: optionalJsonBody,
      schema: { body: Type.Object({ login: Field, password: Field }), response: Responses }
    },
    async (request, reply) => {
      if (!account.deletionAvailable()) return reply.code(503).send(DELETION_UNAVAILABLE);
      if (!withinLimit(reply, `restore:${ctx.clientIp(request.raw)}`)) return reply;
      const result = await account.restore(
        { login: normalizeLogin(request.body.login), password: text(request.body.password), device: device(request) },
        request.log
      );
      if (result.status === 'expired') return reply.code(410).send(failure('Аккаунт уже удалён'));
      if (result.status === 'invalid_credentials') return reply.code(401).send(WRONG_CREDENTIALS);
      return openSession(reply, 200, result);
    }
  );

  // --- the signed-in account ------------------------------------------------------

  app.post(
    '/api/auth/profile',
    {
      preValidation: optionalJsonBody,
      schema: { body: Type.Object({ displayName: Field }), response: Responses }
    },
    async (request, reply) => {
      const me = await signedIn(request, reply);
      if (!me) return reply;
      const result = await account.updateProfile(me.user.id, cleanDisplayName(request.body.displayName), request.log);
      if (result.status === 'not_found') return reply.code(404).send(ACCOUNT_NOT_FOUND);
      return { ok: true as const, user: result.user };
    }
  );

  app.post(
    '/api/auth/password',
    {
      preValidation: optionalJsonBody,
      schema: { body: Type.Object({ currentPassword: Field, newPassword: Field }), response: Responses }
    },
    async (request, reply) => {
      const me = await signedIn(request, reply);
      if (!me) return reply;
      // Throttled on the account so a hijacked session cannot brute-force the
      // current password, the only secret guarding the rotation.
      if (!withinLimit(reply, `password:${me.user.id}`)) return reply;
      const result = await account.changePassword(
        me.user.id,
        text(request.body.currentPassword),
        text(request.body.newPassword)
      );
      switch (result.status) {
        case 'invalid_new_password':
          return reply.code(400).send(SHORT_PASSWORD);
        case 'not_found':
          return reply.code(404).send(ACCOUNT_NOT_FOUND);
        case 'invalid_password':
          return reply.code(400).send(failure('Неверный текущий пароль'));
        case 'changed':
          return reply.header('Set-Cookie', deps.clearedSessionCookie()).send({ ok: true as const });
      }
    }
  );

  app.get('/api/auth/security', { schema: { response: Responses } }, async (request, reply) => {
    const me = await signedIn(request, reply);
    if (!me) return reply;
    return { ok: true as const, ...(await account.security(me.user.id)) };
  });

  app.post(
    '/api/auth/recovery-codes',
    {
      preValidation: optionalJsonBody,
      schema: { body: Type.Object({ currentPassword: Field }), response: Responses }
    },
    async (request, reply) => {
      const me = await signedIn(request, reply);
      if (!me) return reply;
      // The password is the only secret guarding this, exactly as for a password change.
      if (!withinLimit(reply, `recovery-codes:${me.user.id}`)) return reply;
      const result = await account.generateRecoveryCodes(me.user.id, text(request.body.currentPassword));
      if (result.status === 'not_found') return reply.code(404).send(ACCOUNT_NOT_FOUND);
      if (result.status === 'invalid_password') return reply.code(400).send(WRONG_PASSWORD);
      return { ok: true as const, codes: result.codes, recoveryCodes: result.recoveryCodes };
    }
  );

  app.post('/api/auth/recovery-codes/reminder/snooze', { schema: { response: Responses } }, async (request, reply) => {
    const me = await signedIn(request, reply);
    if (!me) return reply;
    const result = await account.snoozeRecoveryCodesReminder(me.user.id);
    if (result.status === 'not_found') return reply.code(404).send(ACCOUNT_NOT_FOUND);
    return { ok: true as const, recoveryCodesReminder: { snoozedUntil: result.snoozedUntil } };
  });

  app.get('/api/auth/sessions', { schema: { response: Responses } }, async (request, reply) => {
    const me = await signedIn(request, reply);
    if (!me) return reply;
    return { ok: true as const, sessions: await account.listSessions(me.user.id, me.session.tokenHash) };
  });

  app.post('/api/auth/sessions/revoke-others', { schema: { response: Responses } }, async (request, reply) => {
    const me = await signedIn(request, reply);
    if (!me) return reply;
    return { ok: true as const, revoked: await account.revokeOtherSessions(me.user.id, me.session.tokenHash) };
  });

  app.delete(
    '/api/auth/sessions/:sessionId',
    {
      schema: { params: Type.Object({ sessionId: Type.String() }), response: Responses }
    },
    async (request, reply) => {
      const me = await signedIn(request, reply);
      if (!me) return reply;
      const result = await account.revokeSession(me.user.id, me.session.publicId, request.params.sessionId);
      if (result.status === 'current_session')
        return reply.code(400).send(failure('Чтобы завершить этот сеанс, выйдите из аккаунта'));
      if (result.status === 'not_found') return reply.code(404).send(failure('Сеанс не найден'));
      return { ok: true as const };
    }
  );

  app.get('/api/auth/whats-new', { schema: { response: Responses } }, async (request, reply) => {
    const me = await signedIn(request, reply);
    if (!me) return reply;
    return { ok: true as const, whatsNew: await account.whatsNew(me.user.id) };
  });

  app.post('/api/auth/whats-new/seen', { schema: { response: Responses } }, async (request, reply) => {
    const me = await signedIn(request, reply);
    if (!me) return reply;
    const result = await account.markWhatsNewSeen(me.user.id);
    if (result.status === 'not_found') return reply.code(404).send(ACCOUNT_NOT_FOUND);
    return { ok: true as const, whatsNew: result.whatsNew };
  });

  app.post('/api/auth/app-prompt/seen', { schema: { response: Responses } }, async (request, reply) => {
    const me = await signedIn(request, reply);
    if (!me) return reply;
    const result = await account.markAppPromptSeen(me.user.id);
    if (result.status === 'not_found') return reply.code(404).send(ACCOUNT_NOT_FOUND);
    return { ok: true as const, appPromptSeen: true };
  });

  app.get('/api/auth/login-alerts', { schema: { response: Responses } }, async (request, reply) => {
    const me = await signedIn(request, reply);
    if (!me) return reply;
    return { ok: true as const, alerts: await account.loginAlerts(me.user.id, me.session.publicId) };
  });

  for (const resolution of ['confirm', 'deny'] as const) {
    app.post(
      `/api/auth/login-alerts/:alertId/${resolution}`,
      {
        schema: { params: Type.Object({ alertId: Type.String() }), response: Responses }
      },
      async (request, reply) => {
        const me = await signedIn(request, reply);
        if (!me) return reply;
        const params = request.params as { alertId: string };
        const result = await account.resolveLoginAlert(
          me.user.id,
          me.session.publicId,
          params.alertId,
          resolution === 'confirm' ? 'confirmed' : 'denied'
        );
        if (result.status === 'not_found')
          return reply.code(404).send(failure('Вход не найден или на него уже ответили'));
        const { status: _status, ...answer } = result;
        return { ok: true as const, ...answer };
      }
    );
  }

  app.get('/api/auth/account/deletion', { schema: { response: Responses } }, async (request, reply) => {
    const me = await signedIn(request, reply);
    if (!me) return reply;
    const result = await account.deletionPreview(me.user.id);
    if (result.status === 'unavailable') return reply.code(503).send(DELETION_UNAVAILABLE);
    return { ok: true as const, ...result.preview };
  });

  app.post(
    '/api/auth/account/deletion',
    {
      preValidation: optionalJsonBody,
      schema: { body: Type.Object({ currentPassword: Field }), response: Responses }
    },
    async (request, reply) => {
      const me = await signedIn(request, reply);
      if (!me) return reply;
      if (!account.deletionAvailable()) return reply.code(503).send(DELETION_UNAVAILABLE);
      if (!withinLimit(reply, `account-deletion:${me.user.id}`)) return reply;
      const result = await account.requestDeletion(me.user.id, text(request.body.currentPassword), request.log);
      switch (result.status) {
        case 'unavailable':
          return reply.code(503).send(DELETION_UNAVAILABLE);
        case 'invalid_password':
          return reply.code(400).send(WRONG_PASSWORD);
        case 'not_found':
          return reply.code(404).send(ACCOUNT_NOT_FOUND);
        case 'already_requested':
          return reply.code(409).send({
            ...failure('Аккаунт уже ожидает удаления', { code: 'account_deletion_pending' }),
            deletionScheduledFor: result.deletionScheduledFor
          });
        case 'scheduled':
          return reply
            .header('Set-Cookie', deps.clearedSessionCookie())
            .send({ ok: true as const, deletionScheduledFor: result.deletionScheduledFor });
      }
    }
  );
}
