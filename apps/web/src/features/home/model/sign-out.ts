import { logout } from '@/api/auth';
import { useSessionStore } from '@/features/auth/session.store';
import { usePushNotificationsStore } from './push-notifications.store';

export async function signOut(): Promise<void> {
  const session = useSessionStore();
  await usePushNotificationsStore()
    .detachPushSubscription()
    .catch(() => {});
  // Signing out also makes the server close this device's realtime socket; that
  // close must not be reported as the session being ended somewhere else.
  session.expectSessionEnd();
  try {
    await logout();
    session.clearSession();
  } catch (error) {
    session.expectSessionEnd(false);
    throw error;
  }
}
