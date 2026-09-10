import {
  MODERATION_DEFAULT_LIMIT,
  MODERATION_MAX_LIMIT,
  normalizeActiveBan,
  normalizeBanMutation,
  type ActiveBan,
  type BanMutation,
  type ModerationPage
} from '@voice-room/shared/moderation';
import { del, getJsonAuth } from './http';

export type { ActiveBan, BanMutation, ModerationDuration, ModerationPage } from '@voice-room/shared/moderation';

function roomModerationUrl(roomId: string): string {
  return `/api/rooms/${encodeURIComponent(roomId)}/moderation`;
}

function parsePage(value: unknown, roomId: string): ModerationPage {
  const payload = value as Partial<ModerationPage> | null;
  if (payload?.contractVersion !== 1 || payload.roomId !== roomId || !Array.isArray(payload.bans)) {
    throw new Error('Сервер вернул некорректный список блокировок');
  }
  const bans = payload.bans.map(normalizeActiveBan);
  if (bans.some((ban) => !ban)) throw new Error('Сервер вернул некорректную блокировку');
  return {
    contractVersion: 1,
    roomId,
    bans: bans as ActiveBan[],
    pageInfo: {
      nextCursor: typeof payload.pageInfo?.nextCursor === 'string' ? payload.pageInfo.nextCursor : undefined,
      hasMore: Boolean(payload.pageInfo?.hasMore)
    }
  };
}

async function responseJson<T>(response: Response): Promise<T> {
  let payload: ({ error?: string } & T) | null = null;
  try { payload = await response.json(); } catch { /* generic error below */ }
  if (!response.ok) throw new Error(payload?.error || 'Сервер недоступен');
  return payload as T;
}

export async function fetchActiveBans(
  roomId: string,
  { cursor, limit = MODERATION_DEFAULT_LIMIT }: { cursor?: string; limit?: number } = {}
): Promise<ModerationPage> {
  const boundedLimit = Math.min(MODERATION_MAX_LIMIT, Math.max(1, Math.trunc(limit)));
  const query = new URLSearchParams({ limit: String(boundedLimit) });
  if (cursor) query.set('cursor', cursor);
  const payload = await getJsonAuth<unknown>(`${roomModerationUrl(roomId)}/bans?${query}`);
  return parsePage(payload, roomId);
}

export async function putBan(roomId: string, input: BanMutation, idempotencyKey: string): Promise<ActiveBan> {
  const normalized = normalizeBanMutation(input);
  if (!normalized || !idempotencyKey.trim()) throw new Error('Заполните данные блокировки');
  const response = await fetch(`${roomModerationUrl(roomId)}/bans`, {
    method: 'PUT',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey
    },
    body: JSON.stringify(normalized)
  });
  const payload = await responseJson<{ ban?: unknown }>(response);
  const ban = normalizeActiveBan(payload.ban);
  if (!ban) throw new Error('Сервер вернул некорректную блокировку');
  return ban;
}

export async function unban(roomId: string, banId: string): Promise<ActiveBan> {
  const payload = await del<{ ban?: unknown }>(
    `${roomModerationUrl(roomId)}/bans/${encodeURIComponent(banId)}`
  );
  const ban = normalizeActiveBan(payload.ban);
  if (!ban) throw new Error('Сервер вернул некорректный ответ');
  return ban;
}

export async function deleteModeratedMessage(roomId: string, messageId: string): Promise<void> {
  await del(`${roomModerationUrl(roomId)}/messages/${encodeURIComponent(messageId)}`);
}
