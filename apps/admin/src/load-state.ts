// What a section loads from the API and shows meanwhile: the last answer, why
// the latest request failed, whether one is out, and when it last heard back.

import { useCallback, useEffect, useEffectEvent, useRef, useState, type DependencyList } from 'react';
import { ApiError } from './api/client.ts';

export type LoadFailure = { kind: 'forbidden' | 'failed'; message: string };

export function loadFailure(cause: unknown, fallback: string): LoadFailure {
  if (cause instanceof ApiError && cause.status === 403) return { kind: 'forbidden', message: '' };
  return { kind: 'failed', message: cause instanceof Error && cause.message ? cause.message : fallback };
}

export interface AdminResource<T> {
  /** The last answer; null before the first. A failed request keeps it. */
  data: T | null;
  /** Why the latest request failed; null once one succeeds. */
  failure: LoadFailure | null;
  /** A request is out. */
  busy: boolean;
  /** When the last answer came, for the top bar; null before the first. */
  loadedAt: number | null;
  /** When the section last heard back: an answer, a failure or a change put in through `update`. */
  heardAt: number | null;
  /** Asks again now; keeps its identity. */
  reload: () => void;
  /** Puts a fresher copy in place, such as what an action answered with. */
  update: (change: (current: T | null) => T) => void;
}

interface ResourceState<T> {
  deps: DependencyList;
  /** The request wanted now. */
  round: number;
  /** The request last heard back from; it is busy while that is not the wanted one. */
  answered: number;
  data: T | null;
  failure: LoadFailure | null;
  loadedAt: number | null;
  heardAt: number | null;
}

const sameDeps = (a: DependencyList, b: DependencyList) =>
  a.length === b.length && a.every((value, index) => Object.is(value, b[index]));

/**
 * Loads with `fetcher` now and again whenever one of `deps` changes, on `reload`, and every
 * `refreshMs` when given. A newer request drops the answer of an older one; the poll waits for
 * the request out instead of piling on, and a hidden tab does not ask.
 */
export function useAdminResource<T>(
  fetcher: () => Promise<T>,
  deps: DependencyList,
  { failureText, refreshMs }: { failureText: string; refreshMs?: number }
): AdminResource<T> {
  const [state, setState] = useState<ResourceState<T>>(() => ({
    deps,
    round: 0,
    answered: -1,
    data: null,
    failure: null,
    loadedAt: null,
    heardAt: null
  }));
  // Other inputs are a new request, counted while rendering so it is busy at once.
  if (!sameDeps(state.deps, deps)) setState({ ...state, deps, round: state.round + 1 });

  // The last round whose request went out, and the rounds as last rendered, for the poll.
  const started = useRef(-1);
  const rendered = useRef({ round: state.round, answered: state.answered });
  useEffect(() => {
    rendered.current = { round: state.round, answered: state.answered };
  });

  const load = useEffectEvent((round: number) => {
    started.current = round;
    fetcher().then(
      (data) => {
        const at = Date.now();
        setState((now) =>
          now.round === round ? { ...now, answered: round, data, failure: null, loadedAt: at, heardAt: at } : now
        );
      },
      (cause: unknown) => {
        const failure = loadFailure(cause, failureText);
        const at = Date.now();
        setState((now) => (now.round === round ? { ...now, answered: round, failure, heardAt: at } : now));
      }
    );
  });
  useEffect(() => {
    if (started.current < state.round) load(state.round);
  }, [state.round]);

  useEffect(() => {
    if (!refreshMs) return undefined;
    const timer = window.setInterval(() => {
      const { round, answered } = rendered.current;
      if (document.visibilityState !== 'visible' || answered !== round) return;
      // The poll's request goes out at once; a newer one asked meanwhile still wins.
      const next = round + 1;
      rendered.current = { round: next, answered };
      setState((now) => ({ ...now, round: Math.max(now.round, next) }));
      load(next);
    }, refreshMs);
    return () => window.clearInterval(timer);
  }, [refreshMs]);

  const reload = useCallback(() => setState((now) => ({ ...now, round: now.round + 1 })), []);
  const update = useCallback((change: (current: T | null) => T) => {
    const at = Date.now();
    setState((now) => ({ ...now, data: change(now.data), heardAt: at }));
  }, []);

  return {
    data: state.data,
    failure: state.failure,
    busy: state.answered !== state.round,
    loadedAt: state.loadedAt,
    heardAt: state.heardAt,
    reload,
    update
  };
}
