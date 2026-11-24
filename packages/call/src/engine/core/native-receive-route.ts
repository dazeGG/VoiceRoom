// Set by the native receive controller. Playback and device code can observe
// the route without importing the controller and its LiveKit dependencies.
export const nativeReceiveRoute: {
  active: boolean;
  settingsChanged?: (options?: { devicesChanged?: boolean }) => void;
} = { active: false };
