// A part of a page that folds away under its heading: the heading is a button,
// what it sums up and its link stay on the right while it is folded, and it
// comes back folded or not as it was left (localStorage, per page and section).

import { ChevronDown } from 'lucide-react';
import { useCallback, useId, useState, type ReactNode, type Ref } from 'react';
import './Section.css';

const storageKey = (page: string, section: string) => `vr-admin-section-${page}-${section}`;

function readOpen(page: string, section: string, fallback: boolean): boolean {
  try {
    const stored = window.localStorage.getItem(storageKey(page, section));
    return stored === null ? fallback : stored === 'open';
  } catch {
    return fallback;
  }
}

export interface SectionState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

/** Whether a section is open, for a page that also opens it itself (a link to what is inside). */
export function useSectionState(page: string, section: string, defaultOpen = true): SectionState {
  const [open, setShown] = useState(() => readOpen(page, section, defaultOpen));
  const setOpen = useCallback(
    (next: boolean) => {
      setShown(next);
      try {
        window.localStorage.setItem(storageKey(page, section), next ? 'open' : 'closed');
      } catch {
        // A browser that keeps nothing still folds it for now.
      }
    },
    [page, section]
  );
  return { open, setOpen };
}

export function Section({
  page,
  id,
  title,
  defaultOpen = true,
  state,
  summary,
  link,
  sectionRef,
  className = '',
  children
}: {
  /** The page and the section name where its state is kept. */
  page: string;
  id: string;
  title: ReactNode;
  defaultOpen?: boolean;
  /** Given when the page opens it itself; otherwise it keeps its own. */
  state?: SectionState;
  /** What it sums up, beside the heading. */
  summary?: ReactNode;
  /** On the far right: a link or a control. */
  link?: ReactNode;
  sectionRef?: Ref<HTMLElement>;
  className?: string;
  children: ReactNode;
}) {
  const own = useSectionState(page, id, defaultOpen);
  const { open, setOpen } = state ?? own;
  const uid = useId();
  const headingId = `${uid}-heading`;
  const bodyId = `${uid}-body`;
  return (
    <section className={`ui-fold ${className}`.trim()} aria-labelledby={headingId} ref={sectionRef}>
      <header className="ui-section-head">
        <h2 id={headingId}>
          <button
            type="button"
            className="ui-fold-toggle"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen(!open)}
          >
            <ChevronDown size={16} className="ui-fold-chevron" data-open={open} aria-hidden="true" />
            {title}
          </button>
        </h2>
        {summary}
        {link ? <span className="ui-fold-link">{link}</span> : null}
      </header>
      {/* What is inside stays mounted, so a row opened in it is still open when it unfolds. */}
      <div id={bodyId} className="ui-fold-body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}

/** A link in a heading or a card: it moves within the panel, so it is a button. */
export function TextLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="ui-text-link" onClick={onClick}>
      {children}
    </button>
  );
}
