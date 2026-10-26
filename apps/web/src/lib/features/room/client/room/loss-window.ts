// Packet loss over the last few stats polls rather than one. While someone is
// silent, Opus sends only a couple of packets a second (DTX), so over a single
// 3-second poll one lost packet would read as 12 % and a good line would look
// broken. Too few packets in the window say nothing at all.

/** Polls the loss is counted over (PEER_LATENCY_INTERVAL_MS apart): about 15 seconds. */
export const LOSS_WINDOW_POLLS = 5;
/** Fewer packets than this in the window give no loss figure: a second of speech is 50. */
export const LOSS_MIN_PACKETS = 50;

export function createLossWindow() {
  let polls: { lost: number; total: number }[] = [];

  /**
   * Adds one poll's lost packets and all the packets it accounted for (lost
   * included); answers the loss over the window in percent, one decimal, or
   * null while the window holds too few packets.
   */
  function add(lost: number, total: number): number | null {
    polls = [...polls, { lost: Math.max(0, lost), total: Math.max(0, total) }].slice(-LOSS_WINDOW_POLLS);
    const sum = polls.reduce((acc, poll) => ({ lost: acc.lost + poll.lost, total: acc.total + poll.total }), {
      lost: 0,
      total: 0
    });
    if (sum.total < LOSS_MIN_PACKETS) return null;
    return Math.round((Math.min(sum.lost, sum.total) / sum.total) * 1000) / 10;
  }

  /** A new call counts from nothing. */
  function reset(): void {
    polls = [];
  }

  return { add, reset };
}
