// Which simulcast layer of someone's camera this viewer needs, by how big
// their tile is: the spotlight gets the top layer, a roomy grid the middle
// one, and a crowded grid or the strip under a screen the smallest.

export type CameraReceiverDemand = 'high' | 'medium' | 'low';

/** Up to this many people the grid has two columns and roomy tiles. */
const ROOMY_GRID_PARTICIPANTS = 4;

export function getCameraReceiverDemand(
  peerId: string,
  {
    focusedPeerId,
    participantCount,
    screenOnStage
  }: { focusedPeerId: string; participantCount: number; screenOnStage: boolean }
): CameraReceiverDemand {
  if (focusedPeerId && focusedPeerId === peerId) return 'high';
  if (screenOnStage || focusedPeerId) return 'low';
  return participantCount <= ROOMY_GRID_PARTICIPANTS ? 'medium' : 'low';
}
