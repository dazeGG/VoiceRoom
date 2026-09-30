// Pinned messages wired together: the pin list and its broadcast on the room
// detail stream (the pinned bar is shared state, not a per-viewer view).

import type pg from 'pg';
import type { ServerEnvelope } from '@voice-room/shared/realtime';
import { createPinRepository } from './pin.repository.ts';
import { createPinService } from './pin.service.ts';

export interface PinsModuleDeps {
  pool: pg.Pool;
  roomExists: (roomId: string) => Promise<boolean>;
  broadcastRoomDetail: (roomId: string, envelope: ServerEnvelope) => void;
}

export function createPinsModule(deps: PinsModuleDeps) {
  const service = createPinService({
    repository: createPinRepository({ client: deps.pool }),
    publish: async ({ roomId, action, messageId, pins, count }) => {
      if (!(await deps.roomExists(roomId))) return false;
      deps.broadcastRoomDetail(roomId, { type: 'room.pins', payload: { roomId, action, messageId, pins, count } });
      return true;
    }
  });
  return { service };
}

export type PinsModule = ReturnType<typeof createPinsModule>;
