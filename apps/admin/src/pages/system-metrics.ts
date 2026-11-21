import type { SystemSample } from '@voice-room/shared/contracts/admin';

export function percent(used: number | null, total: number | null): number | null {
  return used !== null && total ? (used / total) * 100 : null;
}

/** Fewer packets than this in a point give no loss figure: a few seconds of one voice. */
export const MEDIA_MIN_PACKETS = 500;

/** Lost packets over all of them, in percent; null where there were too few to tell. */
function lossShare(lost: number | null, packets: number | null): number | null {
  if (lost === null || packets === null || packets < MEDIA_MIN_PACKETS) return null;
  return (Math.min(lost, packets) / packets) * 100;
}

/** On the way in LiveKit counts what arrived; the lost packets come on top. */
export const lossIn = (sample: SystemSample) =>
  lossShare(sample.sfuLostIn, sample.sfuPacketsIn === null ? null : sample.sfuPacketsIn + (sample.sfuLostIn ?? 0));
/** On the way out the listeners' receivers report what never reached them of all that was sent. */
export const lossOut = (sample: SystemSample) => lossShare(sample.sfuLostOut, sample.sfuPacketsOut);
