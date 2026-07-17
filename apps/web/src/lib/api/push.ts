import { del, fetchJson, postJsonAuth } from './http';

export type PushConfig = { enabled: boolean; vapidPublicKey: string };

export async function fetchPushConfig(): Promise<PushConfig> {
  return fetchJson<PushConfig>('/api/push/config');
}

export async function savePushSubscription(subscription: PushSubscriptionJSON): Promise<void> {
  await postJsonAuth('/api/push/subscriptions', { subscription });
}

export async function deletePushSubscription(endpoint: string): Promise<void> {
  await del('/api/push/subscriptions', { endpoint });
}
