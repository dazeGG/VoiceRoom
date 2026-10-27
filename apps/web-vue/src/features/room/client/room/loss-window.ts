// Packet loss (and audible concealment) over the last few stats polls rather
// than one. While someone is silent, Opus sends only a couple of packets a
// second (DTX), so over a single 3-second poll one lost packet would read as
// 12 % and a good line would look broken. Too little in the window says
// nothing at all.

/** Polls the loss is counted over (PEER_LATENCY_INTERVAL_MS apart): about 15 seconds. */
export const LOSS_WINDOW_POLLS = 5;
/** Fewer packets than this in the window give no loss figure: a second of speech is 50. */
export const LOSS_MIN_PACKETS = 50;
/** Fewer played samples than this give no concealment figure: a second at 48 kHz. */
export const CONCEALMENT_MIN_SAMPLES = 48_000;

export const createLossWindow = () => createRatioWindow(LOSS_MIN_PACKETS);
export const createConcealmentWindow = () => createRatioWindow(CONCEALMENT_MIN_SAMPLES);

/** A share counted over the last LOSS_WINDOW_POLLS polls, once their total reaches `minTotal`. */
export function createRatioWindow(minTotal: number) {
  let polls: { lost: number; total: number }[] = [];

  /**
   * Adds one poll's part (lost packets, made-up samples) and its whole (all
   * packets or samples, the part included); answers the share over the window
   * in percent, one decimal, or null while the window holds too little.
   */
  function add(lost: number, total: number): number | null {
    polls = [...polls, { lost: Math.max(0, lost), total: Math.max(0, total) }].slice(-LOSS_WINDOW_POLLS);
    const sum = polls.reduce((acc, poll) => ({ lost: acc.lost + poll.lost, total: acc.total + poll.total }), {
      lost: 0,
      total: 0
    });
    if (sum.total < minTotal) return null;
    return Math.round((Math.min(sum.lost, sum.total) / sum.total) * 1000) / 10;
  }

  /** A new call counts from nothing. */
  function reset(): void {
    polls = [];
  }

  return { add, reset };
}
