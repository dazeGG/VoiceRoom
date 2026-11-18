import { render, fireEvent, screen } from '@testing-library/vue';
import { beforeEach, expect, test, vi } from 'vitest';
import { defaultWidgetConfig } from '@voice-room/shared/contracts/widget';
import WidgetShell from '../src/features/widget/WidgetShell.vue';
const mocks = vi.hoisted(() => ({
  create: vi.fn(async () => undefined),
  join: vi.fn(async (_code: string) => undefined),
  leave: vi.fn(),
  devices: vi.fn(async () => undefined),
  toggleOutput: vi.fn(async () => undefined),
  volume: vi.fn(),
  video: vi.fn<(_id: string) => HTMLVideoElement | undefined>(() => undefined),
  speaking: vi.fn((_id: string) => false),
  connectionQuality: vi.fn<() => 'excellent' | 'good' | 'poor' | 'lost' | 'unknown'>(() => 'good'),
  state: {
    roomId: 'roomCode',
    name: 'Guest',
    status: 'В комнате',
    error: '',
    joined: true,
    muted: false,
    outputMuted: false,
    camera: false,
    peers: [{ id: 'alex', name: 'Алекс', serverMuted: false }],
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
    leave: mocks.leave,
    devices: mocks.devices,
    toggleOutput: mocks.toggleOutput,
    outputBlocked: () => false,
    volume: mocks.volume,
    video: mocks.video,
    speaking: mocks.speaking,
    connectionQuality: mocks.connectionQuality,
    media: { resumeAudio: vi.fn() }
  })
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.joined = true;
  mocks.connectionQuality.mockReturnValue('good');
});

test('the shared guest entry passes the edited name and room code into the real shell actions', async () => {
  mocks.state.joined = false;
  const view = render(WidgetShell, {
    props: {
      bootstrap: {
        config: { ...defaultWidgetConfig, title: 'Голосовой стол Бэнга' },
        parentOrigin: 'https://game.test',
        nonce: 'ab'.repeat(24)
      }
    }
  });
  expect(await screen.findByRole('heading', { name: 'Голосовой стол Бэнга' })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'VoiceRoom' }).getAttribute('href')).toBe('https://voiceroom.ru/');
  await fireEvent.update(await screen.findByLabelText('Ваше имя'), 'Party guest');
  await fireEvent.click(screen.getByRole('button', { name: 'Создать комнату' }));
  expect(mocks.state.name).toBe('Party guest');
  expect(mocks.create).toHaveBeenCalledOnce();
  await fireEvent.update(screen.getByLabelText('Код комнаты'), 'party-code');
  await fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
  expect(mocks.join).toHaveBeenCalledWith('party-code');
  view.unmount();
});
test('legacy embeds can still join rooms while ignoring the old chat setting', async () => {
  const view = render(WidgetShell, {
    props: {
      bootstrap: {
        config: { ...defaultWidgetConfig, chat: true },
        parentOrigin: 'https://game.test',
        nonce: 'ab'.repeat(24)
      }
    }
  });
  expect(await screen.findByRole('button', { name: 'Выйти' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Текстовый чат' })).toBeNull();
  view.unmount();
  expect(mocks.leave).toHaveBeenCalledOnce();
});

test('the in-call dock keeps per-participant controls available from their video tile', async () => {
  const video = document.createElement('video');
  mocks.video.mockImplementation((id) => (id === 'alex' ? video : undefined));
  render(WidgetShell, {
    props: {
      bootstrap: { config: defaultWidgetConfig, parentOrigin: 'https://game.test', nonce: 'ab'.repeat(24) }
    }
  });
  const participant = await screen.findByRole('button', { name: 'Звук участника Алекс' });
  const grid = screen.getByRole('list', { name: 'Участники звонка' });
  const tiles = [...grid.querySelectorAll('.participant')];
  const expectSameTiles = () => {
    expect(screen.getByRole('list', { name: 'Участники звонка' })).toBe(grid);
    const current = grid.querySelectorAll('.participant');
    expect(current).toHaveLength(tiles.length);
    tiles.forEach((tile, index) => expect(current[index]).toBe(tile));
    expect(tiles.every((tile) => tile.classList.contains('participant--grid'))).toBe(true);
  };
  expect(participant.closest('li')?.querySelector('video')).toBe(video);
  await fireEvent.click(participant);
  expectSameTiles();
  await fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
  await fireEvent.keyDown(participant, { key: 'Enter' });
  expectSameTiles();
  await fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
  await fireEvent.contextMenu(participant);
  expectSameTiles();
  await fireEvent.update(screen.getByRole('slider', { name: 'Громкость' }), '0.5');
  expect(mocks.volume).toHaveBeenCalledWith('alex', 0.5);
  await fireEvent.click(screen.getByRole('button', { name: 'Отключить локально' }));
  expect(mocks.volume).toHaveBeenCalledWith('alex', 0);
  await fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
  expect(screen.queryByRole('slider', { name: 'Громкость' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Выйти' })).toBeTruthy();
});

test('the dock opens a separate device menu from each group and toggles headphones', async () => {
  render(WidgetShell, {
    props: {
      bootstrap: { config: defaultWidgetConfig, parentOrigin: 'https://game.test', nonce: 'ab'.repeat(24) }
    }
  });
  await fireEvent.click(await screen.findByRole('button', { name: 'Выбрать микрофон' }));
  expect(screen.getByLabelText('Шумоподавление')).toBeTruthy();
  await fireEvent.click(screen.getByRole('button', { name: 'Выбрать динамик' }));
  expect(screen.getByLabelText('Вывод звука')).toBeTruthy();
  expect(screen.queryByLabelText('Шумоподавление')).toBeNull();
  await fireEvent.click(screen.getByRole('button', { name: 'Выбрать камеру' }));
  expect(screen.getByLabelText('Камера', { exact: true })).toBeTruthy();
  expect(mocks.devices).toHaveBeenCalledTimes(3);
  await fireEvent.click(screen.getByRole('button', { name: 'Выключить звук' }));
  expect(mocks.toggleOutput).toHaveBeenCalledOnce();
});

test('voice-only rooms use live quality and offer a copyable code and expansion through the parent', async () => {
  const parentOrigin = 'https://game.test';
  const nonce = 'ab'.repeat(24);
  const copy = vi.fn(async () => undefined);
  vi.stubGlobal('navigator', Object.create(navigator, { clipboard: { value: { writeText: copy } } }));
  mocks.connectionQuality.mockReturnValue('poor');
  render(WidgetShell, {
    props: { bootstrap: { config: { ...defaultWidgetConfig, camera: false }, parentOrigin, nonce } }
  });
  await fireEvent.click(await screen.findByRole('button', { name: 'Скопировать код комнаты' }));
  expect(copy).toHaveBeenCalledWith('roomCode');
  expect(screen.queryByRole('button', { name: 'Выбрать камеру' })).toBeNull();
  expect(
    screen.getByRole('img', { name: 'Нестабильная связь' }).classList.contains('room-dock__connection--warning')
  ).toBe(true);
  expect(screen.queryByRole('button', { name: 'Развернуть виджет' })).toBeNull();
  window.dispatchEvent(
    new MessageEvent('message', {
      source: window.parent,
      origin: parentOrigin,
      data: { version: 1, nonce, type: 'expandState', active: false }
    })
  );
  const post = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => undefined);
  await fireEvent.click(await screen.findByRole('button', { name: 'Развернуть виджет' }));
  expect(post).toHaveBeenCalledWith({ version: 1, nonce, type: 'requestExpand', active: true }, parentOrigin);
  post.mockRestore();
});
