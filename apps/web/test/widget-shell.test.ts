import { render, fireEvent, screen, waitFor } from '@testing-library/vue';
import { beforeEach, expect, test, vi } from 'vitest';
import { defaultWidgetConfig } from '@voice-room/shared/contracts/widget';
import WidgetShell from '../src/features/widget/WidgetShell.vue';
const mocks = vi.hoisted(() => ({
  create: vi.fn(async () => undefined),
  join: vi.fn(async (_code: string) => undefined),
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
    create: mocks.create,
    join: mocks.join,
    text: mocks.text,
    deleteText: mocks.deleteText,
    leave: mocks.leave,
    media: { resumeAudio: vi.fn() }
  })
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.joined = true;
});

test('the shared guest entry passes the edited name and room code into the real shell actions', async () => {
  mocks.state.joined = false;
  const view = render(WidgetShell, {
    props: {
      bootstrap: { config: defaultWidgetConfig, parentOrigin: 'https://game.test', nonce: 'ab'.repeat(24) }
    }
  });
  await fireEvent.update(await screen.findByLabelText('Ваше имя'), 'Party guest');
  await fireEvent.click(screen.getByRole('button', { name: 'Создать комнату' }));
  expect(mocks.state.name).toBe('Party guest');
  expect(mocks.create).toHaveBeenCalledOnce();
  await fireEvent.update(screen.getByLabelText('Код комнаты'), 'party-code');
  await fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
  expect(mocks.join).toHaveBeenCalledWith('party-code');
  view.unmount();
});
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
