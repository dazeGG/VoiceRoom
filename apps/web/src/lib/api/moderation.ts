import type { BanLifted, BanPage, BanSaved, MessageRemoved } from '@voice-room/shared/contracts/moderation';
import { api } from './client';
import {
  MODERATION_DEFAULT_LIMIT,
  MODERATION_MAX_LIMIT,
  normalizeActiveBan,
  normalizeBanMutation,
  type ActiveBan,
  type BanMutation,
  type ModerationPage
} from '@voice-room/shared/moderation';

export type { ActiveBan, BanMutation, ModerationDuration, ModerationPage } from '@voice-room/shared/moderation';

function roomModerationUrl(roomId: string): string {
  return `/api/rooms/${encodeURIComponent(roomId)}/moderation`;
}

// Bans go through the shared normalizer, which checks the ids and times the
// dialogs rely on; a page for another room is refused.
function parsePage(payload: BanPage, roomId: string): ModerationPage {
  if (payload.roomId !== roomId) throw new Error('Сервер вернул некорректный список блокировок');
  const bans = payload.bans.map(normalizeActiveBan);
  if (bans.some((ban) => !ban)) throw new Error('Сервер вернул некорректную блокировку');
  return {
    contractVersion: 1,
    roomId,
    bans: bans as ActiveBan[],
    pageInfo: { nextCursor: payload.pageInfo.nextCursor, hasMore: payload.pageInfo.hasMore }
  };
}

export async function fetchActiveBans(
  roomId: string,
  { cursor, limit = MODERATION_DEFAULT_LIMIT }: { cursor?: string; limit?: number } = {}
): Promise<ModerationPage> {
  const boundedLimit = Math.min(MODERATION_MAX_LIMIT, Math.max(1, Math.trunc(limit)));
  const query = new URLSearchParams({ limit: String(boundedLimit) });
  if (cursor) query.set('cursor', cursor);
  const payload = await api.get<BanPage>(`${roomModerationUrl(roomId)}/bans?${query}`);
  return parsePage(payload, roomId);
}

export async function putBan(roomId: string, input: BanMutation, idempotencyKey: string): Promise<ActiveBan> {
  const normalized = normalizeBanMutation(input);
  if (!normalized || !idempotencyKey.trim()) throw new Error('Заполните данные блокировки');
  const payload = await api.put<BanSaved>(`${roomModerationUrl(roomId)}/bans`, normalized, {
    headers: { 'Idempotency-Key': idempotencyKey }
  });
  const ban = normalizeActiveBan(payload.ban);
  if (!ban) throw new Error('Сервер вернул некорректную блокировку');
  return ban;
}

export async function unban(roomId: string, banId: string): Promise<ActiveBan> {
  const payload = await api.delete<BanLifted>(`${roomModerationUrl(roomId)}/bans/${encodeURIComponent(banId)}`);
  const ban = normalizeActiveBan(payload.ban);
  if (!ban) throw new Error('Сервер вернул некорректный ответ');
  return ban;
}

export async function deleteModeratedMessage(roomId: string, messageId: string): Promise<void> {
  await api.delete<MessageRemoved>(`${roomModerationUrl(roomId)}/messages/${encodeURIComponent(messageId)}`);
}
