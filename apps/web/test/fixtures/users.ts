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
    ...overrides
  } as AuthUser;
}
