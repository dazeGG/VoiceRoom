import { fireEvent, render, screen, within } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { createPinia, setActivePinia } from 'pinia';
import { DeviceSettings, ParticipantTile, RoomDock, RoomStage, type CallDevice } from '@voiceroom/call/views';
import { getHotkeyStorageKey, writeHotkeyBinding } from '@voiceroom/call/engine/core/hotkeys';
import { expect, onTestFinished, test, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { installWebCallPortsForTest } from '../../../../apps/web/test/helpers/call-ports';
import { stubOverlayDom } from '../../../../apps/web/test/helpers/overlay-dom';

const dock = {
  connection: { stateName: 'connected', label: 'Голос подключен', title: '' },
  callControls: { stateName: 'live', label: 'Выключить микрофон', disabled: false, ariaPressed: false },
  outputControls: { stateName: 'live', label: 'Выключить звук', ariaPressed: false },
  screenControls: { stateName: 'idle', label: 'Показать экран', disabled: false, ariaPressed: false },
  cameraControls: { stateName: 'off', label: 'Включить камеру', disabled: false, ariaPressed: false },
  pushToTalk: false,
  pushToTalkActive: false,
  microphoneMenu: false,
  outputMenu: false,
  cameraMenu: false,
  hideLeaveButton: false,
  showScreenExit: false
} as const;

test('the call stage composes call content and host panels in separate regions', () => {
  render(RoomStage, {
    props: { hidden: false },
    slots: {
      screen: () => h('span', 'Shared screen'),
      tiles: () => h('span', 'Participant tiles'),
      dock: () => h('span', 'Call controls'),
      panel: () => h('span', 'Host chat')
    }
  });

  const main = screen.getByRole('main');
  const stage = within(main).getByRole('region', { name: 'Голосовая комната' });
  expect(within(stage).queryByText('Shared screen')).not.toBeNull();
  expect(within(stage).queryByText('Participant tiles')).not.toBeNull();
  expect(within(stage).queryByText('Call controls')).not.toBeNull();
  expect(within(main).queryByText('Host chat')).not.toBeNull();
  expect(within(stage).queryByText('Host chat')).toBeNull();
});

test('a participant tile renders the host badge and emits separate spotlight actions', async () => {
  const activate = vi.fn();
  const watchScreen = vi.fn();
  const { container } = render(ParticipantTile, {
    props: {
      participant: {
        id: 'peer-a',
        name: 'Вася',
        isLocal: false,
        deafened: false,
        muted: false,
        screen: true,
        speaking: false,
        cameraStream: null,
        statusLabel: ''
      },
      avatar: { initials: 'В', src: null, background: 'black', foreground: 'white' },
      viewing: false,
      mirrored: false,
      screenRequesting: false,
      onActivate: activate,
      onWatchScreen: watchScreen
    },
    slots: { badge: 'Host badge' }
  });

  expect(screen.queryByText('Host badge')).not.toBeNull();
  await fireEvent.click(screen.getByRole('button', { name: 'Смотреть экран' }));
  expect(watchScreen).toHaveBeenCalledOnce();
  expect(activate).not.toHaveBeenCalled();

  const tile = container.querySelector('.participant');
  if (!tile) throw new Error('The participant tile was missing');
  await fireEvent.keyDown(tile, { key: 'Enter' });
  expect(activate).toHaveBeenCalledOnce();
  expect(watchScreen).toHaveBeenCalledOnce();
});

test('the dock gives the host the original microphone click used to join the call', async () => {
  const microphoneClicked = vi.fn();
  render(RoomDock, {
    props: {
      ...dock,
      callControls: { stateName: 'idle', label: 'Join voice', disabled: false, ariaPressed: false },
      onToggleMicrophone: microphoneClicked
    }
  });

  const event = new MouseEvent('click', { bubbles: true });
  await fireEvent(screen.getByRole('button', { name: 'Join voice' }), event);
  expect(microphoneClicked).toHaveBeenCalledExactlyOnceWith(event);
});

test('keyboard focus shows the microphone action and the current call hotkey', async () => {
  stubOverlayDom();
  const pinia = setActivePinia(createPinia());
  await installWebCallPortsForTest();
  onTestFinished(() => localStorage.removeItem(getHotkeyStorageKey('mic-mute')));
  writeHotkeyBinding('mic-mute', { code: 'KeyJ', ctrlKey: true, altKey: false, metaKey: false, shiftKey: false });

  const user = userEvent.setup();
  const view = render(RoomDock, { props: dock, global: { plugins: [pinia] } });
  const button = screen.getByRole('button', { name: 'Выключить микрофон', pressed: false });
  expect(screen.queryByRole('tooltip')).toBeNull();

  await user.tab();
  expect(document.activeElement).toBe(button);
  const tooltip = await screen.findByRole('tooltip', { name: 'Выключить микрофон' });
  expect(button.getAttribute('aria-describedby')).toBe(tooltip.id);
  expect(Array.from(document.querySelectorAll('kbd'), (key) => key.textContent)).toEqual(['Ctrl', 'J']);

  writeHotkeyBinding('mic-mute', { code: 'KeyK', ctrlKey: true, altKey: false, metaKey: false, shiftKey: false });
  await view.rerender({
    callControls: { ...dock.callControls, label: 'Включить микрофон', ariaPressed: true, stateName: 'muted' }
  });
  expect(screen.getByRole('button', { name: 'Включить микрофон', pressed: true })).toBe(button);
  expect(await screen.findByRole('tooltip', { name: 'Включить микрофон' })).toBe(tooltip);
  expect(Array.from(document.querySelectorAll('kbd'), (key) => key.textContent)).toEqual(['Ctrl', 'K']);

  await user.keyboard('{Escape}');
  await vi.waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
  expect(document.activeElement).toBe(button);
});

test('the microphone chooser is keyboard accessible and restores focus after Escape', async () => {
  stubOverlayDom();
  const user = userEvent.setup();
  const selected = vi.fn();
  render(
    defineComponent(() => {
      const open = ref(false);
      return () =>
        h(
          RoomDock,
          {
            ...dock,
            microphoneMenu: open.value,
            onToggleDeviceMenu: () => {
              open.value = !open.value;
            },
            onUpdateDeviceMenu: (_device: CallDevice, next: boolean) => {
              open.value = next;
            }
          },
          {
            deviceSettings: ({ device }: { device: CallDevice }) =>
              h(DeviceSettings, {
                device,
                state: {
                  microphoneId: 'default',
                  microphoneOptions: [{ value: 'default', label: 'Системный микрофон' }],
                  cameraId: '',
                  cameraOptions: [],
                  outputDeviceId: '',
                  outputOptions: [],
                  noiseMode: 'off',
                  outputDisabled: true,
                  microphoneVolume: 100
                },
                gate: {
                  gateOn: true,
                  markerActive: true,
                  levelScale: 0,
                  levelState: 'closed',
                  thresholdLabel: '−42 дБ',
                  thresholdValue: -42
                },
                onSelect: selected
              })
          }
        );
    })
  );

  const chooser = screen.getByRole('button', { name: 'Выбрать микрофон', expanded: false });
  await user.tab();
  await user.tab();
  expect(document.activeElement).toBe(chooser);
  await user.keyboard('{Enter}');
  const dialog = await screen.findByRole('dialog', { name: 'Настройки микрофона' });
  expect(chooser.getAttribute('aria-expanded')).toBe('true');
  expect(within(dialog).getByRole('slider', { name: 'Громкость микрофона' })).toBeTruthy();
  expect(within(dialog).getByRole('switch', { name: 'Шумовой гейт', checked: true })).toBeTruthy();

  const noise = within(dialog).getByRole('combobox', { name: 'Шумоподавление' });
  await user.click(noise);
  await user.click(await screen.findByRole('option', { name: 'Браузерный' }));
  expect(selected).toHaveBeenCalledWith('noiseMode', 'browser');
  expect(chooser.getAttribute('aria-expanded')).toBe('true');

  await user.keyboard('{Escape}');
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.activeElement).toBe(chooser);
});

test('the connection tooltip includes the detailed cause and network measurements', async () => {
  stubOverlayDom();
  const user = userEvent.setup();
  const pinia = createPinia();
  setActivePinia(pinia);
  render(RoomDock, {
    props: {
      ...dock,
      connection: { stateName: 'warning', label: 'Голос нестабилен', title: 'Потери пакетов · пинг 20 мс' }
    },
    global: { plugins: [pinia] }
  });
  await user.hover(screen.getByRole('status', { name: 'Голос нестабилен' }));
  const tooltip = await screen.findByRole('tooltip', { name: 'Потери пакетов · пинг 20 мс' });
  expect(screen.getByText('Голос нестабилен')).toBeTruthy();
  expect(tooltip.textContent).toContain('Потери пакетов · пинг 20 мс');
});
