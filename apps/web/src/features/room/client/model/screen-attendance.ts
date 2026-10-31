import type { Participant } from './participants';

// Presence intentionally tracks one actively selected remote stream. Media tile
// subscriptions may be plural, but moving the same stream between tile and
// spotlight must not change this attendance signal.
export function setScreenAttendance(self: Participant | null, peerId: string): boolean {
  if (!self || !peerId || self.viewedScreenPeerId === peerId) return false;
  self.viewedScreenPeerId = peerId;
  return true;
}

export function clearScreenAttendance(self: Participant | null, peerId: string): boolean {
  if (!self || self.viewedScreenPeerId !== peerId) return false;
  self.viewedScreenPeerId = '';
  return true;
}
