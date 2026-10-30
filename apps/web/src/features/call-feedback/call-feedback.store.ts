// "How was the call?": after someone leaves a call on purpose, the app now and
// then asks for a thumbs up or down. It asks only about a call that was worth
// asking about (a minute or more, with somebody else in it), at most once in
// three days, and backs off further every time the question is closed without
// an answer, so someone who never answers is asked about once a month.
//
// The room client notes every call that ends (noteCallFinished); the leave
// actions then offer the question (offerCallFeedback). Leaving the room page
// for the lobby is a full page load, so the question waits for it in
// sessionStorage and the next page picks it up (restorePendingCallFeedback).

import { defineStore } from 'pinia';
import { ref } from 'vue';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { CallFeedbackCall } from '@voice-room/shared/contracts/feedback';
import { submitCallFeedback, type CallFeedbackRating, type CallFeedbackTag } from '@/api/feedback';
import { createLogger, errorContext } from '@/shared/log';

const log = createLogger('call-feedback');

const DAY_MS = 24 * 60 * 60 * 1000;
export const FEEDBACK_MIN_CALL_S = 60;
export const FEEDBACK_ASK_INTERVAL_MS = 3 * DAY_MS;
export const FEEDBACK_MAX_INTERVAL_MS = 30 * DAY_MS;
/** A call noted longer ago than this did not end with the leave being offered. */
const FINISHED_CALL_TTL_MS = 10_000;
/** The page after a leave loads within seconds; an older question is dropped. */
const PENDING_TTL_MS = 5 * 60 * 1000;

const HISTORY_KEY = 'voice-room:call-feedback';
const PENDING_KEY = 'voice-room:call-feedback:pending';

export interface AskHistory {
  lastAskedAt: number;
  /** Questions closed without an answer since the last answer. */
  skipped: number;
}

/** What localStorage holds; a skip count that does not read as a number counts as none. */
const StoredAskHistory = Type.Object({ lastAskedAt: Type.Number(), skipped: Type.Optional(Type.Unknown()) });

/** The question a leave left waiting for the next page. */
const PendingQuestion = Type.Object({ call: CallFeedbackCall, at: Type.Number() });

/** When the next question may come: three days after the last, doubling with every one skipped, at most a month. */
export function nextAskAt(history: AskHistory | null): number {
  if (!history) return 0;
  return history.lastAskedAt + Math.min(FEEDBACK_ASK_INTERVAL_MS * 2 ** history.skipped, FEEDBACK_MAX_INTERVAL_MS);
}

export function worthAsking(call: CallFeedbackCall, history: AskHistory | null, now: number): boolean {
  return call.durationS >= FEEDBACK_MIN_CALL_S && call.peers > 0 && now >= nextAskAt(history);
}

function readJson(storage: () => Storage, key: string): unknown {
  try {
    const raw = storage().getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(storage: () => Storage, key: string, value: unknown): void {
  try {
    if (value === null) storage().removeItem(key);
    else storage().setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be off (private mode, blocked site data): the question
    // then just comes back sooner or does not survive the page load.
  }
}

const session = () => sessionStorage;

// Without localStorage the wait still holds for as long as the page is open.
let historyInMemory: AskHistory | null = null;

function readHistory(): AskHistory | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(HISTORY_KEY);
  } catch {
    return historyInMemory;
  }
  let history: unknown;
  try {
    history = raw ? JSON.parse(raw) : null;
  } catch {
    history = null;
  }
  if (!Value.Check(StoredAskHistory, history)) return null;
  return { lastAskedAt: history.lastAskedAt, skipped: Number(history.skipped) || 0 };
}

function writeHistory(history: AskHistory): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    historyInMemory = history;
  }
}

export const useCallFeedbackStore = defineStore('call-feedback', () => {
  /** The call the question is about now; null when nothing is asked. */
  const call = ref<CallFeedbackCall | null>(null);

  let finished: { call: CallFeedbackCall; at: number } | null = null;

  /**
   * The room client's account of a call that just ended, whatever ended it;
   * null for a leave before the call was up, so no earlier call stands in for it.
   */
  function noteCallFinished(ended: CallFeedbackCall | null, now = Date.now()): void {
    finished = ended ? { call: ended, at: now } : null;
  }

  /** After the person left a call themselves: asks about it when it is worth asking. */
  function offerCallFeedback(now = Date.now()): void {
    const last = finished;
    finished = null;
    if (!last || now - last.at > FINISHED_CALL_TTL_MS) return;
    const history = readHistory();
    if (!worthAsking(last.call, history, now)) return;
    writeHistory({ lastAskedAt: now, skipped: history?.skipped ?? 0 });
    writeJson(session, PENDING_KEY, { call: last.call, at: now });
    call.value = last.call;
  }

  /** On a page load: the question a leave on the previous page left waiting. */
  function restorePendingCallFeedback(now = Date.now()): void {
    const pending = readJson(session, PENDING_KEY);
    writeJson(session, PENDING_KEY, null);
    if (Value.Check(PendingQuestion, pending) && now - pending.at <= PENDING_TTL_MS) {
      call.value = pending.call;
    }
  }

  function close(): CallFeedbackCall | null {
    const closed = call.value;
    call.value = null;
    writeJson(session, PENDING_KEY, null);
    return closed;
  }

  /** Sends the answer; the person sees their thanks whether or not it arrives. */
  async function answerCallFeedback(answer: {
    rating: CallFeedbackRating;
    tags: CallFeedbackTag[];
    comment: string;
  }): Promise<void> {
    const closed = close();
    if (!closed) return;
    const history = readHistory();
    if (history) writeHistory({ ...history, skipped: 0 });
    try {
      const { comment, ...rest } = answer;
      const note = comment.trim();
      await submitCallFeedback({ ...rest, ...(note ? { comment: note } : {}), call: closed });
    } catch (error) {
      log.warn('call feedback not sent', errorContext(error));
    }
  }

  /** Closed without an answer: the next question waits longer. */
  function skipCallFeedback(): void {
    if (!close()) return;
    const history = readHistory();
    if (history) writeHistory({ ...history, skipped: history.skipped + 1 });
  }

  /**
   * Put away without counting as a skip: a new call started, so the open
   * question would be about the wrong call, or it went unseen for a minute.
   */
  function dropCallFeedback(): void {
    finished = null;
    close();
  }

  return {
    call,
    noteCallFinished,
    offerCallFeedback,
    restorePendingCallFeedback,
    answerCallFeedback,
    skipCallFeedback,
    dropCallFeedback
  };
});
