'use strict';

// Typing notices are hints, so each target a connection types to (a room or a
// friend) gets at most one forward a second. A repeat of the same activity
// inside that second is dropped: the client repeats it on its own. A change of
// activity is held until the second is up and then sent with whatever the
// person is doing by then, so the other side never keeps showing "выбирает
// эмодзи" after they went back to typing, and alternating activities still
// cannot get past the budget.
const TYPING_FORWARD_MIN_MS = 1000;
// A client names the targets it types to, so one connection must not be able
// to grow this map without end: the least recently used target is dropped,
// which costs at most one extra forward when that thread comes back.
const TYPING_TARGET_LIMIT = 64;

function createTypingThrottle({
  minIntervalMs = TYPING_FORWARD_MIN_MS,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  maxTargets = TYPING_TARGET_LIMIT
} = {}) {
  const targets = new Map();

  function remember(key, entry) {
    targets.delete(key);
    targets.set(key, entry);
    while (targets.size > maxTargets) {
      const [oldestKey, oldest] = targets.entries().next().value;
      if (oldest.timer) clearTimer(oldest.timer);
      targets.delete(oldestKey);
    }
  }

  function send(entry, activity, forward) {
    entry.at = now();
    entry.activity = activity;
    forward(activity);
  }

  // Returns whether the notice went out right away.
  function offer(key, activity, forward) {
    const entry = targets.get(key) || { at: -Infinity, activity: null, pending: null, timer: null };
    remember(key, entry);
    const wait = entry.at + minIntervalMs - now();
    if (wait <= 0 && !entry.timer) {
      send(entry, activity, forward);
      return true;
    }
    if (!entry.timer && activity === entry.activity) return false;
    entry.pending = { activity, forward };
    if (!entry.timer) {
      entry.timer = setTimer(() => {
        const latest = entry.pending;
        entry.timer = null;
        entry.pending = null;
        // Back where the last notice left them: the other side already shows
        // it, and a late copy could land after the message it belongs to.
        if (latest.activity !== entry.activity) send(entry, latest.activity, latest.forward);
      }, Math.max(0, wait));
      entry.timer.unref?.();
    }
    return false;
  }

  return { offer, size: () => targets.size };
}

module.exports = {
  TYPING_FORWARD_MIN_MS,
  TYPING_TARGET_LIMIT,
  createTypingThrottle
};
