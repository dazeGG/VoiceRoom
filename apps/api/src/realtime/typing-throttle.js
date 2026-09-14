'use strict';

// Typing notices are hints, so each target a connection types to (a room or a
// friend) gets at most one forward a second. A repeat of the same activity
// inside that second is dropped: the client repeats it on its own. A change of
// activity is held until the second is up and then sent with whatever the
// person is doing by then, so the other side never keeps showing "выбирает
// эмодзи" after they went back to typing, and alternating activities still
// cannot get past the budget.
const TYPING_FORWARD_MIN_MS = 1000;

function createTypingThrottle({
  minIntervalMs = TYPING_FORWARD_MIN_MS,
  now = Date.now,
  setTimer = setTimeout
} = {}) {
  const targets = new Map();

  function send(entry, activity, forward) {
    entry.at = now();
    entry.activity = activity;
    forward(activity);
  }

  // Returns whether the notice went out right away.
  function offer(key, activity, forward) {
    let entry = targets.get(key);
    if (!entry) {
      entry = { at: -Infinity, activity: null, pending: null, timer: null };
      targets.set(key, entry);
    }
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

  return { offer };
}

module.exports = {
  TYPING_FORWARD_MIN_MS,
  createTypingThrottle
};
