import type { CallEndReason, CallSnapshot } from '@voiceroom/shared/contracts/rings';
import { ALONE_WINDOW_MS, callDuration, type VoiceCall } from './call-rings.repository.ts';

type Seats = NonNullable<CallSnapshot['seats']>;
export type CallSeat = Seats[number];
export type CallAction = CallSnapshot['allowedActions'][number];

export function otherParticipant(call: VoiceCall, userId: string): string {
  return call.callerId === userId ? call.recipientId : call.callerId;
}

export function closeCall(call: VoiceCall, now: number, reason: CallEndReason, actor: string | null): VoiceCall {
  return {
    ...call,
    phase: 'closed',
    attemptResult:
      call.attemptResult === 'pending' ? (reason === 'declined' ? 'declined' : 'cancelled') : call.attemptResult,
    aloneDeadline: null,
    mutualMs: callDuration(call, now),
    mutualSince: null,
    endedAt: now,
    endReason: reason,
    endedByUserId: actor
  };
}

function finalReason(call: VoiceCall): CallEndReason {
  if (call.firstConnectedAt !== null) return 'ended';
  if (call.attemptResult === 'no_answer') return 'no_answer';
  if (call.attemptResult === 'pending') return 'cancelled';
  return 'ended';
}

/** Settles deadlines before any action, and reconciles the roster after a seat change. */
export function advanceCall(
  previous: VoiceCall,
  now: number,
  eligible: boolean,
  seats: Seats,
  {
    departing = null,
    waiting = false,
    changed = false,
    departedAt = now
  }: { departing?: string | null; waiting?: boolean; changed?: boolean; departedAt?: number } = {}
): VoiceCall {
  if (previous.phase === 'closed') return previous;
  if (!eligible) return closeCall(previous, now, 'unavailable', null);
  const occupied = seats.filter((seat) => seat.status !== 'absent');
  const call: VoiceCall =
    previous.phase === 'ringing' && previous.ringingExpiresAt <= now
      ? { ...previous, phase: 'alone', attemptResult: 'no_answer' }
      : previous;
  if (call.aloneDeadline !== null && call.aloneDeadline <= now) {
    if (occupied.length === 1) return closeCall(call, now, 'alone_timeout', occupied[0]?.userId ?? null);
    return closeCall(call, now, finalReason(call), null);
  }
  if (call.phase === 'ringing') {
    if (departing === call.attemptInviterUserId) return closeCall(call, now, 'cancelled', departing);
    return changed ? { ...call } : call;
  }
  if (
    occupied.length === 0 &&
    (departing || (!waiting && (changed || previous.phase === 'ringing' || call.phase === 'connecting')))
  ) {
    return closeCall(call, now, finalReason(call), departing);
  }
  if (occupied.length === 2) {
    if (occupied.every((seat) => seat.status === 'present')) {
      if (call.phase === 'connected') return changed ? { ...call } : call;
      return {
        ...call,
        phase: 'connected',
        attemptResult: 'accepted',
        aloneDeadline: null,
        firstConnectedAt: call.firstConnectedAt ?? now,
        mutualSince: now
      };
    }
    if (call.phase !== 'connecting' || call.aloneDeadline !== null) {
      return {
        ...call,
        phase: 'connecting',
        attemptResult: 'accepted',
        aloneDeadline: null,
        mutualMs: callDuration(call, now),
        mutualSince: null
      };
    }
  }
  if (
    occupied.length === 1 &&
    (call.phase === 'connected' || (call.phase === 'connecting' && (!waiting || departing)))
  ) {
    return {
      ...call,
      phase: 'alone',
      aloneDeadline: call.aloneDeadline ?? departedAt + ALONE_WINDOW_MS,
      mutualMs: callDuration(call, now),
      mutualSince: null
    };
  }
  return changed && call === previous ? { ...call } : call;
}

export function allowedCallActions(call: VoiceCall, viewer: string, seats: Seats): CallAction[] {
  if (call.phase === 'closed') return [];
  const own = seats.find((seat) => seat.userId === viewer);
  const other = seats.find((seat) => seat.userId !== viewer);
  if (call.phase === 'ringing') return call.attemptInviterUserId === viewer ? ['leave'] : ['accept', 'decline'];
  if (own?.status === 'present' && other?.status === 'absent' && call.phase === 'alone') return ['leave', 're-ring'];
  return own?.status === 'absent' ? ['join'] : ['leave'];
}
