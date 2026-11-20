import { LiveKitAdmission, type LiveKitTokenBody } from '@voice-room/shared/contracts/admission';
import { isErrorCode, type ErrorCode } from '@voice-room/shared/contracts/errors';
import {
  MeetOwnerAuthorization,
  type MeetOwnerExchangeBody,
  MeetRoomCreated,
  MeetRoomStatus
} from '@voice-room/shared/contracts/rooms';
import { isRecord } from '@voice-room/shared/guards';
import { parseRuntimeConfig, resolveLiveKitConnectUrls, type RuntimeConfigV1 } from '@voice-room/shared/runtime-config';
import { t } from '@voice-room/ui/i18n';
import type { Static, TSchema } from 'typebox';
import { Value } from 'typebox/value';

export function meetErrorMessage(code: string): string {
  switch (code) {
    case 'unavailable':
      return t('meet.error.unavailable');
    case 'invalid_response':
      return t('meet.error.invalidResponse');
    case 'invalid_credentials':
      return t('meet.error.ownerLink');
    case 'authentication_required':
      return t('meet.error.ownerAuthorization');
    case 'room_not_found':
      return t('meet.error.roomNotFound');
    case 'room_full':
    case 'server_full':
      return t('meet.error.roomFull');
    case 'room_create_rate_limited':
    case 'temporary_room_quota':
      return t('meet.error.createLimit');
    case 'invalid_session':
      return t('meet.error.session');
    default:
      return t('meet.error.generic');
  }
}

export class MeetApiError extends Error {
  constructor(
    readonly code: ErrorCode | '',
    readonly status: number
  ) {
    super(meetErrorMessage(code));
    this.name = 'MeetApiError';
  }
}

/** The owner secret enters through a fragment, which is never sent as a document URL. */
export function consumeOwnerLink(browser: Pick<Window, 'location' | 'history'> = window): string {
  const url = new URL(browser.location.href);
  const parameters = new URLSearchParams(url.hash.slice(1));
  if (!parameters.has('owner')) return '';
  const token = parameters.get('owner') ?? '';
  parameters.delete('owner');
  url.hash = parameters.toString();
  browser.history.replaceState(null, '', url);
  return token;
}

export function createMeetApi(fetcher: typeof fetch = fetch) {
  let ownerAuthorization = '';
  let runtimeConfig: Promise<RuntimeConfigV1 | null> | undefined;

  async function request<S extends TSchema>(path: string, schema: S, options: RequestInit = {}): Promise<Static<S>> {
    const timeout = AbortSignal.timeout(10_000);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await fetcher(path, { ...options, signal, credentials: 'omit', cache: 'no-store', redirect: 'error' });
    } catch {
      throw new MeetApiError('unavailable', 0);
    }
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const code = isRecord(body) && isErrorCode(body.code) ? body.code : '';
      throw new MeetApiError(code, response.status);
    }
    if (!Value.Check(schema, body)) throw new MeetApiError('invalid_response', response.status);
    return body;
  }

  async function readRuntimeConfig(): Promise<RuntimeConfigV1 | null> {
    try {
      const response = await fetcher('/runtime-config.json', {
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(2_000)
      });
      return response.ok ? parseRuntimeConfig(await response.text()) : null;
    } catch {
      return null;
    }
  }

  return {
    async status(roomId: string): Promise<MeetRoomStatus | null> {
      try {
        return await request(`/api/meet/rooms/${encodeURIComponent(roomId)}/status`, MeetRoomStatus);
      } catch (error) {
        if (error instanceof MeetApiError && error.status === 404) return null;
        throw error;
      }
    },
    async exchangeOwnerLink(token: string): Promise<void> {
      const body: MeetOwnerExchangeBody = { token };
      const result = await request('/api/meet/owner/exchange', MeetOwnerAuthorization, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      ownerAuthorization = result.token;
    },
    async createMeeting(): Promise<MeetRoomCreated> {
      const authorization = ownerAuthorization;
      if (!authorization) throw new MeetApiError('authentication_required', 401);
      try {
        return await request('/api/meet/rooms', MeetRoomCreated, {
          method: 'POST',
          headers: { Authorization: `Bearer ${authorization}` }
        });
      } catch (error) {
        if (error instanceof MeetApiError && error.status === 401 && ownerAuthorization === authorization) {
          ownerAuthorization = '';
        }
        throw error;
      }
    },
    async admit(
      body: Static<typeof LiveKitTokenBody>,
      signal: AbortSignal
    ): Promise<LiveKitAdmission & { urls: string[] }> {
      runtimeConfig ??= readRuntimeConfig();
      const admission = await request('/api/meet/livekit-token', LiveKitAdmission, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal
      });
      return { ...admission, urls: resolveLiveKitConnectUrls(await runtimeConfig, admission.url) };
    }
  };
}

export type MeetApi = ReturnType<typeof createMeetApi>;
