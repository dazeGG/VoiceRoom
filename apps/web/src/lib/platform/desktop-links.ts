export type DesktopLink =
  | { kind: 'room'; roomId: string }
  | { kind: 'mention'; roomId: string; messageId: string }
  | { kind: 'dm'; dmId: string }
  | { kind: 'app' };

// Same shapes the desktop shell accepts for voiceroom:// links.
const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{3,48}$/;
const ENTITY_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function getBridge(): Window['voiceRoomDesktopLinks'] | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.voiceRoomDesktopLinks;
}

function matches(pattern: RegExp, value: unknown): value is string {
  return typeof value === 'string' && pattern.test(value);
}

export function normalizeDesktopLink(value: unknown): DesktopLink | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  switch (source.kind) {
    case 'room':
      return matches(ROOM_ID_PATTERN, source.roomId) ? { kind: 'room', roomId: source.roomId } : null;
    case 'mention':
      return matches(ROOM_ID_PATTERN, source.roomId) && matches(ENTITY_ID_PATTERN, source.messageId)
        ? { kind: 'mention', roomId: source.roomId, messageId: source.messageId }
        : null;
    case 'dm':
      return matches(ENTITY_ID_PATTERN, source.dmId) ? { kind: 'dm', dmId: source.dmId } : null;
    case 'app':
      return { kind: 'app' };
    default:
      return null;
  }
}

export function desktopLinksAvailable(): boolean {
  return typeof getBridge()?.onOpen === 'function';
}

/**
 * Routes voiceroom:// links opened while the desktop app is running. Without a
 * subscription the shell reloads the page on the link's route instead.
 */
export function bindDesktopLinks(handler: (link: DesktopLink) => void): () => void {
  const bridge = getBridge();
  if (typeof bridge?.onOpen !== 'function') return () => {};
  const unsubscribe = bridge.onOpen((payload) => {
    const link = normalizeDesktopLink(payload);
    if (link) handler(link);
  });
  return typeof unsubscribe === 'function' ? unsubscribe : () => {};
}
