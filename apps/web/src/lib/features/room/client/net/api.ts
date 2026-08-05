import { state } from '../core/state.svelte';
import { resolveLiveKitUrls } from '$lib/platform/runtime-config';

export class ApiRequestError extends Error {
  code: string;
  roomId: string;
  status: number;

  constructor(message: string, code = '', roomId = '', status = 0) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = code;
    this.roomId = roomId;
    this.status = status;
  }
}

export async function fetchJson(url: string): Promise<any> {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('Сервер недоступен');
  return response.json();
}

export async function postJson(url: string, body: unknown): Promise<any> {
  const response = await fetch(url, {
    body: JSON.stringify(body),
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    method: 'POST'
  });
  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    // Non-JSON errors are handled by the generic message below.
  }
  if (!response.ok) {
    throw new ApiRequestError(payload?.error || 'Сервер недоступен', payload?.code, payload?.roomId, response.status);
  }
  if (url === '/api/livekit-token' && typeof payload?.url === 'string') {
    return { ...payload, urls: await resolveLiveKitUrls(payload.url) };
  }
  return payload;
}

export async function checkRoomExists(roomId: string): Promise<boolean> {
  const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}`, {
    headers: { Accept: 'application/json' }
  });
  if (response.status === 404) return false;
  if (!response.ok) throw new Error('Не удалось проверить комнату');

  const status = await response.json();
  // Capture the room's display name so the in-room top bar can show it
  // instead of the bare code.
  state.roomName = typeof status?.name === 'string' ? status.name : '';
  state.roomAvatarUrl = typeof status?.avatarUrl === 'string' ? status.avatarUrl : '';
  return Boolean(status?.exists);
}
