import type { NotificationPreferences } from '@voice-room/shared/contracts/notifications';
import type { AuthUser } from '../../src/lib/api/auth.ts';

export function authUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    avatarAccent: null,
    avatarColorKey: 'blue',
    avatarUrl: null,
    createdAt: 1,
    displayName: 'Аня',
    dnd: false,
    doNotDisturb: false,
    id: '11111111-1111-4111-8111-111111111111',
    login: 'anya',
    presenceStatus: 'online',
    hasUsedDesktopApp: false,
    appPromptSeen: true,
    ...overrides
  };
}

export function notificationPreferences(overrides: Partial<NotificationPreferences> = {}): NotificationPreferences {
  return {
    doNotDisturb: false,
    mutedPeerIds: [],
    mutedRoomIds: [],
    roomLevels: {},
    presenceStatus: 'online',
    presenceStatusAutomatic: false,
    privateNotifications: false,
    ...overrides
  };
}
