// /api/staff/*: getting into the admin app. On the main site an account learns
// whether it is staff (access) and hands its session over (handoff). On the
// admin app's subdomain Caddy asks before serving anything (check); a browser
// without an admin session is sent to the main site and comes back with a code
// (callback), which becomes a cookie that only the subdomain ever sees. Anyone
// who is not staff ends on a plain 404 (denied).

import crypto from 'node:crypto';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Type } from 'typebox';
import { Failure } from '@voice-room/shared/contracts/http';
import { StaffAccess, StaffList, StaffMe, StaffRoleBody } from '@voice-room/shared/contracts/staff';
import type { ApiContext } from '../../app/context.ts';
import { parseCookies } from '../account/session-cookie.ts';
import { failure } from '../../platform/http/http-kit.ts';
import type { StaffActor, StaffService } from './staff.service.ts';
import type { StaffAccountRow } from './staff.repository.ts';

// Over HTTPS the names carry __Host-, which a browser keeps to this exact host:
// no sibling subdomain can plant one of its own.
const STAFF_COOKIE = 'vr_staff';
// One per handoff, so admin tabs reopened together each come back signed in.
const STATE_COOKIE = 'vr_staff_state_';
const STATE_TTL_SECONDS = 300;
const STATE_PATTERN = /^[0-9a-f-]{36}$/;

export const staffCookieName = (secure: boolean) => (secure ? `__Host-${STAFF_COOKIE}` : STAFF_COOKIE);

const SIGN_IN_REQUIRED = failure('Authentication required', { code: 'authentication_required' });
const STAFF_SESSION_REQUIRED = failure('Admin app session required', { code: 'staff_session_required' });
const STAFF_REQUIRED = failure('Platform administrator access required', { code: 'platform_admin_required' });
const ROLE_REFUSALS = {
  forbidden: [403, STAFF_REQUIRED],
  not_found: [404, failure('Account not found', { code: 'account_not_found' })],
  fixed: [409, failure('This superadmin is named in the server settings', { code: 'staff_role_fixed' })],
  self: [409, failure('You cannot change your own role', { code: 'staff_role_self' })]
} as const;

const NOT_FOUND_PAGE =
  '<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>404</title>' +
  '<meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
  '<body style="margin:0;display:grid;place-items:center;min-height:100vh;font-family:system-ui,sans-serif;' +
  'background:#16171a;color:#9a9ca3"><p>404 · Страница не найдена</p></body></html>';

export interface StaffRoutesDeps {
  staff: StaffService;
  /** The main site and the admin app as origins, e.g. https://voiceroom.ru and https://admin.voiceroom.ru. */
  siteOrigin: string;
  adminOrigin: string;
  secureCookies: boolean;
  /** How many reports wait for review. */
  openReports(): Promise<number>;
}

// Lax, not Strict: a link to the admin app from another site (a messenger, a
// mail) must arrive signed in, and Strict would withhold the cookie for the
// whole redirect chain. Writes are origin-checked (hasSessionCookie) anyway.
function cookie(name: string, value: string, maxAgeSeconds: number, secure: boolean) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  parts.push(`Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`);
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

// The admin app's own addresses use only these; browsers read a backslash as a
// slash ("/\host" is "//host"), so anything else sends the browser to the start.
const PLAIN_PATH = /^\/(?![/\\])[\w\-./~%?=&+]*$/;

/** A path on the admin app to come back to: only a plain local path is taken. */
function returnPath(value: unknown): string {
  return typeof value === 'string' && PLAIN_PATH.test(value) && !value.startsWith('/api/') ? value.slice(0, 512) : '/';
}

/** The admin-app session behind a request, as the staff service reads it. */
export function staffToken(req: Parameters<typeof parseCookies>[0], secure: boolean): string {
  return parseCookies(req)[staffCookieName(secure)] || '';
}

/** A page load, as opposed to a script, a style or an image the page asks for. */
function isPageLoad(headers: FastifyRequest['headers']): boolean {
  const mode = headers['sec-fetch-mode'];
  // Browsers without Fetch Metadata (older Safari, some webviews) still say they want HTML.
  return mode ? mode === 'navigate' : (headers.accept ?? '').includes('text/html');
}

export function registerStaffRoutes(root: FastifyInstance, ctx: ApiContext, deps: StaffRoutesDeps): void {
  const app = root.withTypeProvider<TypeBoxTypeProvider>();
  const prefix = deps.secureCookies ? '__Host-' : '';
  const staffCookie = staffCookieName(deps.secureCookies);
  const stateCookie = (state: string, value: string, maxAge: number) =>
    cookie(`${prefix}${STATE_COOKIE}${state}`, value, maxAge, deps.secureCookies);
  const tokenOf = (request: FastifyRequest) => staffToken(request.raw, deps.secureCookies);

  const refuse = createStaffActorResolver(ctx, deps.staff, deps.secureCookies);
  async function staffActor(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<(StaffActor & { account: StaffAccountRow }) | null> {
    const actor = await deps.staff.actor(tokenOf(request));
    if (!actor) await refuse(request, reply);
    return actor;
  }

  // Main site: is this account staff, and where is the admin app.
  app.get(
    '/api/staff/access',
    { schema: { response: { 200: StaffAccess, '4xx': Failure } } },
    async (request, reply) => {
      const userId = (await ctx.resolveSession(request.raw))?.user?.id;
      if (!userId) return reply.code(401).send(SIGN_IN_REQUIRED);
      const staff = Boolean(await deps.staff.role(userId));
      const openReports = (await deps.staff.can(userId, 'reports.review')) ? await deps.openReports() : 0;
      return { ok: true as const, staff, adminUrl: staff ? `${deps.adminOrigin}/` : null, openReports };
    }
  );

  // Main site: hand the signed-in session over to the admin app, or turn the browser away.
  app.get(
    '/api/staff/handoff',
    { schema: { querystring: Type.Object({ state: Type.Optional(Type.String({ maxLength: 128 })) }) } },
    async (request, reply) => {
      const resolved = await ctx.resolveSession(request.raw);
      const userId = resolved?.user?.id;
      const code = userId ? await deps.staff.handoff(userId, resolved.session?.tokenHash ?? '') : null;
      reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
      if (!code) return reply.redirect(`${deps.adminOrigin}/api/staff/denied`, 302);
      const query = new URLSearchParams({ code, state: request.query.state ?? '' });
      return reply.redirect(`${deps.adminOrigin}/api/staff/callback?${query.toString()}`, 302);
    }
  );

  // Main site: a link the desktop app opens in the system browser. That browser
  // has no site cookie, so the redirect through /api/staff/handoff would 404.
  // The code itself carries the page to open, and only a staff session gets one.
  app.get(
    '/api/staff/browser-entry',
    {
      schema: {
        querystring: Type.Object({ next: Type.Optional(Type.String({ maxLength: 512 })) }),
        response: {
          200: Type.Object({ ok: Type.Literal(true), url: Type.Union([Type.String(), Type.Null()]) }),
          '4xx': Failure
        }
      }
    },
    async (request, reply) => {
      const resolved = await ctx.resolveSession(request.raw);
      const userId = resolved?.user?.id;
      reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
      if (!userId) return reply.code(401).send(SIGN_IN_REQUIRED);
      const code = await deps.staff.handoff(userId, resolved.session?.tokenHash ?? '', returnPath(request.query.next));
      if (!code) return { ok: true as const, url: null };
      const query = new URLSearchParams({ code });
      return { ok: true as const, url: `${deps.adminOrigin}/api/staff/callback?${query.toString()}` };
    }
  );

  // Admin app, asked by Caddy (forward_auth) before anything on the subdomain is served.
  app.get('/api/staff/check', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const actor = await deps.staff.actor(tokenOf(request));
    if (actor) return reply.code(204).header('X-Staff-Role', actor.role).send();
    // Only a page load goes to the main site; a script or an image just gets the 404.
    if (!isPageLoad(request.headers)) return reply.code(404).type('text/html').send(NOT_FOUND_PAGE);
    const state = crypto.randomUUID();
    const back = returnPath(request.headers['x-forwarded-uri']);
    return reply
      .header('Set-Cookie', stateCookie(state, back, STATE_TTL_SECONDS))
      .redirect(`${deps.siteOrigin}/api/staff/handoff?${new URLSearchParams({ state }).toString()}`, 302);
  });

  // Admin app: the code from the main site becomes this subdomain's own session.
  app.get(
    '/api/staff/callback',
    {
      schema: {
        querystring: Type.Object({
          code: Type.Optional(Type.String({ maxLength: 128 })),
          state: Type.Optional(Type.String({ maxLength: 128 }))
        })
      }
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
      const state = STATE_PATTERN.test(request.query.state ?? '') ? (request.query.state ?? '') : '';
      // The state this browser was given at the check holds the page it was on.
      const back = state ? parseCookies(request.raw)[`${prefix}${STATE_COOKIE}${state}`] : undefined;
      const code = request.query.code ?? '';
      const clearState = stateCookie(state || 'none', '', 0);
      const redirected = back !== undefined ? await deps.staff.exchange(code) : null;
      // A link minted for the system browser carries its own page and needs no state cookie.
      // A redirect code is not spent by that path, so a missing state cookie can be retried.
      const entered = redirected ? null : await deps.staff.exchangeBrowserEntry(code);
      const session = redirected ? { ...redirected, returnTo: back ?? '/' } : entered;
      if (!session) return reply.header('Set-Cookie', clearState).redirect('/api/staff/denied', 302);
      return reply
        .header('Set-Cookie', [
          clearState,
          cookie(staffCookie, session.token, session.maxAgeSeconds, deps.secureCookies)
        ])
        .redirect(returnPath(session.returnTo), 302);
    }
  );

  app.get('/api/staff/denied', async (_request, reply) =>
    reply.code(404).header('Cache-Control', 'no-store').type('text/html').send(NOT_FOUND_PAGE)
  );

  app.get('/api/staff/me', { schema: { response: { 200: StaffMe, '4xx': Failure } } }, async (request, reply) => {
    const actor = await staffActor(request, reply);
    if (!actor) return reply;
    return { ok: true as const, ...deps.staff.me(actor) };
  });

  app.post('/api/staff/logout', async (request, reply) => {
    await deps.staff.signOut(tokenOf(request));
    return reply.header('Set-Cookie', cookie(staffCookie, '', 0, deps.secureCookies)).send({ ok: true as const });
  });

  app.get(
    '/api/staff/members',
    { schema: { response: { 200: StaffList, '4xx': Failure } } },
    async (request, reply) => {
      const actor = await staffActor(request, reply);
      if (!actor) return reply;
      const list = await deps.staff.list(actor);
      if (!list) return reply.code(403).send(STAFF_REQUIRED);
      return { ok: true as const, ...list };
    }
  );

  app.put(
    '/api/staff/role',
    { schema: { body: StaffRoleBody, response: { 200: Type.Object({ ok: Type.Literal(true) }), '4xx': Failure } } },
    async (request, reply) => {
      const actor = await staffActor(request, reply);
      if (!actor) return reply;
      const result = await deps.staff.setRole(actor, request.body.login, request.body.role);
      if (result.status !== 'done') {
        const [status, body] = ROLE_REFUSALS[result.status];
        return reply.code(status).send(body);
      }
      return { ok: true as const };
    }
  );
}

/**
 * For admin endpoints: the staff member behind the admin-app session. Without
 * one, a signed-in account that is not staff gets 403, and anyone else 401
 * staff_session_required, which sends the admin app through the handoff. The
 * main-site cookie never reaches the admin subdomain, so there an expired or
 * signed-out admin session always gets the 401.
 */
export function createStaffActorResolver(
  ctx: ApiContext,
  staff: Pick<StaffService, 'actor' | 'role'>,
  secureCookies: boolean
) {
  return async function staffUserId(request: FastifyRequest, reply: FastifyReply): Promise<string | null> {
    const actor = await staff.actor(staffToken(request.raw, secureCookies));
    if (actor) return actor.userId;
    const userId = (await ctx.resolveSession(request.raw))?.user?.id;
    if (userId && !(await staff.role(userId))) reply.code(403).send(STAFF_REQUIRED);
    else reply.code(401).send(STAFF_SESSION_REQUIRED);
    return null;
  };
}
