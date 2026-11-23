import type { LiveRoomPeer } from '@voiceroom/shared/contracts/admin';
import type { Tone } from '../../ui';

/** How many in a room have a voice worse than the norm, in the tone of the worst; null when nobody has. */
export function troubleOf(peers: readonly LiveRoomPeer[]): { count: number; tone: Tone } | null {
  const bad = peers.filter((peer) => peer.network === 'bad').length;
  const unstable = peers.filter((peer) => peer.network === 'unstable').length;
  if (!bad && !unstable) return null;
  return { count: bad + unstable, tone: bad ? 'danger' : 'warning' };
}
