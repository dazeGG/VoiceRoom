// What a section tells the frame around it: a title of its own (an account's
// card names the account) and how fresh its numbers are, for the top bar's
// "Обновлено N с назад" and its refresh button. Outside the frame (in tests of
// a single section) both are quietly ignored.

import { createContext, useContext, useEffect } from 'react';
import type { RefreshStatus } from './frame.ts';

export type { RefreshStatus } from './frame.ts';

export interface Frame {
  setTitle: (title: string | null) => void;
  setRefresh: (status: RefreshStatus | null) => void;
}

const quiet: Frame = { setTitle: () => {}, setRefresh: () => {} };

export const FrameContext = createContext<Frame>(quiet);

/** The top bar's title while this section is on screen; null keeps the section's name. */
export function usePageTitle(title: string | null): void {
  const { setTitle } = useContext(FrameContext);
  useEffect(() => {
    setTitle(title);
    return () => setTitle(null);
  }, [title, setTitle]);
}

/** The top bar's refresh status while this section is on screen. `reload` must keep its identity. */
/** The same as the hook, for a page that reports it only in one of its views. */
export function RefreshReport(status: RefreshStatus): null {
  useRefreshStatus(status);
  return null;
}

export function useRefreshStatus({ at, everyMs, busy, reload, what }: RefreshStatus): void {
  const { setRefresh } = useContext(FrameContext);
  useEffect(() => {
    setRefresh({ at, everyMs, busy, reload, ...(what ? { what } : {}) });
  }, [at, everyMs, busy, reload, what, setRefresh]);
  useEffect(() => () => setRefresh(null), [setRefresh]);
}
