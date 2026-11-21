import { render, fireEvent, screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { markRaw, reactive } from 'vue';
import { defaultWidgetConfig, type WidgetConfig } from '@voice-room/shared/contracts/widget';
import { state } from '@voice-room/call/engine/core/room-runtime.store';
import { getParticipantAudioPreference, getParticipantAudioPreferenceKey } from '@voice-room/call/engine/core/settings';
import { createInitialRoomState } from '@voice-room/call/engine/model/room-state';
import { installCallPorts } from '@voice-room/call/engine/ports';
import { createParticipant } from '@voice-room/call/engine/room/participants';
import { refreshDevices, switchNoiseMode } from '@voice-room/call/engine/ui/devices';
import type * as deviceControls from '@voice-room/call/engine/ui/devices';
import WidgetShell from '../src/WidgetShell.vue';
import { createWidgetSession, widgetSessionKey } from '../src/session';

vi.mock('@voice-room/call/engine/ui/devices', async (importOriginal) => {
  const original = await importOriginal<typeof deviceControls>();
  return { ...original, refreshDevices: vi.fn(async () => []), switchNoiseMode: vi.fn(async () => undefined) };
});

const parentOrigin = 'https://game.test';
const nonce = 'ab'.repeat(24);
const installed: (() => void)[] = [];

class FakeStream {
  get [Symbol.toStringTag](): string {
    return 'MediaStream';
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('MediaStream', FakeStream);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
  );
  Object.assign(state, createInitialRoomState(), { peerId: 'self', localConnectionQuality: 'good', joined: true });
  createParticipant({ id: 'self', name: 'Вы' });
});

afterEach(() => {
  for (const uninstall of installed.splice(0)) uninstall();
  vi.restoreAllMocks();
});

function renderShell(config: WidgetConfig = defaultWidgetConfig, joined = true, camera = config.camera !== false) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const session = createWidgetSession({ camera, setCallActive: vi.fn() });
  installed.push(installCallPorts(session.ports, pinia));
  const create = vi.fn(async () => undefined);
  const join = vi.fn(async (_code: string) => undefined);
  const dispose = vi.fn();
  const entry = reactive({
    ...session.entry,
    roomId: 'roomCode',
    name: 'Guest',
    status: 'В комнате',
    joined,
    cameraAllowed: camera
  });
  const view = render(WidgetShell, {
    props: {
      bootstrap: { config, parentOrigin, nonce }
    },
    global: {
      plugins: [pinia],
      provide: { [widgetSessionKey]: { ...session, entry, create, join, dispose } }
    }
  });
  return { view, entry, create, join, dispose };
}

test('the shared guest entry passes the edited name and room code into the real shell actions', async () => {
  const { view, entry, create, join } = renderShell({ ...defaultWidgetConfig, title: 'Голосовой стол Бэнга' }, false);
  expect(await screen.findByRole('heading', { name: 'Голосовой стол Бэнга' })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'VoiceRoom' }).getAttribute('href')).toBe('https://voiceroom.ru/');
  await fireEvent.update(await screen.findByLabelText('Ваше имя'), 'Party guest');
  await fireEvent.click(screen.getByRole('button', { name: 'Создать комнату' }));
  expect(entry.name).toBe('Party guest');
  expect(create).toHaveBeenCalledOnce();
  await fireEvent.update(screen.getByLabelText('Код комнаты'), 'party-code');
  await fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
  expect(join).toHaveBeenCalledWith('party-code');
  view.unmount();
});
test('legacy embeds can still join rooms while ignoring the old chat setting', async () => {
  const { view, dispose } = renderShell({ ...defaultWidgetConfig, chat: true });
  expect(await screen.findByRole('button', { name: 'Выйти' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Текстовый чат' })).toBeNull();
  view.unmount();
  expect(dispose).toHaveBeenCalledOnce();
});

test('the in-call dock keeps per-participant controls available from their video tile', async () => {
  const peer = createParticipant({ id: 'alex', name: 'Алекс' });
  const stream = markRaw(new MediaStream());
  peer.camera = true;
  peer.cameraStream = stream;
  renderShell();
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
  expect(participant.closest('li')?.querySelector('video')?.srcObject).toBe(stream);
  await fireEvent.click(participant);
  expectSameTiles();
  await fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
  await fireEvent.keyDown(participant, { key: 'Enter' });
  expectSameTiles();
  await fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
  await fireEvent.contextMenu(participant);
  expectSameTiles();
  const slider = screen.getByRole('slider', { name: 'Громкость' });
  slider.focus();
  await userEvent.keyboard('{ArrowLeft>10/}');
  expect(slider.getAttribute('aria-valuenow')).toBe('0.5');
  const preference = getParticipantAudioPreferenceKey(peer.accountUserId, peer.id);
  expect(getParticipantAudioPreference(preference).volume).toBe(0.5);
  await fireEvent.click(screen.getByRole('button', { name: 'Отключить локально' }));
  expect(getParticipantAudioPreference(preference).volume).toBe(0);
  await fireEvent.click(screen.getByRole('button', { name: 'Включить локально' }));
  expect(getParticipantAudioPreference(preference).volume).toBeGreaterThan(0);
  await fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
  expect(screen.queryByRole('slider', { name: 'Громкость' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Выйти' })).toBeTruthy();
});

test('the dock opens a separate device menu from each group and toggles headphones', async () => {
  renderShell();
  await fireEvent.click(await screen.findByRole('button', { name: 'Выбрать микрофон' }));
  expect(screen.getByRole('combobox', { name: 'Микрофон' })).toBeTruthy();
  const noise = screen.getByRole('combobox', { name: 'Шумоподавление' });
  noise.focus();
  await userEvent.keyboard('{ArrowDown}{Home}{ArrowDown}{Enter}');
  expect(noise.textContent).toContain('Браузерное');
  expect(switchNoiseMode).toHaveBeenCalledOnce();
  await fireEvent.click(screen.getByRole('button', { name: 'Выбрать динамик' }));
  expect(screen.getByRole('combobox', { name: 'Вывод звука' })).toBeTruthy();
  expect(screen.queryByRole('combobox', { name: 'Шумоподавление' })).toBeNull();
  await fireEvent.click(screen.getByRole('button', { name: 'Выбрать камеру' }));
  expect(screen.getByRole('combobox', { name: 'Камера' })).toBeTruthy();
  expect(refreshDevices).toHaveBeenCalledTimes(3);
  await fireEvent.click(screen.getByRole('button', { name: 'Выключить звук' }));
  expect(state.localAppAudioSuppressed).toBe(true);
  expect(screen.getByRole('button', { name: 'Включить звук' })).toBeTruthy();
});

test('voice-only rooms use live quality and offer a copyable code and expansion through the parent', async () => {
  const copy = vi.fn(async () => undefined);
  vi.stubGlobal(
    'navigator',
    Object.assign(
      { clipboard: { writeText: copy } },
      {
        userAgent: navigator.userAgent,
        maxTouchPoints: navigator.maxTouchPoints
      }
    )
  );
  state.localConnectionQuality = 'poor';
  const peer = createParticipant({ id: 'alex', name: 'Алекс' });
  peer.camera = true;
  peer.cameraStream = markRaw(new MediaStream());
  const { view } = renderShell(defaultWidgetConfig, true, false);
  await fireEvent.click(await screen.findByRole('button', { name: 'Скопировать код комнаты' }));
  expect(copy).toHaveBeenCalledWith('roomCode');
  expect(screen.queryByRole('button', { name: 'Выбрать камеру' })).toBeNull();
  expect(view.container.querySelector('video')).toBeNull();
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
