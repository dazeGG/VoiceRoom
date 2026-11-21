export interface HoverCardProps {
  ariaLabel?: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  /** For a card hosted separately from its trigger. */
  anchor?: HTMLElement | { getBoundingClientRect: () => DOMRect } | undefined;
  /** Keep a card opened by an external action interactive and dismissible. */
  pinned?: boolean;
}
