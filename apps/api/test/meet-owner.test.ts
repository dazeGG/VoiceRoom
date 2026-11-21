import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempDisposable } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { MeetOwnerAuthorization, MeetRoomCreated, MeetRoomStatus } from '@voiceroom/shared/contracts/rooms';
import fastify from 'fastify';
import { createOwnerCapability } from '../src/domains/rooms/meet-owner.service.ts';
import { registerMeetRoomRoutes } from '../src/domains/rooms/meet.routes.ts';
import type { LiveRoom } from '../src/domains/rooms/room-views.ts';
import { createRoomCreation, type RoomsStore } from '../src/domains/rooms/rooms.service.ts';
import { createRateLimiter } from '../src/lib/rate-limit.ts';
import { AJV_OPTIONS, registerHttpKit } from '../src/platform/http/http-kit.ts';
import { checked } from './helpers/checked.ts';

const origin = 'https://meet.example.test';
const script = fileURLToPath(new URL('../src/scripts/owner-link.ts', import.meta.url));

function linkToken(link: string | null): string {
  assert.ok(link);
  const url = new URL(link);
  assert.equal(url.origin, origin);
  assert.equal(url.search, '');
  const token = new URLSearchParams(url.hash.slice(1)).get('owner');
  assert.ok(token);
  return token;
}

test('a persisted owner link can be exchanged only once across concurrent calls and process restarts', async () => {
  await using directory = await mkdtempDisposable(join(tmpdir(), 'vr-owner-'));
  const file = join(directory.path, 'secret');
  const owner = createOwnerCapability(file);
  const another = createOwnerCapability(file);
  const links = await Promise.all([
    owner.printLink({ origin, rotate: false }),
    another.printLink({ origin, rotate: false })
  ]);
  assert.equal(links[0], links[1]);
  const token = linkToken(links[0]);
  assert.equal(await owner.canCreate(token), false);
  assert.equal(await owner.exchangeLink('A'.repeat(43)), null);

  const claims = await Promise.all([owner.exchangeLink(token), another.exchangeLink(token)]);
  assert.equal(claims.filter(Boolean).length, 1);
  const createToken = claims.find(Boolean);
  assert.ok(createToken);
  const restarted = createOwnerCapability(file);
  assert.equal(await restarted.exchangeLink(token), null);
  assert.equal(await restarted.printLink({ origin, rotate: false }), null);
  assert.equal(await restarted.canCreate(createToken), true);
  assert.equal(await restarted.exchangeLink(createToken), null);
});

test('owner CLI rotation invalidates earlier link and grant without restarting the API', async () => {
  await using directory = await mkdtempDisposable(join(tmpdir(), 'vr-owner-'));
  const file = join(directory.path, 'secret');
  const env = { ...process.env, PERSONAL_ORIGIN: origin, PERSONAL_OWNER_FILE: file };
  const cli = (...args: string[]) => spawnSync(process.execPath, [script, ...args], { env, encoding: 'utf8' });
  const first = cli();
  assert.equal(first.status, 0);
  assert.equal(first.stderr, '');
  const owner = createOwnerCapability(file);
  const oldLink = linkToken(first.stdout.trim());
  assert.equal(cli().stdout, first.stdout);
  const grant = await owner.exchangeLink(oldLink);
  assert.ok(grant);
  assert.equal(await owner.canCreate(grant), true);
  const used = cli();
  assert.equal(used.status, 1);
  assert.equal(used.stdout, '');
  const rotated = cli('--rotate');
  assert.equal(rotated.status, 0);
  assert.equal(rotated.stderr, '');
  assert.equal(await owner.canCreate(grant), false);
  assert.equal(await owner.exchangeLink(oldLink), null);
  const freshLink = linkToken(rotated.stdout.trim());
  assert.notEqual(freshLink, oldLink);
  const freshGrant = await owner.exchangeLink(freshLink);
  assert.ok(freshGrant);
  assert.equal(await owner.canCreate(freshGrant), true);
});

test('Meet creation requires an unexpired bearer grant before rate checks and quota, while status is guest-only', async (t) => {
  await using directory = await mkdtempDisposable(join(tmpdir(), 'vr-owner-'));
  let clock = 1000;
  const owner = createOwnerCapability(join(directory.path, 'secret'), () => clock);
  const token = linkToken(await owner.printLink({ origin, rotate: false }));
  const app = fastify({ ajv: AJV_OPTIONS });
  t.after(() => app.close());
  registerHttpKit(app, { securityHeaders: () => ({}), recordRequest() {}, logRequest() {}, logHandlerFailure() {} });
  const stored = new Map<string, LiveRoom>();
  const ordinary: LiveRoom = {
    id: 'ordinary',
    kind: 'main',
    createdAt: 0,
    updatedAt: 0,
    name: '',
    isStatic: false,
    peers: new Map()
  };
  stored.set(ordinary.id, ordinary);
  const quotaRequests: Parameters<RoomsStore['createRoomWithQuota']>[0][] = [];
  const rate = createRateLimiter({ limit: 1, windowMs: 60_000 });
  registerMeetRoomRoutes(app, {
    owner,
    origin,
    createLimiter: rate,
    maxRoomPeers: 8,
    getRoom: async (roomId) => stored.get(roomId) ?? null,
    createRoom: createRoomCreation({
      store: () => ({
        async getRoom(roomId) {
          return stored.get(roomId) ?? null;
        },
        async createRoomWithQuota(input) {
          quotaRequests.push(input);
          const room: LiveRoom = {
            id: input.roomId,
            kind: input.kind ?? 'main',
            createdAt: clock,
            updatedAt: clock,
            isStatic: input.isStatic,
            ownerId: input.ownerId,
            name: input.name,
            peers: new Map([['p', { id: 'p', name: 'In memory' }]])
          };
          stored.set(room.id, room);
          return { status: 'created', room };
        }
      }),
      limits: { maxRooms: 20, maxOwnedStaticRoomsPerUser: 0, maxTempRoomsPerIp: 20 },
      newRoomId: () => 'meeting'
    })
  });

  const url = '/api/meet/rooms';
  const cookie = `vr_session=${token}`;
  const cookieOnly = await app.inject({ method: 'POST', url, headers: { cookie } });
  const rawLink = await app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${token}` } });
  assert.equal(cookieOnly.statusCode, 401);
  assert.equal(rawLink.statusCode, 401);
  assert.equal(quotaRequests.length, 0);

  const exchange = await app.inject({ method: 'POST', url: '/api/meet/owner/exchange', payload: { token } });
  assert.equal(exchange.statusCode, 200);
  assert.equal(exchange.headers['cache-control'], 'no-store');
  assert.equal(exchange.headers['set-cookie'], undefined);
  const grant = checked(MeetOwnerAuthorization, exchange.json()).token;
  const headers = { authorization: `Bearer ${grant}` };
  const created = await app.inject({
    method: 'POST',
    url,
    headers,
    payload: { isStatic: true, ownerId: 'account', kind: 'widget', name: 'Do not store' }
  });
  assert.equal(created.statusCode, 201);
  assert.deepEqual(checked(MeetRoomCreated, created.json()), {
    ok: true,
    roomId: 'meeting',
    joinUrl: `${origin}/room/meeting`
  });
  assert.deepEqual(quotaRequests, [
    {
      kind: 'meet',
      creatorIp: '',
      isStatic: false,
      ownerId: null,
      name: '',
      maxOwnedStaticRoomsPerUser: 0,
      maxRooms: 20,
      maxTempRoomsPerIp: 20,
      roomId: 'meeting'
    }
  ]);

  const deniedByRate = await app.inject({ method: 'POST', url, headers });
  assert.equal(deniedByRate.statusCode, 429);
  assert.ok(deniedByRate.headers['retry-after']);
  clock += 5 * 60_000;
  const expired = await app.inject({ method: 'POST', url, headers });
  assert.equal(expired.statusCode, 401);
  assert.equal(quotaRequests.length, 1);

  const status = await app.inject({ method: 'GET', url: `${url}/meeting/status`, headers: { cookie } });
  assert.equal(status.statusCode, 200);
  assert.deepEqual(checked(MeetRoomStatus, status.json()), {
    ok: true,
    roomId: 'meeting',
    capabilities: { screenShare: true, camera: true, chat: 'ephemeral', maxPeers: 8 },
    peers: 1
  });
  const otherSurface = await app.inject({ method: 'GET', url: `${url}/ordinary/status`, headers });
  assert.equal(otherSurface.statusCode, 404);
});
