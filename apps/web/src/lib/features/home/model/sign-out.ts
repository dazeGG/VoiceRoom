import { logout } from '$lib/api/auth';
import { clearSession, expectSessionEnd } from '$lib/features/auth/session.svelte';
import { detachPushSubscription } from './push-notifications.svelte';

export async function signOut(): Promise<void> {
  await detachPushSubscription().catch(() => {});
  // Signing out also makes the server close this device's realtime socket; that
  // close must not be reported as the session being ended somewhere else.
  expectSessionEnd();
  try {
    await logout();
    clearSession();
  } catch (error) {
    expectSessionEnd(false);
    throw error;
  }
}
