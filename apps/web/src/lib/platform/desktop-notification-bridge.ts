// The desktop shell shows system notifications through this bridge. A browser,
// or a shell older than it, has none and notifications fall back to the page's
// Notification API.

export type DesktopNotificationBridge = NonNullable<Window['voiceRoomDesktopNotifications']>;

export function getDesktopNotificationBridge(): DesktopNotificationBridge | null {
  if (typeof window === 'undefined') return null;
  const bridge = window.voiceRoomDesktopNotifications;
  return bridge && typeof bridge.show === 'function' ? bridge : null;
}
