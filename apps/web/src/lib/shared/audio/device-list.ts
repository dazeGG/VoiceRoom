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
