import type { Done } from '@voice-room/shared/contracts/http';
import type { PushConfig } from '@voice-room/shared/contracts/notifications';
import { api } from './client';

export type { PushConfig };

export function fetchPushConfig(): Promise<PushConfig> {
  return api.get<PushConfig>('/api/push/config');
}

export async function savePushSubscription(subscription: PushSubscriptionJSON): Promise<void> {
  await api.post<Done>('/api/push/subscriptions', { subscription });
}

export async function deletePushSubscription(endpoint: string): Promise<void> {
  await api.delete<Done>('/api/push/subscriptions', { endpoint });
}
