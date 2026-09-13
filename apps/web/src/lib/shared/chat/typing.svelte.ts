// Mirrors TYPING_NOTICE_INTERVAL_MS and TYPING_NOTICE_TTL_MS in
// @voice-room/shared/realtime, a CommonJS module the browser bundle does not
// load; a web test keeps the two in step.
export const TYPING_NOTICE_INTERVAL_MS = 2500;
export const TYPING_NOTICE_TTL_MS = 6000;

export function formatTypingLabel(names: readonly string[]): string {
  const visible = names.map((name) => name.trim()).filter(Boolean);
  if (visible.length === 0) return '';
  if (visible.length === 1) return `${visible[0]} печатает…`;
  if (visible.length === 2) return `${visible[0]} и ${visible[1]} печатают…`;
  if (visible.length === 3) return `${visible[0]}, ${visible[1]} и ${visible[2]} печатают…`;
  return 'Несколько человек печатают…';
}

// Sends a notice at most once per interval while someone keeps typing.
export function createTypingNotifier(
  send: () => void,
  { intervalMs = TYPING_NOTICE_INTERVAL_MS, now = Date.now }: { intervalMs?: number; now?: () => number } = {}
) {
  let lastSentAt = -Infinity;
  return {
    notify(): void {
      const at = now();
      if (at - lastSentAt < intervalMs) return;
      lastSentAt = at;
      send();
    },
    // After sending a message or switching chats the next keystroke announces
    // typing again right away.
    reset(): void {
      lastSentAt = -Infinity;
    }
  };
}

interface TypingEntry {
  key: string;
  name: string;
  expiresAt: number;
}

// Who is typing, keyed by person. An entry goes away when that person's
// message arrives or TTL after their last notice.
export function createTypingTracker(
  { ttlMs = TYPING_NOTICE_TTL_MS, now = Date.now }: { ttlMs?: number; now?: () => number } = {}
) {
  let entries = $state<TypingEntry[]>([]);
  let timer: ReturnType<typeof setTimeout> | null = null;

  function schedule(): void {
    if (timer) clearTimeout(timer);
    timer = null;
    if (entries.length === 0) return;
    const nextExpiry = Math.min(...entries.map((entry) => entry.expiresAt));
    timer = setTimeout(prune, Math.max(0, nextExpiry - now()) + 20);
  }

  function prune(): void {
    const at = now();
    entries = entries.filter((entry) => entry.expiresAt > at);
    schedule();
  }

  return {
    get names(): string[] {
      return entries.map((entry) => entry.name);
    },
    has(key: string): boolean {
      return entries.some((entry) => entry.key === key);
    },
    note(key: string, name = ''): void {
      if (!key) return;
      entries = [...entries.filter((entry) => entry.key !== key), { key, name, expiresAt: now() + ttlMs }];
      schedule();
    },
    clear(key: string): void {
      if (!entries.some((entry) => entry.key === key)) return;
      entries = entries.filter((entry) => entry.key !== key);
      schedule();
    },
    prune,
    reset(): void {
      entries = [];
      schedule();
    }
  };
}
