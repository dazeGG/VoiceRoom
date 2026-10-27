import { textOf } from '@voice-room/shared/guards';

export function cleanDisplayName(value: unknown): string {
  return textOf(value).replace(/\s+/g, ' ').trim().slice(0, 40);
}
