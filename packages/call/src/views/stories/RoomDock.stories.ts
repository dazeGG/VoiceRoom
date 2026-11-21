import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { DeviceSettings, RoomDock, type CallDevice, type CallDeviceSettings } from '..';
import { computed, reactive, ref } from 'vue';

const microphone = { label: 'Выключить микрофон', ariaPressed: false, disabled: false, stateName: 'live' } as const;
const camera = { label: 'Включить камеру', ariaPressed: false, disabled: false, stateName: 'off' } as const;
const screen = { label: 'Показать экран', ariaPressed: false, disabled: false, stateName: 'idle' } as const;

const meta = {
  title: 'Components/Call/RoomDock',
  component: RoomDock,
  tags: ['autodocs'],
  args: {
    connection: { stateName: 'connected', label: 'Голос подключен · 24 мс', title: '' },
    callControls: microphone,
    outputControls: { label: 'Выключить звук', ariaPressed: false, stateName: 'live' },
    cameraControls: camera,
    screenControls: screen,
    pushToTalk: false,
    pushToTalkActive: false,
    microphoneMenu: false,
    outputMenu: false,
    cameraMenu: false,
    hideLeaveButton: false,
    showScreenExit: false
  },
  render: (args) => ({
    components: { RoomDock, DeviceSettings },
    setup() {
      const menu = ref<CallDevice | null>(args.microphoneMenu ? 'microphone' : null);
      const devices = reactive<CallDeviceSettings>({
        microphoneId: 'desktop',
        outputDeviceId: 'headphones',
        cameraId: 'webcam',
        noiseMode: 'off',
        microphoneVolume: 85,
        outputDisabled: false,
        microphoneOptions: [
          { value: 'desktop', label: 'Настольный микрофон' },
          { value: 'headset', label: 'Микрофон гарнитуры' }
        ],
        outputOptions: [{ value: 'headphones', label: 'Наушники' }],
        cameraOptions: [{ value: 'webcam', label: 'Веб-камера' }]
      });
      const threshold = ref(-42);
      const gateOn = ref(true);
      const gate = computed(() => ({
        levelScale: 0.62,
        levelState: 'open' as const,
        markerActive: gateOn.value,
        thresholdLabel: `${threshold.value} дБ`,
        thresholdValue: threshold.value,
        gateOn: gateOn.value
      }));

      function toggleMenu(device: CallDevice): void {
        menu.value = menu.value === device ? null : device;
      }

      function updateMenu(device: CallDevice, open: boolean): void {
        if (open) menu.value = device;
        else if (menu.value === device) menu.value = null;
      }

      function selectDevice(device: CallDevice | 'noiseMode', id: string): void {
        const fields = {
          microphone: 'microphoneId',
          output: 'outputDeviceId',
          camera: 'cameraId',
          noiseMode: 'noiseMode'
        } as const;
        devices[fields[device]] = id;
      }

      return { args, devices, gate, gateOn, menu, selectDevice, threshold, toggleMenu, updateMenu };
    },
    template: `<div class="story-room-dock">
      <RoomDock
        v-bind="args"
        :microphone-menu="menu === 'microphone'"
        :output-menu="menu === 'output'"
        :camera-menu="menu === 'camera'"
        @toggle-device-menu="toggleMenu"
        @update-device-menu="updateMenu"
      >
        <template #deviceSettings="{ device }">
          <DeviceSettings
            :device="device"
            :state="devices"
            :gate="gate"
            @select="selectDevice"
            @microphone-volume="devices.microphoneVolume = $event"
            @toggle-gate="gateOn = !gateOn"
            @gate-threshold="threshold = $event"
          />
        </template>
      </RoomDock>
    </div>`
  })
} satisfies Meta<typeof RoomDock>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllButtons: Story = { args: { showScreenExit: true } };
export const MicrophoneOff: Story = {
  args: { callControls: { ...microphone, label: 'Включить микрофон', ariaPressed: true, stateName: 'muted' } }
};
export const CameraOn: Story = {
  args: { cameraControls: { ...camera, label: 'Выключить камеру', ariaPressed: true, stateName: 'on' } }
};
export const Sharing: Story = {
  args: { screenControls: { ...screen, label: 'Закончить стрим', ariaPressed: true, stateName: 'live' } }
};
export const DevicePopoverOpen: Story = { args: { microphoneMenu: true } };
