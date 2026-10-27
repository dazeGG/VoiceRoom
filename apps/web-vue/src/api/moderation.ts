import { BanBody, BanLifted, BanPage, BanSaved, type Ban } from '@voice-room/shared/contracts/moderation';
import {
  MODERATION_DEFAULT_LIMIT,
  MODERATION_MAX_LIMIT,
  normalizeBanMutation,
  type BanMutation
} from '@voice-room/shared/moderation';
import { api } from './client';

export type { Ban, BanPage } from '@voice-room/shared/contracts/moderation';
export type { BanMutation, ModerationDuration } from '@voice-room/shared/moderation';

function roomModerationUrl(roomId: string): string {
  return `/api/rooms/${encodeURIComponent(roomId)}/moderation`;
}

export async function fetchActiveBans(
  roomId: string,
  { cursor, limit = MODERATION_DEFAULT_LIMIT }: { cursor?: string | undefined; limit?: number } = {}
): Promise<BanPage> {
  const boundedLimit = Math.min(MODERATION_MAX_LIMIT, Math.max(1, Math.trunc(limit)));
  const query = new URLSearchParams({ limit: String(boundedLimit) });
  if (cursor) query.set('cursor', cursor);
  return api.get(`${roomModerationUrl(roomId)}/bans?${query}`, BanPage);
}

export async function putBan(roomId: string, input: BanMutation, idempotencyKey: string): Promise<Ban> {
  const normalized = normalizeBanMutation(input);
  if (!normalized || !idempotencyKey.trim()) throw new Error('Заполните данные блокировки');
  const { ban } = await api.put(`${roomModerationUrl(roomId)}/bans`, BanSaved, normalized, {
    bodySchema: BanBody,
    headers: { 'Idempotency-Key': idempotencyKey }
  });
  // The undo needs the saved ban; an answer without one leaves nothing to undo.
  if (!ban) throw new Error('Не удалось заблокировать участника');
  return ban;
}

export async function unban(roomId: string, banId: string): Promise<void> {
  await api.delete(`${roomModerationUrl(roomId)}/bans/${encodeURIComponent(banId)}`, BanLifted);
}
