import { render, fireEvent, screen, waitFor } from '@testing-library/vue';
import { beforeEach, expect, test, vi } from 'vitest';
import { defaultWidgetConfig } from '@voice-room/shared/contracts/widget';
import WidgetShell from '../src/features/widget/WidgetShell.vue';
const mocks = vi.hoisted(() => ({
  text: vi.fn(async () => undefined),
  deleteText: vi.fn(async () => undefined),
  leave: vi.fn(),
  state: {
    roomId: 'roomCode',
    name: 'Guest',
    status: 'В комнате',
    error: '',
    joined: true,
    muted: false,
    camera: false,
    chat: true,
    peers: [],
    messages: [{ id: 'mine', peerId: 'self', name: 'Guest', text: 'Earlier' }],
    devices: [],
    localVolumes: {},
    input: '',
    output: '',
    noise: 'browser'
  }
}));
vi.mock('../src/features/widget/runtime', () => ({
  createWidgetRuntime: () => ({
    state: mocks.state,
    peerId: 'self',
    text: mocks.text,
    deleteText: mocks.deleteText,
    leave: mocks.leave,
    media: { resumeAudio: vi.fn() }
  })
}));
beforeEach(() => vi.clearAllMocks());
test('enabled text chat exposes a usable composer and author deletion', async () => {
  const view = render(WidgetShell, {
    props: {
      bootstrap: {
        config: { ...defaultWidgetConfig, chat: true },
        parentOrigin: 'https://game.test',
        nonce: 'ab'.repeat(24)
      }
    }
  });
  await fireEvent.update(await screen.findByLabelText('Сообщение'), 'Hello party');
  await fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
  await waitFor(() => expect(mocks.text).toHaveBeenCalledWith('Hello party'));
  await fireEvent.click(screen.getByRole('button', { name: 'Удалить сообщение' }));
  expect(mocks.deleteText).toHaveBeenCalledWith('mine');
  view.unmount();
  expect(mocks.leave).toHaveBeenCalledOnce();
});
