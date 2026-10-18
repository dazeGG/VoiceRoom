import { Done } from '@voice-room/shared/contracts/http';
import { PushConfig } from '@voice-room/shared/contracts/notifications';
import { api } from './client';

export type { PushConfig };

export function fetchPushConfig(): Promise<PushConfig> {
  return api.get('/api/push/config', PushConfig);
}

export async function savePushSubscription(subscription: PushSubscriptionJSON): Promise<void> {
  await api.post('/api/push/subscriptions', Done, { subscription });
}

export async function deletePushSubscription(endpoint: string): Promise<void> {
  await api.delete('/api/push/subscriptions', Done, { endpoint });
}
