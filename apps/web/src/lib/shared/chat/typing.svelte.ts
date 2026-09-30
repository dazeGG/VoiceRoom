// Mirrors TYPING_NOTICE_INTERVAL_MS, TYPING_NOTICE_TTL_MS and TYPING_ACTIVITIES
// in @voice-room/shared/realtime, a CommonJS module the browser bundle does not
// load; a web test keeps the two in step.
export const TYPING_NOTICE_INTERVAL_MS = 2500;
export const TYPING_NOTICE_TTL_MS = 6000;
export const TYPING_ACTIVITIES = ['typing', 'emoji'] as const;

export type TypingActivity = (typeof TYPING_ACTIVITIES)[number];

export interface TypingPerson {
  name: string;
  activity: TypingActivity;
}

/** Anything but a known activity is typing, as it was before activities existed. */
export function typingActivityOf(value: unknown): TypingActivity {
  return value === 'emoji' ? 'emoji' : 'typing';
}

const PLURAL_VERB: Record<TypingActivity, string> = { typing: 'печатают', emoji: 'выбирают эмодзи' };
const SINGLE_VERB: Record<TypingActivity, string> = { typing: 'печатает', emoji: 'выбирает эмодзи' };

function describe(names: readonly string[], activity: TypingActivity): string {
  if (names.length === 0) return '';
  if (names.length === 1) return `${names[0]} ${SINGLE_VERB[activity]}`;
  if (names.length === 2) return `${names[0]} и ${names[1]} ${PLURAL_VERB[activity]}`;
  return `${names.slice(0, -1).join(', ')} и ${names[names.length - 1]} ${PLURAL_VERB[activity]}`;
}

export function formatTypingLabel(people: readonly TypingPerson[]): string {
  const visible = people
    .map((person) => ({ name: person.name.trim(), activity: typingActivityOf(person.activity) }))
    .filter((person) => person.name);
  if (visible.length === 0) return '';
  if (visible.length > 3) return 'Несколько человек печатают…';
  const clauses = TYPING_ACTIVITIES.map((activity) =>
    describe(
      visible.filter((person) => person.activity === activity).map((person) => person.name),
      activity
    )
  ).filter(Boolean);
  return `${clauses.join(', ')}…`;
}

// Sends a notice at most once per interval while someone keeps typing or
// browsing emoji. Switching between the two is announced right away.
export function createTypingNotifier(
  send: (activity: TypingActivity) => void,
  { intervalMs = TYPING_NOTICE_INTERVAL_MS, now = Date.now }: { intervalMs?: number; now?: () => number } = {}
) {
  let lastSentAt = -Infinity;
  let lastActivity: TypingActivity | null = null;
  return {
    notify(activity: TypingActivity = 'typing'): void {
      const at = now();
      if (activity === lastActivity && at - lastSentAt < intervalMs) return;
      lastSentAt = at;
      lastActivity = activity;
      send(activity);
    },
    // After sending a message or switching chats the next keystroke announces
    // typing again right away.
    reset(): void {
      lastSentAt = -Infinity;
      lastActivity = null;
    }
  };
}

interface TypingEntry extends TypingPerson {
  key: string;
  expiresAt: number;
}

// Who is typing, keyed by person. An entry goes away when that person's
// message arrives or TTL after their last notice.
export function createTypingTracker({
  ttlMs = TYPING_NOTICE_TTL_MS,
  now = Date.now
}: { ttlMs?: number; now?: () => number } = {}) {
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
    get people(): TypingPerson[] {
      return entries.map(({ name, activity }) => ({ name, activity }));
    },
    has(key: string): boolean {
      return entries.some((entry) => entry.key === key);
    },
    activityOf(key: string): TypingActivity | null {
      return entries.find((entry) => entry.key === key)?.activity ?? null;
    },
    note(key: string, name = '', activity: TypingActivity = 'typing'): void {
      if (!key) return;
      entries = [...entries.filter((entry) => entry.key !== key), { key, name, activity, expiresAt: now() + ttlMs }];
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
