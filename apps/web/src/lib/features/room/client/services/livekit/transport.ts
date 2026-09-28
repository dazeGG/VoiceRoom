// Getting onto the LiveKit server: credentials, candidate URLs tried in turn,
// and the codes a failure may report.

import type { Room } from 'livekit-client';
import { state } from '../../core/state.svelte';
import { ApiError } from '$lib/api/client';
import { requestLiveKitToken, type LiveKitCredentials } from '../../net/api';
import { loadLiveKitClient } from '../../media/livekit-runtime';
import { createLogger } from '$lib/shared/log';

const log = createLogger('room:livekit');

const NOT_IN_ROOM_RETRY_DELAYS_MS = [500, 1_000, 2_000];

/**
 * The server only admits peers its roster knows, and the realtime join that
 * puts us there is sent just before this request. The server already waits a
 * few seconds for it; a slower or reconnecting realtime socket gets a few more
 * tries here before the join is treated as failed.
 */
export async function requestLiveKitCredentials(name: string, isCurrent: () => boolean): Promise<LiveKitCredentials> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await requestLiveKitToken({
        name,
        peerId: state.peerId,
        roomId: state.roomId,
        sessionToken: state.sessionToken
      });
    } catch (error) {
      const delay = NOT_IN_ROOM_RETRY_DELAYS_MS[attempt];
      if (!(error instanceof ApiError) || error.code !== 'not_in_room' || delay === undefined) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
      // A rejected or abandoned join (room full, left the room) ends the wait.
      if (!isCurrent()) throw error;
    }
  }
}

export function isRetryableLiveKitApiFailure(error: ApiError): boolean {
  if (
    [
      'authentication_required',
      'invalid_join',
      'invalid_session',
      'room_banned',
      'room_full',
      'room_not_found'
    ].includes(error.code)
  )
    return false;
  return (
    [408, 425, 429].includes(error.status) ||
    error.status >= 500 ||
    [
      'livekit_gate_credential_unavailable',
      'livekit_gate_principal_unavailable',
      'livekit_gate_unavailable',
      'membership_persist_failed',
      'membership_unavailable',
      'not_in_room'
    ].includes(error.code)
  );
}

export function safeLiveKitCode(code: string): string {
  return [
    'authentication_required',
    'invalid_join',
    'invalid_session',
    'room_banned',
    'room_full',
    'room_not_found',
    'livekit_gate_credential_unavailable',
    'livekit_gate_principal_unavailable',
    'livekit_gate_unavailable',
    'membership_persist_failed',
    'membership_unavailable',
    'not_in_room',
    'transport_error'
  ].includes(code)
    ? code
    : 'unknown_error';
}

export async function connectLiveKitWithFallback(
  credentials: { url: string; urls?: string[]; token: string },
  isCurrent: () => boolean
): Promise<Room | null> {
  const { Room } = await loadLiveKitClient();
  if (!isCurrent()) return null;
  const configuredUrls = credentials.urls?.length ? credentials.urls : [credentials.url];
  const urls = [...new Set(configuredUrls.flatMap(getLiveKitConnectUrls))];
  for (let candidateIndex = 0; candidateIndex < urls.length; candidateIndex += 1) {
    const url = urls[candidateIndex];
    if (!isCurrent()) return null;
    const room = new Room({
      adaptiveStream: false,
      dynacast: true
    });

    try {
      await room.connect(url, credentials.token, {
        autoSubscribe: false,
        ...(isForcedRelayDiagnostic() ? { rtcConfig: { iceTransportPolicy: 'relay' as RTCIceTransportPolicy } } : {})
      });
      if (!isCurrent()) {
        // Never bound or committed, so there is no room state to unwind.
        await room.disconnect(false).catch(() => {});
        return null;
      }
      logLiveKitTransition('info', {
        event: 'candidate_connect',
        candidateIndex,
        candidateCount: urls.length,
        result: 'connected'
      });
      return room;
    } catch {
      logLiveKitTransition('warn', {
        event: 'candidate_connect',
        candidateIndex,
        candidateCount: urls.length,
        result: 'failed'
      });
      await room.disconnect(false).catch(() => {});
      if (!isCurrent()) return null;
    }
  }

  throw new LiveKitTransportError();
}

/**
 * `?forceRelay=1` on the room URL sends all media through LiveKit's TURN relay.
 * It exists to verify a TURN deployment (TURN_ENABLED) from a normal network:
 * with it the status tooltip should read "через ретранслятор" and audio must
 * still flow.
 */
export function isForcedRelayDiagnostic(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('forceRelay') === '1';
  } catch {
    return false;
  }
}

function getLiveKitConnectUrls(url: string): string[] {
  const urls = [url];
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'localhost') {
      parsed.hostname = '127.0.0.1';
      urls.push(parsed.toString());
    } else if (parsed.hostname === '127.0.0.1') {
      parsed.hostname = 'localhost';
      urls.push(parsed.toString());
    }
  } catch {
    // Keep the backend-provided URL as-is.
  }
  return [...new Set(urls)];
}

export function logLiveKitTransition(level: 'info' | 'warn', event: Record<string, string | number>): void {
  if (!['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)) return;
  log[level]('livekit_recovery_transition', event);
}

export class LiveKitTransportError extends Error {
  code = 'transport_error';
  status = 0;

  constructor() {
    super('LiveKit transport unavailable');
    this.name = 'LiveKitTransportError';
  }
}
