import { computed } from 'vue';
import { state } from '@voiceroom/call/engine/core/room-runtime.store';
import { useRoomDeviceUiStore } from '@voiceroom/call/engine/core/room-device-ui.store';
import { useAppearanceStore } from '@/shared/appearance/appearance.store';

export function useDockAutoHide() {
  const appearance = useAppearanceStore();
  const devices = useRoomDeviceUiStore();

  return computed(
    () =>
      appearance.dockAutoHide &&
      state.voiceConnection === 'connected' &&
      !devices.devicePopoverOpen &&
      !devices.outputPopoverOpen &&
      !devices.cameraPopoverOpen
  );
}
