import {
  parseClientEnvelope,
  buildServerEnvelope,
  buildServerErrorEnvelope,
  validateClientCommand
} from '@voice-room/shared/realtime';
import type { ServerEnvelope } from '@voice-room/shared/realtime';

type EnvelopeSocket = { readyState: number; bufferedAmount?: number; send(data: string): void };

function sendWsEnvelope(
  socket: EnvelopeSocket | null | undefined,
  envelope: ServerEnvelope,
  maxBufferedBytes?: number
): boolean {
  if (!socket || socket.readyState !== 1) return false;
  try {
    const data = JSON.stringify(envelope);
    if (maxBufferedBytes !== undefined && (socket.bufferedAmount ?? 0) + Buffer.byteLength(data) > maxBufferedBytes) {
      return false;
    }
    socket.send(data);
    return true;
  } catch {
    return false;
  }
}

function parseInboundMessage(raw: unknown): ReturnType<typeof validateClientCommand> {
  const parsed = parseClientEnvelope(raw);
  if (!parsed.ok) return parsed;
  return validateClientCommand(parsed.envelope);
}

export { buildServerEnvelope, buildServerErrorEnvelope, parseInboundMessage, sendWsEnvelope };
