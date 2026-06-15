import { state } from '../core/state';

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
    throw new Error(payload?.error || 'Сервер недоступен');
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
  // Capture the room's display name/icon so the in-room top bar can show them
  // instead of the bare code.
  state.roomName = typeof status?.name === 'string' ? status.name : '';
  state.roomEmoji = typeof status?.emoji === 'string' ? status.emoji : '';
  state.roomColorKey = typeof status?.roomColorKey === 'string' ? status.roomColorKey : '';
  state.roomIconKey = typeof status?.roomIconKey === 'string' ? status.roomIconKey : '';
  state.roomPresetKey = typeof status?.roomPresetKey === 'string' ? status.roomPresetKey : '';
  return Boolean(status?.exists);
}
