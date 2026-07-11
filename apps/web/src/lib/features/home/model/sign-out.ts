import { logout } from '$lib/api/auth';
import { clearSession } from '$lib/features/auth/session.svelte';
import { detachPushSubscription } from './push-notifications.svelte';

export async function signOut(): Promise<void> {
  await detachPushSubscription().catch(() => {});
  await logout();
  clearSession();
}
