import { DesktopRelease, type DesktopAsset } from '@voice-room/shared/contracts/ops';
import { api } from './client';

export type { DesktopAsset, DesktopRelease };

/** Latest desktop release metadata, proxied + cached by the API from GitHub. */
export function fetchDesktopRelease(): Promise<DesktopRelease> {
  return api.get('/api/desktop/latest', DesktopRelease);
}
