import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import type {
  CallActionBody,
  CallAnswer,
  CallBootstrap,
  CallIncoming,
  CallMissedSeenBody,
  CallMissedUpdated,
  CallSnapshot,
  CallVoiceTokenBody
} from '@voiceroom/shared/contracts/rings';
import type { ResolvedSession, SessionUser } from '../../app/context.ts';
import { BoundedMap } from '../../lib/bounded-map.ts';
import { tokensMatch } from '../../platform/crypto/tokens-match.ts';
import { DomainError } from '../../platform/http/domain-error.ts';
import type { AccountMessage } from '../../realtime/account-events.ts';
import type { WsConnection } from '../../realtime/registry.ts';
import type { JoinResult } from '../../realtime/voice-join.ts';
import type { LiveKitAdmission } from '../admission/livekit-credential-provider.ts';
import { directMessageFence } from '../messaging/dm-message-fence.repository.ts';
import type { DirectMessage } from '../social/social-records.ts';
import {
  advanceCall,
  allowedCallActions,
  closeCall,
  otherParticipant,
  type CallSeat
} from './call-lifecycle.policy.ts';
import {
  ALONE_WINDOW_MS,
  CALL_RETENTION_MS,
  RING_WINDOW_MS,
  callDuration,
  createCallRingRepository,
  type VoiceCall
} from './call-rings.repository.ts';

type Viewer = { userId: string; sessionHash: string };
type SeatIntent = {
  peerId: string;
  seatToken: string;
  sessionHash: string;
  expiresAt: number;
  attempt: number;
  joined: boolean;
  leaveSinceRevision?: number;
};
type Admission = NonNullable<CallAnswer['voiceAdmission']>;
type Transition = {
  call: VoiceCall;
  changed: boolean;
  now: number;
  message?: DirectMessage;
  missed?: CallMissedUpdated;
};
type Answer = CallAnswer | { retryAfterSeconds: number };
type ActionResult =
  'stale' | 'accept' | 'open' | 'resume' | 'leave' | 'ring' | 'transfer' | { retryAfterSeconds: number };
type VoicePort = {
  seat(roomId: string, peerId: string): { reconnectUntil: number | null; connection: WsConnection | null } | null;
  join(
    connection: WsConnection,
    admission: Admission,
    user: SessionUser,
    ip: string,
    requestId?: string
  ): Promise<JoinResult>;
  revoke(roomId: string, userId: string, peerId: string): Promise<void>;
  fence(roomId: string, userId: string, peerId: string): void;
  cleanup: {
    wait(roomId: string, peerId: string): Promise<boolean> | null;
    pendingInRoom(roomId: string): boolean;
    retry(): void;
  };
  token(roomId: string, peerId: string, user: SessionUser): Promise<LiveKitAdmission>;
};

function seatId(userId: string): string {
  return `c-${createHash('sha256').update(userId).digest('hex').slice(0, 32)}`;
}

function notFound(): never {
  throw new DomainError('call_not_found', 404, 'Call not found');
}

// A client that cannot decrypt the call would hear only noise, so it does not get into the room.
function outdated(): never {
  throw new DomainError('client_outdated', 426, 'This client cannot join an end-to-end encrypted call');
}

function disabled(): never {
  throw new DomainError('call_disabled', 403, 'Voice calls are disabled');
}

export function createCallRingService({
  pool,
  enabled,
  clock,
  graceMs,
  limits,
  dailyNewChatLimit,
  invalidateTyping,
  voice,
  notify,
  report
}: {
  pool(this: void): pg.Pool | null;
  enabled: boolean;
  clock?: (() => number) | undefined;
  graceMs: number;
  limits: { count: number; windowMs: number };
  dailyNewChatLimit: number;
  invalidateTyping(this: void, userId: string, peerId?: string): void;
  voice: VoicePort;
  notify(this: void, userId: string, message: AccountMessage): unknown;
  report(this: void, error: unknown): void;
}) {
  // The roster belongs to this process. Serialize its call commands and their
  // after-commit effects, without holding transactions across voice operations.
  let work = Promise.resolve();
  const intents = new Map<string, SeatIntent>();
  // An existing call has one durable creation key. Keep coalesced starts
  // fenced against a later attempt while this roster process is alive.
  const coalescedStarts = new BoundedMap<
    string,
    { peerId: string; callId: string; expiresAt: number; accepting: boolean }
  >(1024);
  const scheduledClosedEvictions = new Set<string>();
  const key = (call: VoiceCall, id: string) => `${call.id}:${id}`;
  const users = (call: VoiceCall) => [call.callerId, call.recipientId];
  const repo = () => {
    const connection = pool();
    return connection && createCallRingRepository(connection, clock, dailyNewChatLimit);
  };
  const fenceDirectMessage = directMessageFence(pool, report);
  const requireRepo = () => {
    const repository = repo();
    if (!repository) throw new DomainError('internal_error', 503, 'Call storage unavailable');
    return repository;
  };

  function serialize<T>(run: () => Promise<T>): Promise<T> {
    const result = work.then(run);
    work = result.then(
      () => {},
      () => {}
    );
    return result;
  }

  function seats(call: VoiceCall): CallSeat[] {
    return users(call).map((userId) => {
      const seat = call.phase === 'closed' ? null : voice.seat(call.roomId, seatId(userId));
      return {
        userId,
        status: !seat ? 'absent' : seat.connection ? 'present' : 'reconnecting',
        reconnectUntil: seat?.reconnectUntil ?? null
      };
    });
  }

  function waiting(call: VoiceCall, now: number): boolean {
    return users(call).some((userId) => {
      const intent = intents.get(key(call, userId));
      return intent !== undefined && !intent.joined && intent.attempt === call.attempt && intent.expiresAt > now;
    });
  }

  async function snapshot(
    repository: NonNullable<ReturnType<typeof repo>>,
    call: VoiceCall,
    viewer: string,
    now: number
  ): Promise<CallSnapshot> {
    const roster = seats(call);
    return {
      id: call.id,
      ...(await repository.profiles(call)),
      attempt: call.attempt,
      attemptInviterUserId: call.attemptInviterUserId,
      phase: call.phase,
      attemptResult: call.attemptResult,
      revision: call.revision,
      ringingExpiresAt: call.ringingExpiresAt,
      aloneDeadline: call.aloneDeadline,
      startedAt: call.startedAt,
      firstConnectedAt: call.firstConnectedAt,
      endedAt: call.endedAt,
      durationMs: callDuration(call, now),
      endReason: call.endReason,
      endedByUserId: call.endedByUserId,
      seats: roster,
      allowedActions: allowedCallActions(call, viewer, roster).filter((action) => enabled || action !== 're-ring'),
      serverNow: now,
      messageId: call.messageId
    };
  }

  function incoming(call: CallSnapshot): CallIncoming {
    return {
      callId: call.id,
      fromUser: call.attemptInviterUserId === call.caller.id ? call.caller : call.recipient,
      attempt: call.attempt,
      revision: call.revision,
      ringingExpiresAt: call.ringingExpiresAt,
      serverNow: call.serverNow
    };
  }

  function fenceSeat(call: VoiceCall, userId: string) {
    intents.delete(key(call, userId));
    voice.fence(call.roomId, userId, seatId(userId));
  }

  async function publish(repository: NonNullable<ReturnType<typeof repo>>, change: Transition, ring = false) {
    const { call, now, message, missed } = change;
    if (call.phase === 'closed' && !scheduledClosedEvictions.has(call.id)) {
      for (const userId of users(call)) {
        intents.delete(key(call, userId));
        if (!change.changed || voice.seat(call.roomId, seatId(userId))) fenceSeat(call, userId);
      }
      scheduledClosedEvictions.add(call.id);
    }
    if (!change.changed) return;
    if (message) {
      const event: AccountMessage = { type: call.revision === 1 ? 'dm-message' : 'dm.message.edited', message };
      // A conversation deletion may commit right after this transition; its
      // call entry must not reappear in a thread reopened meanwhile.
      await fenceDirectMessage(message, () => {
        for (const userId of users(call)) notify(userId, event);
      });
    }
    if (missed) notify(call.recipientId, { type: 'call.missed.updated', ...missed });
    const state = await snapshot(repository, call, call.callerId, now);
    const recipientActions = allowedCallActions(call, call.recipientId, state.seats ?? []);
    notify(call.callerId, { type: 'call.state', call: state });
    notify(call.recipientId, {
      type: 'call.state',
      call: { ...state, allowedActions: recipientActions.filter((action) => enabled || action !== 're-ring') }
    });
    if (ring) notify(otherParticipant(call, call.attemptInviterUserId), { type: 'call.incoming', ...incoming(state) });
  }

  function admission(call: VoiceCall, viewer: Viewer, now: number, create: boolean): Admission | undefined {
    const id = key(call, viewer.userId);
    let intent = intents.get(id);
    if (
      intent &&
      (intent.joined
        ? !voice.seat(call.roomId, intent.peerId)
        : intent.expiresAt <= now || intent.attempt !== call.attempt)
    ) {
      intents.delete(id);
      intent = undefined;
    }
    if (call.phase === 'ringing' && call.attemptInviterUserId !== viewer.userId) return undefined;
    if (!intent && create) {
      intent = {
        peerId: seatId(viewer.userId),
        seatToken: randomUUID(),
        sessionHash: viewer.sessionHash,
        expiresAt: now + graceMs,
        attempt: call.attempt,
        joined: false
      };
      intents.set(id, intent);
    }
    if (!intent || intent.sessionHash !== viewer.sessionHash) return undefined;
    return { roomId: call.roomId, peerId: intent.peerId, seatToken: intent.seatToken };
  }

  async function settle(id: string, viewer: string | null, event?: { userId: string; departed: boolean }) {
    const repository = requireRepo();
    const fresh = await repository.update(id, viewer, (call, now, eligible) => {
      const roster = seats(call);
      const expired = roster.filter((seat) => seat.reconnectUntil !== null && seat.reconnectUntil <= now);
      const departed = expired[0];
      const remaining = roster.map((seat): CallSeat =>
        expired.includes(seat) ? { userId: seat.userId, status: 'absent', reconnectUntil: null } : seat
      );
      return {
        call: advanceCall(call, now, eligible, remaining, {
          waiting: waiting(call, now),
          changed: Boolean(event || departed),
          departing: departed?.userId ?? (event?.departed ? event.userId : null),
          departedAt: departed?.reconnectUntil ?? now
        }),
        result: expired
      };
    });
    if (!fresh) return notFound();
    if (event?.departed && !voice.seat(fresh.call.roomId, seatId(event.userId))) {
      intents.delete(key(fresh.call, event.userId));
    }
    for (const seat of fresh.result) fenceSeat(fresh.call, seat.userId);
    await publish(repository, fresh);
    return fresh;
  }

  async function answer(
    change: Transition,
    viewer: Viewer,
    disposition: CallAnswer['disposition'],
    handoff?: Admission
  ): Promise<CallAnswer> {
    return {
      ok: true,
      disposition,
      call: await snapshot(requireRepo(), change.call, viewer.userId, change.now),
      ...(handoff && { voiceAdmission: handoff })
    };
  }

  async function performAction(viewer: Viewer, id: string, body: CallActionBody): Promise<Answer> {
    const repository = requireRepo();
    await settle(id, viewer.userId);
    const change = await repository.update<ActionResult>(id, viewer.userId, (previous, now, eligible) => {
      if (body.action === 're-ring' && !enabled) disabled();
      const roster = seats(previous);
      const call = advanceCall(previous, now, eligible, roster, { waiting: waiting(previous, now) });
      const own = roster.find((seat) => seat.userId === viewer.userId);
      const other = roster.find((seat) => seat.userId !== viewer.userId);
      const pending = call.phase === 'ringing';
      const inbound = pending && call.attemptInviterUserId !== viewer.userId;
      const intent = intents.get(key(call, viewer.userId));
      if (call.phase === 'closed' || call.attempt !== body.expectedAttempt) return { call, result: 'stale' as const };
      const remaining = roster.map((seat): CallSeat =>
        seat.userId === viewer.userId ? { userId: seat.userId, status: 'absent', reconnectUntil: null } : seat
      );
      if (body.action === 'join' && body.expectedRevision !== undefined) {
        if (call.revision !== body.expectedRevision || pending || !own || own.status === 'absent') {
          return { call, result: 'stale' };
        }
        return {
          call: {
            ...call,
            phase: call.attemptResult === 'accepted' ? 'connecting' : 'alone',
            mutualSince: null,
            mutualMs: callDuration(call, now),
            aloneDeadline: call.aloneDeadline ?? now + ALONE_WINDOW_MS
          },
          result: 'transfer'
        };
      }
      if (inbound && (body.action === 'accept' || body.action === 'join')) {
        return {
          call: { ...call, phase: 'connecting', attemptResult: 'accepted' } satisfies VoiceCall,
          result: 'accept' as const
        };
      }
      if (inbound && body.action === 'decline') {
        return { call: closeCall(call, now, 'declined', viewer.userId), result: 'open' as const };
      }
      if (body.action === 'join' && own?.status === 'absent') {
        if (intent && !intent.joined && intent.expiresAt > now) return { call, result: 'stale' as const };
        return { call: { ...call }, result: 'resume' as const };
      }
      if (
        body.action === 'leave' &&
        intent?.sessionHash === viewer.sessionHash &&
        tokensMatch(intent.seatToken, body.seatToken) &&
        (intent.leaveSinceRevision === undefined ||
          (body.expectedRevision !== undefined &&
            body.expectedRevision >= intent.leaveSinceRevision &&
            body.expectedRevision <= call.revision))
      ) {
        return {
          call: advanceCall(call, now, eligible, remaining, { departing: viewer.userId }),
          result: 'leave' as const
        };
      }
      if (
        body.action === 're-ring' &&
        call.phase === 'alone' &&
        own?.status === 'present' &&
        other?.status === 'absent'
      ) {
        // One current attempt per call and the Ring window bound limit rapid re-rings.
        // A friend who answered and then left consented to this call, so the window
        // only applies after an unanswered attempt.
        const nextRingAt = call.ringingExpiresAt - RING_WINDOW_MS + limits.windowMs;
        if (limits.count > 0 && call.attemptResult !== 'accepted' && now < nextRingAt) {
          return { call, result: { retryAfterSeconds: Math.ceil((nextRingAt - now) / 1_000) } };
        }
        return {
          call: {
            ...call,
            phase: 'ringing',
            attemptResult: 'pending',
            attempt: call.attempt + 1,
            attemptInviterUserId: viewer.userId,
            ringingExpiresAt: now + RING_WINDOW_MS,
            aloneDeadline: now + ALONE_WINDOW_MS
          } satisfies VoiceCall,
          result: 'ring' as const
        };
      }
      return { call, result: 'stale' as const };
    });
    if (!change) return notFound();
    const { call, result, now } = change;
    if (result === 'transfer' || (result === 'leave' && call.phase !== 'closed')) fenceSeat(call, viewer.userId);
    if (result === 'ring') {
      const peerId = otherParticipant(call, viewer.userId);
      intents.delete(key(call, peerId));
      invalidateTyping(viewer.userId, peerId);
    }
    const handoff = result === 'accept' || result === 'resume' ? admission(call, viewer, now, true) : undefined;
    await publish(repository, change, result === 'ring');
    if (typeof result === 'object') return result;
    if (result === 'transfer') {
      const transfer = admission(call, viewer, now, true);
      return answer(change, viewer, transfer ? 'resume' : 'stale', transfer);
    }
    return answer(change, viewer, result === 'leave' || result === 'ring' ? 'open' : result, handoff);
  }

  function start(viewer: Viewer, peerId: string, requestId: string): Promise<Answer> {
    return serialize(async () => {
      if (!enabled) disabled();
      if (viewer.userId === peerId) throw new DomainError('invalid_request', 400, 'Cannot call your own account');
      const repository = requireRepo();
      const requestKey = `${viewer.userId}:${requestId}`;
      const coalesced = coalescedStarts.get(requestKey);
      if (coalesced && coalesced.expiresAt > (await repository.now())) {
        if (coalesced.peerId !== peerId)
          throw new DomainError('call_request_conflict', 409, 'Call request ID is already in use');
        const change = await settle(coalesced.callId, viewer.userId);
        return answer(change, viewer, 'open', coalesced.accepting ? pendingAdmission(change, viewer) : undefined);
      }

      let result = await repository.start(viewer.userId, peerId, requestId, limits);
      const existing = result.status === 'open' ? await settle(result.call.id, viewer.userId) : undefined;
      if (existing?.call.phase === 'closed') result = await repository.start(viewer.userId, peerId, requestId, limits);
      if (result.status === 'rate_limited') return { retryAfterSeconds: result.retryAfterSeconds };
      if (result.status === 'created') {
        invalidateTyping(viewer.userId, result.startedAsStrangers ? undefined : peerId);
        const change = { ...result, changed: true };
        const handoff = admission(result.call, viewer, result.now, true);
        await publish(repository, change, true);
        return answer(change, viewer, 'start', handoff);
      }
      const change = existing?.call.id === result.call.id ? existing : await settle(result.call.id, viewer.userId);
      const accepting =
        result.status === 'open' &&
        change.call.phase === 'ringing' &&
        change.call.attemptInviterUserId !== viewer.userId;
      if (result.status === 'open') {
        coalescedStarts.set(requestKey, {
          peerId,
          callId: result.call.id,
          expiresAt: change.now + CALL_RETENTION_MS,
          accepting
        });
      }
      if (accepting) {
        return performAction(viewer, result.call.id, {
          action: 'accept',
          expectedAttempt: change.call.attempt,
          clientRequestId: requestId
        });
      }
      return answer(change, viewer, 'open', result.status === 'replay' ? pendingAdmission(change, viewer) : undefined);
    });
  }

  function pendingAdmission({ call, now }: Transition, viewer: Viewer): Admission | undefined {
    const intent = intents.get(key(call, viewer.userId));
    if (call.phase !== 'closed' && intent && !intent.joined) return admission(call, viewer, now, false);
    return undefined;
  }

  function details(viewer: string, id: string) {
    return serialize(async () => {
      const record = await settle(id, viewer);
      return { ok: true as const, call: await snapshot(requireRepo(), record.call, viewer, record.now) };
    });
  }

  function bootstrap(viewer: string): Promise<CallBootstrap> {
    return serialize(async () => {
      const repository = repo();
      const activeCalls: CallSnapshot[] = [];
      const incomingCalls: CallIncoming[] = [];
      const serverNow = repository ? await repository.now() : (clock ?? Date.now)();
      for (const prior of (await repository?.list(viewer)) ?? []) {
        if (!repository) break;
        const { call, now } = await settle(prior.id, viewer);
        if (call.phase === 'closed') continue;
        const state = await snapshot(repository, call, viewer, now);
        activeCalls.push(state);
        if (state.phase === 'ringing' && state.attemptInviterUserId !== viewer) incomingCalls.push(incoming(state));
      }
      const missed = (await repository?.listMissed(viewer)) ?? [];
      return { ok: true, enabled, activeCalls, incoming: incomingCalls, missed, serverNow };
    });
  }

  function markMissedSeen(viewer: string, peerId: string, body: CallMissedSeenBody) {
    return serialize(async () => {
      const missed = await requireRepo().acknowledgeMissed(viewer, peerId, body.watermark);
      notify(viewer, { type: 'call.missed.updated', ...missed });
      return { ok: true as const, ...missed };
    });
  }

  function refreshMissed(recipientId: string, peerId: string) {
    void serialize(async () => {
      const missed = await requireRepo().acknowledgeMissed(recipientId, peerId);
      notify(recipientId, { type: 'call.missed.updated', ...missed });
    }).catch(report);
  }

  async function notificationTarget(viewer: string, id: string) {
    const peerUserId = await requireRepo().messagePeer(viewer, id);
    return peerUserId ? { ok: true as const, peerUserId } : notFound();
  }

  async function authorizeVoice(viewer: Viewer, id: string, proof: string) {
    const change = await settle(id, viewer.userId);
    const { call, now } = change;
    const handoff = call.phase === 'closed' ? undefined : admission(call, viewer, now, false);
    if (!handoff || !tokensMatch(handoff.seatToken, proof)) return notFound();
    return { call, handoff };
  }

  async function joinVoice(
    connection: WsConnection,
    auth: ResolvedSession,
    id: string,
    proof: string,
    ip: string,
    requestId?: string
  ): Promise<JoinResult> {
    const { user, session } = auth;
    if (!user || !session || connection.userId !== user.id || connection.authSessionHash !== session.tokenHash)
      return { ok: false, code: 'call_not_found' };
    const viewer = { userId: user.id, sessionHash: session.tokenHash };
    const tryJoin = () =>
      serialize(async (): Promise<JoinResult | { cleanup: Promise<boolean> }> => {
        const { call, handoff } = await authorizeVoice(viewer, id, proof);
        const cleanup = voice.cleanup.wait(call.roomId, handoff.peerId);
        if (cleanup) return { cleanup };
        const existing = voice.seat(call.roomId, handoff.peerId);
        if (existing?.connection && existing.connection !== connection) return { ok: false, code: 'superseded_join' };
        if (existing) {
          await voice.revoke(call.roomId, user.id, handoff.peerId);
          if (!admission(call, viewer, (clock ?? Date.now)(), false)) return { ok: false, code: 'call_not_found' };
        }
        const result = await voice.join(connection, handoff, user, ip, requestId);
        if (result.ok) {
          const intent = intents.get(key(call, user.id));
          if (intent) intent.joined = true;
          const current = await settle(call.id, user.id, { userId: user.id, departed: false });
          if (intent && result.reconnecting) intent.leaveSinceRevision = current.call.revision;
        }
        return result;
      });
    const first = await tryJoin();
    if (!('cleanup' in first)) return first;
    // A transfer reuses its LiveKit identity. Wait for the old seat outside
    // the call queue, then authorize the handoff again against current state.
    if (await first.cleanup) {
      const retry = await tryJoin();
      if (!('cleanup' in retry)) return retry;
    }
    return { ok: false, code: 'reconnect_finalize_failed' };
  }

  function token(user: SessionUser, sessionHash: string, id: string, body: CallVoiceTokenBody) {
    return serialize(async () => {
      const { call, handoff } = await authorizeVoice({ userId: user.id, sessionHash }, id, body.seatToken);
      if (body.e2ee !== 1) outdated();
      const connection = voice.seat(call.roomId, handoff.peerId)?.connection;
      if (!connection || connection.closed || connection.authSessionHash !== sessionHash) return notFound();
      const result = await voice.token(call.roomId, handoff.peerId, user);
      return {
        ok: true as const,
        ...result,
        capabilities: { screenShare: true, camera: true, chat: 'none' as const, maxPeers: 2 }
      };
    });
  }

  function rosterChanged(roomId: string, userId: string, departed: boolean): void {
    void serialize(async () => {
      const repository = repo();
      const call = await repository?.fromRoom(roomId);
      if (!call || call.phase === 'closed') return;
      await settle(call.id, null, { userId, departed });
    }).catch(report);
  }

  function invalidate(userId: string, peerId?: string): void {
    void serialize(async () => {
      const repository = repo();
      if (!repository) return;
      for (const call of await repository.list(userId)) {
        if (peerId !== undefined && otherParticipant(call, userId) !== peerId) continue;
        await settle(call.id, userId);
      }
    }).catch(report);
  }

  function maintenance(): Promise<void> {
    return serialize(async () => {
      const repository = repo();
      if (!repository) return;
      voice.cleanup.retry();
      const now = await repository.now();
      for (const [id, intent] of intents) if (!intent.joined && intent.expiresAt <= now) intents.delete(id);
      for (const call of await repository.list()) await settle(call.id, null);
      await repository.checkpointConnected(now);
      for (const call of await repository.listClosed(now - CALL_RETENTION_MS)) {
        if (!voice.cleanup.pendingInRoom(call.roomId) && (await repository.prune(call, now))) {
          scheduledClosedEvictions.delete(call.id);
        }
      }
    });
  }

  function recover(): Promise<void> {
    return serialize(async () => {
      const repository = repo();
      if (!repository) return;
      const startedAt = await repository.now();
      for (const call of await repository.listClosed()) {
        await publish(repository, { call, now: startedAt, changed: false });
      }
      for (const call of await repository.list()) {
        if (seats(call).some((seat) => seat.status !== 'absent')) continue;
        const change = await repository.update(call.id, null, (record, now, eligible) => ({
          call: eligible
            ? {
                ...record,
                phase: 'alone',
                attemptResult: record.attemptResult === 'pending' ? 'no_answer' : record.attemptResult,
                aloneDeadline: now + graceMs,
                mutualSince: null
              }
            : closeCall({ ...record, mutualSince: null }, now, 'unavailable', null),
          result: null
        }));
        if (change) {
          for (const userId of users(call)) fenceSeat(change.call, userId);
          await publish(repository, change);
        }
      }
    });
  }

  return {
    bootstrap,
    markMissedSeen,
    refreshMissed,
    notificationTarget,
    details,
    start,
    joinVoice,
    token,
    rosterChanged,
    invalidate,
    maintenance,
    recover,
    action: (viewer: Viewer, id: string, body: CallActionBody) => serialize(() => performAction(viewer, id, body))
  };
}

export type CallRingService = ReturnType<typeof createCallRingService>;
