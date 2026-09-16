// Compile-time contract, checked by `tsc --noEmit` in `npm run check`: an
// AuthUser built without the self-only flags must not type-check, so no
// `setUser` caller can silently drop them.
import type { AuthUser } from './auth';

// @ts-expect-error hasUsedDesktopApp and appPromptSeen are required.
export const authUserWithoutSelfFlags: AuthUser = {
  avatarAccent: null,
  avatarColorKey: 'blurple',
  avatarUrl: null,
  createdAt: 0,
  displayName: '',
  dnd: false,
  doNotDisturb: false,
  id: 'contract',
  login: 'contract',
  presenceStatus: 'online'
};
