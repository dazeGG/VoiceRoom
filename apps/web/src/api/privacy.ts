import { PrivacyResponse, PrivacySettings, type ContactKind } from '@voiceroom/shared/contracts/privacy';
import { api } from './client';

export async function fetchPrivacy(signal?: AbortSignal) {
  return (await api.get('/api/privacy', PrivacyResponse, { signal })).privacy;
}

export async function savePrivacy(settings: PrivacySettings) {
  return (await api.put('/api/privacy', PrivacyResponse, settings, { bodySchema: PrivacySettings })).privacy;
}

export async function changePrivacyAllowList(kind: ContactKind, userId: string, add: boolean) {
  const url = `/api/privacy/allow/${kind}/${encodeURIComponent(userId)}`;
  return (await (add ? api.put(url, PrivacyResponse) : api.delete(url, PrivacyResponse))).privacy;
}
