import type { DesktopNotificationPayload } from '$lib/shared/notifications/router';
import { classifyPlatform } from './platform-class';

type BridgeResult = { ok?: boolean; reason?: string } | null | undefined | void;
type DesktopBridge = { show(payload: DesktopNotificationPayload): BridgeResult | Promise<BridgeResult> };

function resolveBridge(): DesktopBridge | null {
  if (classifyPlatform() !== 'desktop') return null;
  const candidate = (globalThis as typeof globalThis & { voiceRoomDesktopNotifications?: unknown }).voiceRoomDesktopNotifications;
  if (!candidate || typeof candidate !== 'object' || typeof (candidate as DesktopBridge).show !== 'function') return null;
  return candidate as DesktopBridge;
}

export async function showDesktopNotification(payload: DesktopNotificationPayload): Promise<{ shown: boolean; reason?: string }> {
  const bridge = resolveBridge();
  if (!bridge) return { shown: false, reason: 'desktop_bridge_unavailable' };
  try {
    const result = await bridge.show(payload);
    return result && result.ok === false ? { shown: false, reason: result.reason || 'desktop_bridge_rejected' } : { shown: true };
  } catch {
    return { shown: false, reason: 'desktop_bridge_failed' };
  }
}
