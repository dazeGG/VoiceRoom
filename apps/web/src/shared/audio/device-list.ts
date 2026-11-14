import { t } from '@/shared/i18n';
import type { SelectOption } from '@/shared/ui/Select/types';

// Chrome on Windows lists two aliases next to the real devices: "default"
// (the system default) and "communications" (the Windows communications
// device). Both point at a device that is already in the list, and the menus
// have their own "system" entry, so one microphone would show up three times.
const VIRTUAL_DEVICE_IDS = new Set(['default', 'communications']);

/** The physical devices of one kind, each once, in the browser's order. */
export function listPhysicalDevices(devices: MediaDeviceInfo[], kind: MediaDeviceKind): MediaDeviceInfo[] {
  const seen = new Set<string>();
  return devices.filter((device) => {
    if (device.kind !== kind || !device.deviceId || VIRTUAL_DEVICE_IDS.has(device.deviceId)) return false;
    if (seen.has(device.deviceId)) return false;
    seen.add(device.deviceId);
    return true;
  });
}

/**
 * A menu of real devices plus the saved one the system no longer has. The sound
 * plays on the system device until it returns, so the menu says so, and any other
 * entry, the system one too, is a change that drops the saved choice for good.
 * With only the system entry the browser may be hiding device ids until the
 * microphone is allowed, so nothing can be said yet.
 */
export function withSavedDeviceMissing(options: SelectOption[], savedId: string): SelectOption[] {
  if (!savedId || options.length < 2 || options.some((option) => option.value === savedId)) return options;
  return [...options, { value: savedId, label: t('Устройство недоступно') }];
}
