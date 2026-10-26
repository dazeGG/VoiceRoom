import type pg from 'pg';
import type { PinnedMessage } from '@voice-room/shared/contracts/messages';
import type { PinAction } from '@voice-room/shared/contracts/realtime';
import { DomainError } from '../../platform/http/domain-error.ts';
import type { createPinRepository } from './pin.repository.ts';
// Any room participant may pin, so the only guard against a room turning into
// an unbounded pin list is this cap. Discord uses 50; matching it keeps the
// pinned bar scrollable rather than endless.
const MAX_PINS_PER_ROOM = 50;

type PinSnapshot = { pins: PinnedMessage[]; count: number };
type Viewer = { id?: string; guest?: boolean; isGuest?: boolean } | null | undefined;

export type PinRepository = Pick<
  ReturnType<typeof createPinRepository>,
  'countPins' | 'findVisibleMessage' | 'listPins' | 'lockRoom' | 'pin' | 'transaction' | 'unpin'
>;
type Client = Pick<pg.PoolClient, 'query'> | null;

export type PinEvent = PinSnapshot & {
  roomId: string;
  action: PinAction;
  messageId: string;
  actorUserId: string | null;
};

export type PinService = Readonly<{
  list(input?: { roomId?: unknown }): Promise<PinSnapshot>;
  pin(input?: { roomId?: unknown; messageId?: unknown; viewer?: Viewer }): Promise<PinSnapshot>;
  refresh(input?: { roomId?: unknown; action?: PinAction; messageId?: string }): Promise<PinSnapshot>;
  unpin(input?: { roomId?: unknown; messageId?: unknown; viewer?: Viewer }): Promise<PinSnapshot>;
}>;

function normalizeRoomId(value: unknown): string {
  const roomId = typeof value === 'string' ? value.trim() : '';
  if (!roomId || roomId.length > 48) {
    throw new DomainError('invalid_room', 400, 'Invalid room');
  }
  return roomId;
}

function normalizeMessageId(value: unknown): string {
  const messageId = typeof value === 'string' ? value.trim() : '';
  if (!messageId || messageId.length > 64) {
    throw new DomainError('invalid_message', 400, 'Invalid message');
  }
  return messageId;
}

function requireAccount(viewer: Viewer): { id: string } {
  if (!viewer?.id || viewer.guest === true || viewer.isGuest === true) {
    throw new DomainError('account_required', 403, 'Account required');
  }
  return { id: viewer.id };
}

function createPinService({
  repository,
  publish,
  maxPins = MAX_PINS_PER_ROOM
}: {
  repository: PinRepository;
  publish: (event: PinEvent) => unknown;
  maxPins?: number;
}): PinService {
  async function snapshot(roomId: string, client: Client = null): Promise<PinSnapshot> {
    const listed = await repository.listPins({ roomId, limit: maxPins, client });
    return { pins: listed, count: listed.length };
  }

  async function list({ roomId: rawRoomId }: { roomId?: unknown } = {}): Promise<PinSnapshot> {
    const roomId = normalizeRoomId(rawRoomId);
    return snapshot(roomId);
  }

  async function pin({
    roomId: rawRoomId,
    messageId: rawMessageId,
    viewer
  }: { roomId?: unknown; messageId?: unknown; viewer?: Viewer } = {}): Promise<PinSnapshot> {
    const roomId = normalizeRoomId(rawRoomId);
    const messageId = normalizeMessageId(rawMessageId);
    const account = requireAccount(viewer);

    const mutation = await repository.transaction(async (client) => {
      await repository.lockRoom({ roomId, client });
      const visible = await repository.findVisibleMessage({ roomId, messageId, client });
      if (!visible) throw new DomainError('message_not_found', 404, 'Message is not available');

      // The room-scoped transaction lock makes count + insert one atomic cap
      // decision even when many users pin different messages concurrently.
      const count = await repository.countPins({ roomId, client });
      if (count >= maxPins) {
        const already = await repository.listPins({ roomId, limit: maxPins, client });
        if (!already.some((entry) => entry.messageId === messageId)) {
          throw new DomainError('pin_limit_reached', 409, `В комнате уже ${maxPins} закреплённых сообщений`);
        }
      }

      const result = await repository.pin({ roomId, messageId, userId: account.id, client });
      return { changed: result.changed, snapshot: await snapshot(roomId, client) };
    });
    if (mutation.changed) {
      await publish({ roomId, action: 'pinned', messageId, actorUserId: account.id, ...mutation.snapshot });
    }
    return mutation.snapshot;
  }

  async function unpin({
    roomId: rawRoomId,
    messageId: rawMessageId,
    viewer
  }: { roomId?: unknown; messageId?: unknown; viewer?: Viewer } = {}): Promise<PinSnapshot> {
    const roomId = normalizeRoomId(rawRoomId);
    const messageId = normalizeMessageId(rawMessageId);
    const account = requireAccount(viewer);

    const mutation = await repository.transaction(async (client) => {
      await repository.lockRoom({ roomId, client });
      const result = await repository.unpin({ roomId, messageId, client });
      return { changed: result.changed, snapshot: await snapshot(roomId, client) };
    });
    if (mutation.changed) {
      await publish({ roomId, action: 'unpinned', messageId, actorUserId: account.id, ...mutation.snapshot });
    }
    return mutation.snapshot;
  }

  async function refresh({
    roomId: rawRoomId,
    action = 'refreshed',
    messageId = ''
  }: { roomId?: unknown; action?: PinAction; messageId?: string } = {}): Promise<PinSnapshot> {
    const roomId = normalizeRoomId(rawRoomId);
    const current = await snapshot(roomId);
    await publish({ roomId, action, messageId, actorUserId: null, ...current });
    return current;
  }

  return Object.freeze({ list, pin, refresh, unpin });
}

export { createPinService };
