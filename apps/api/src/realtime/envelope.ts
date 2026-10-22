import {
  parseClientEnvelope,
  buildServerEnvelope,
  buildServerErrorEnvelope,
  validateClientCommand
} from '@voice-room/shared/realtime';
import type { ServerEnvelope } from '@voice-room/shared/realtime';

type EnvelopeSocket = { readyState: number; send(data: string): void };

function sendWsEnvelope(socket: EnvelopeSocket | null | undefined, envelope: ServerEnvelope): boolean {
  if (!socket || socket.readyState !== 1) return false;
  try {
    socket.send(JSON.stringify(envelope));
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
