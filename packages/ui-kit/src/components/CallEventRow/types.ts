export type CallEventKind = 'outgoing' | 'incoming' | 'missed' | 'no-answer' | 'declined' | 'live';
export type CallEventAction = 'callback' | 'join' | 'return';

export interface CallEventRowProps {
  kind: CallEventKind;
  direction?: 'outgoing' | 'incoming';
  /** Formatted local time for a finished event and optional machine-readable equivalent. */
  time?: string;
  dateTime?: string;
  /** Total time both participants were in a completed call. */
  durationMs?: number;
  /** Origin of the live timer as a Unix timestamp in milliseconds. */
  startedAt?: number;
  peerName?: string;
  joined?: boolean;
  /** Hide the action when it is unavailable to the viewer. */
  showAction?: boolean;
}
