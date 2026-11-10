import { extractRoomId as extractRoomIdAt } from '@voice-room/shared/app-home';

/** The room id in a typed code or pasted link; links are read against this page's origin. */
export function extractRoomId(value: string): string {
  return extractRoomIdAt(value, window.location.origin);
}
