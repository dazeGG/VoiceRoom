import { fireEvent, render, screen, within } from '@testing-library/vue';
import { ParticipantTile, RoomDock, RoomStage } from '@voice-room/call/views';
import { expect, test, vi } from 'vitest';
import { h } from 'vue';

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
      connection: { stateName: 'idle', label: 'Idle', title: 'Idle' },
      callControls: { stateName: 'idle', label: 'Join voice', disabled: false, ariaPressed: false },
      outputControls: { stateName: 'live', label: 'Speakers', ariaPressed: false },
      screenControls: { stateName: 'idle', label: 'Share screen', disabled: true, ariaPressed: false },
      cameraControls: { stateName: 'off', label: 'Camera', disabled: true, ariaPressed: false },
      pushToTalk: false,
      pushToTalkActive: false,
      microphoneMenu: false,
      outputMenu: false,
      cameraMenu: false,
      hideLeaveButton: true,
      showScreenExit: false,
      onToggleMicrophone: microphoneClicked
    }
  });

  const event = new MouseEvent('click', { bubbles: true });
  await fireEvent(screen.getByRole('button', { name: 'Join voice' }), event);
  expect(microphoneClicked).toHaveBeenCalledExactlyOnceWith(event);
});
