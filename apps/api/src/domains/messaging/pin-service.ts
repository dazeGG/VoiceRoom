import type pg from 'pg';
// Any room participant may pin, so the only guard against a room turning into
// an unbounded pin list is this cap. Discord uses 50; matching it keeps the
// pinned bar scrollable rather than endless.
const MAX_PINS_PER_ROOM = 50;

type Client = Pick<pg.PoolClient, 'query'> | null | undefined;
type Pin = { messageId: string; [key: string]: unknown };
type PinSnapshot = { pins: Pin[]; count: number };
type Viewer = { id?: string; guest?: boolean; isGuest?: boolean } | null | undefined;

export interface PinRepository {
  listPins(input: { roomId: string; limit: number; client: Client }): Promise<Pin[]>;
  pin(input: { roomId: string; messageId: string; userId: string; client: Client }): Promise<{ changed: boolean }>;
  unpin(input: { roomId: string; messageId: string; client: Client }): Promise<{ changed: boolean }>;
  countPins(input: { roomId: string; client: Client }): Promise<number>;
  findVisibleMessage(input: { roomId: string; messageId: string; client: Client }): Promise<boolean>;
  lockRoom?(input: { roomId: string; client: Client }): Promise<void>;
  transaction?<T>(callback: (client: Client) => Promise<T>): Promise<T>;
}

export type PinEvent = PinSnapshot & { roomId: string; action: string; messageId: string; actorUserId: string | null };

export type PinService = Readonly<{
  list(input?: { roomId?: unknown }): Promise<PinSnapshot>;
  pin(input?: { roomId?: unknown; messageId?: unknown; viewer?: Viewer }): Promise<PinSnapshot>;
  refresh(input?: { roomId?: unknown; action?: string; messageId?: string }): Promise<PinSnapshot>;
  unpin(input?: { roomId?: unknown; messageId?: unknown; viewer?: Viewer }): Promise<PinSnapshot>;
}>;

class PinServiceError extends Error {
  declare code: string;
  declare statusCode: number;

  constructor(message: string, code: string, statusCode: number) {
    super(message);
    this.name = 'PinServiceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function normalizeRoomId(value: unknown): string {
  const roomId = typeof value === 'string' ? value.trim() : '';
  if (!roomId || roomId.length > 48) {
    throw new PinServiceError('Invalid room', 'invalid_room', 400);
  }
  return roomId;
}

function normalizeMessageId(value: unknown): string {
  const messageId = typeof value === 'string' ? value.trim() : '';
  if (!messageId || messageId.length > 64) {
    throw new PinServiceError('Invalid message', 'invalid_message', 400);
  }
  return messageId;
}

function requireAccount(viewer: Viewer): { id: string } {
  if (!viewer?.id || viewer.guest === true || viewer.isGuest === true) {
    throw new PinServiceError('Account required', 'account_required', 403);
  }
  return viewer as { id: string };
}

function createPinService({
  repository,
  publish,
  maxPins = MAX_PINS_PER_ROOM
}: {
  repository?: PinRepository;
  publish?: (event: PinEvent) => unknown;
  maxPins?: number;
} = {}): PinService {
  if (!repository?.listPins || !repository?.pin || !repository?.unpin) {
    throw new TypeError('Pin repository is required');
  }
  const pins = repository;
  const publisher = typeof publish === 'function' ? publish : () => false;
  const transact =
    typeof pins.transaction === 'function'
      ? <T>(callback: (client: Client) => Promise<T>) => pins.transaction!(callback)
      : <T>(callback: (client: Client) => Promise<T>) => callback(null);

  async function snapshot(roomId: string, client: Client = null): Promise<PinSnapshot> {
    const listed = await pins.listPins({ roomId, limit: maxPins, client });
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

    const mutation = await transact(async (client) => {
      await pins.lockRoom?.({ roomId, client });
      const visible = await pins.findVisibleMessage({ roomId, messageId, client });
      if (!visible) throw new PinServiceError('Message is not available', 'message_not_found', 404);

      // The room-scoped transaction lock makes count + insert one atomic cap
      // decision even when many users pin different messages concurrently.
      const count = await pins.countPins({ roomId, client });
      if (count >= maxPins) {
        const already = await pins.listPins({ roomId, limit: maxPins, client });
        if (!already.some((entry) => entry.messageId === messageId)) {
          throw new PinServiceError(`В комнате уже ${maxPins} закреплённых сообщений`, 'pin_limit_reached', 409);
        }
      }

      const result = await pins.pin({ roomId, messageId, userId: account.id, client });
      return { changed: result.changed, snapshot: await snapshot(roomId, client) };
    });
    if (mutation.changed) {
      await publisher({ roomId, action: 'pinned', messageId, actorUserId: account.id, ...mutation.snapshot });
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

    const mutation = await transact(async (client) => {
      await pins.lockRoom?.({ roomId, client });
      const result = await pins.unpin({ roomId, messageId, client });
      return { changed: result.changed, snapshot: await snapshot(roomId, client) };
    });
    if (mutation.changed) {
      await publisher({ roomId, action: 'unpinned', messageId, actorUserId: account.id, ...mutation.snapshot });
    }
    return mutation.snapshot;
  }

  async function refresh({
    roomId: rawRoomId,
    action = 'refreshed',
    messageId = ''
  }: { roomId?: unknown; action?: string; messageId?: string } = {}): Promise<PinSnapshot> {
    const roomId = normalizeRoomId(rawRoomId);
    const current = await snapshot(roomId);
    await publisher({ roomId, action, messageId, actorUserId: null, ...current });
    return current;
  }

  return Object.freeze({ list, pin, refresh, unpin });
}

export { MAX_PINS_PER_ROOM, PinServiceError, createPinService };
