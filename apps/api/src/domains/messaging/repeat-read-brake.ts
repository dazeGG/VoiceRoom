// A brake on a client that keeps asking for the same thing. A chat asks for a
// message's reactions once; the 2.6 web client asked again as soon as each
// answer arrived, for as long as the thread stayed open, which is hundreds of
// requests a second from one window. Such a client waits for every answer, so
// holding the repeats is what slows it down: a refusal sent at once would only
// be asked for again.

export interface RepeatReadBrakeOptions {
  /** Reads of one key that pass before the brake holds the next ones. */
  allowed?: number;
  /** A key nobody asked for this long starts afresh. */
  quietMs?: number;
  /** How long a repeat is held before it is refused. */
  holdMs?: number;
  /** Repeats held at once; past this they are refused without waiting. */
  maxHeld?: number;
  /** Keys remembered; the oldest go first. */
  maxKeys?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export type RepeatReadBrake = Readonly<{
  /** Answers whether the read may run; a repeat past the allowance is held first, then refused. */
  admit(key: string): Promise<boolean>;
}>;

export function createRepeatReadBrake({
  allowed = 8,
  quietMs = 20_000,
  holdMs = 25_000,
  maxHeld = 2_000,
  maxKeys = 50_000,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
}: RepeatReadBrakeOptions = {}): RepeatReadBrake {
  const seen = new Map<string, { count: number; last: number }>();
  let held = 0;

  async function admit(key: string): Promise<boolean> {
    const at = now();
    const known = seen.get(key);
    const entry = known && at - known.last < quietMs ? known : { count: 0, last: at };
    entry.count += 1;
    entry.last = at;
    // Re-inserting keeps the map ordered by last use, so the oldest key is first.
    seen.delete(key);
    seen.set(key, entry);
    if (seen.size > maxKeys) seen.delete(seen.keys().next().value as string);
    if (entry.count <= allowed) return true;

    if (held < maxHeld) {
      held += 1;
      try {
        await sleep(holdMs);
      } finally {
        held -= 1;
      }
    }
    return false;
  }

  return Object.freeze({ admit });
}
