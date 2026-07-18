export type ScreenReceiverDemand = 'hidden' | 'preview' | 'stage';

export function getScreenReceiverDemand(
  peerId: string,
  viewedScreenPeerId: string,
  subscribedPeerIds: ReadonlySet<string>
): ScreenReceiverDemand {
  if (!peerId) return 'hidden';
  if (viewedScreenPeerId === peerId) return 'stage';
  if (subscribedPeerIds.has(peerId)) return 'preview';
  return 'hidden';
}
